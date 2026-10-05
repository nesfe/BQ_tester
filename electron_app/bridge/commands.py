"""Revision-aware, explicit command execution; all I/O runs on the bridge's single thread."""
import ctypes as C
import json
from pathlib import Path
import re
import sys
import time

CATALOG = json.loads((Path(getattr(sys, '_MEIPASS', Path(__file__).parent)) / 'catalog.json').read_text(encoding='utf-8'))
ADDRESS = 0x16

def decode_identity(device, firmware, hardware):
    if len(device) != 2 or len(firmware) != 11 or len(hardware) != 2:
        raise ValueError('Invalid identity response length (expected 2 / 11 / 2 bytes)')
    # FirmwareVersion layouts in TI TRMs differ in byte-order notation. Resolve it
    # against the known device number, never from the version byte alone.
    orders = [order for order in ('little', 'big') if int.from_bytes(firmware[:2], order) == 0x4500]
    if not orders or 0x4500 not in [int.from_bytes(device,o) for o in ('little','big')]:
        raise ValueError('Device is not identified as BQ40Z50 (0x4500)')
    order=orders[0]
    version=int.from_bytes(firmware[2:4],order)
    major=version>>8; minor=version&255
    profile=f'r{major}' if f'r{major}' in CATALOG['profiles'] else None
    return dict(deviceType='0x4500',profile=profile,version=f'{major}.{minor:02X}',
                versionHex=f'0x{version:04X}',build=int.from_bytes(firmware[4:6],order),
                firmwareType=firmware[6],hardwareHex=hardware.hex(' ').upper(),
                rawFirmware=firmware.hex(' ').upper(),byteOrder=order,
                name=CATALOG['profiles'][profile]['name'] if profile else 'Unknown BQ40Z50 firmware')

def hex_bytes(value):
    if not isinstance(value,str) or not re.fullmatch(r'(?:[0-9a-fA-F]{2}\s*)*',value.strip()):
        raise ValueError('Enter complete hexadecimal bytes, for example: 34 12')
    return bytes.fromhex(value)

def integer(value, low, high, label):
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f'{label} must be an integer from {low} to {high}')
    return value

class CommandMixin:
    identity = None
    maintenance = None

    def sdk(self,name,args):
        fn=getattr(self.dll,name,None)
        if fn is None: raise RuntimeError(f'TI library does not export {name}')
        signatures={
            'SDKReadSMBBlock':[C.c_char_p,C.c_short,C.POINTER(C.c_ubyte),C.POINTER(C.c_short),C.c_int,C.c_short],
            'SDKWriteSMBWord':[C.c_char_p,C.c_short,C.c_short,C.c_short,C.c_short],
            'SDKWriteSMBCommand':[C.c_char_p,C.c_short,C.c_short,C.c_short],
            'SDKWriteSMBBlock':[C.c_char_p,C.c_short,C.POINTER(C.c_ubyte),C.c_short,C.c_short,C.c_short],
            'SDKWriteSMBBlkReadBlk':[C.c_char_p,C.c_short,C.POINTER(C.c_ubyte),C.c_short,C.c_short,C.c_short,C.POINTER(C.c_ubyte),C.c_int,C.POINTER(C.c_short),C.c_short],
        }
        if name in signatures: fn.argtypes=signatures[name];fn.restype=C.c_int
        self.check(fn(*args),name)

    def mac_read(self,address):
        data=(C.c_ubyte*256)();count=C.c_short()
        self.sdk('SDKWriteSMBWordReadBlock',(self.data,0,address,0,0x23,data,256,C.byref(count),ADDRESS))
        if not 1<=count.value<=256: raise RuntimeError('Invalid MAC response length')
        return bytes(data[:count.value])

    def block_read(self,address):
        data=(C.c_ubyte*256)();count=C.c_short()
        self.sdk('SDKReadSMBBlock',(self.data,address,data,C.byref(count),256,ADDRESS))
        if not 1<=count.value<=256: raise RuntimeError('Invalid SMBus block length')
        return bytes(data[:count.value])

    def word_write(self,address,value):
        self.sdk('SDKWriteSMBWord',(self.data,address,C.c_short(value).value,0,ADDRESS))

    def block_write(self,address,value):
        if not 1<=len(value)<=34: raise ValueError('Block must contain 1–34 bytes')
        buffer=(C.c_ubyte*len(value)).from_buffer_copy(value)
        self.sdk('SDKWriteSMBBlock',(self.data,address,buffer,len(value),0,ADDRESS))

    def df_read(self,address,length):
        selector=(C.c_ubyte*2).from_buffer_copy(address.to_bytes(2,'little'))
        data=(C.c_ubyte*256)();count=C.c_short()
        self.sdk('SDKWriteSMBBlkReadBlk',(self.data,0x44,selector,2,0,0x44,data,256,C.byref(count),ADDRESS))
        raw=bytes(data[:max(0,min(count.value,256))])
        if len(raw)!=34 or raw[:2]!=bytes(selector):
            raise RuntimeError('Data Flash response length/address echo mismatch')
        return raw[2:2+length]

    def identify(self):
        if not self.opened: raise RuntimeError('EV2400 is not connected')
        if self.maintenance: raise RuntimeError('Exit ROM/calibration output before detecting firmware')
        try:
            self.identity=decode_identity(self.mac_read(1),self.mac_read(2),self.mac_read(3))
        except (RuntimeError,ValueError) as error:
            self.identity=dict(profile=None,name='Unidentified firmware',error=str(error))
        return self.catalog()

    def catalog(self):
        identity=self.identity or dict(profile=None,name='Not detected')
        profile=CATALOG['profiles'].get(identity.get('profile'))
        return dict(identity=identity,source=profile['source'] if profile else None,
                    commands=profile['commands'] if profile else [],maintenance=self.maintenance)

    def execute(self,request):
        if not self.opened: raise RuntimeError('EV2400 is not connected')
        profile=CATALOG['profiles'].get((self.identity or {}).get('profile'))
        if not profile: raise ValueError('Identify a supported BQ40Z50 firmware before executing commands')
        entry=next((e for e in profile['commands'] if e['id']==request.get('commandId')),None)
        if entry is None: raise ValueError('Command is not documented for the detected revision')
        action=request.get('action'); write=action in ('write','execute')
        if action not in ('read','write','execute'):raise ValueError('Invalid command action')
        if not entry['writable' if write else 'readable']:raise ValueError('Unsupported command access')
        if write and request.get('confirmed') is not True: raise ValueError('Explicit command confirmation required')
        kind=entry['kind']; address=entry['address']; payload=b''
        if self.maintenance=='ROM' and kind!='rom':raise ValueError('Only ROM exit is available in ROM mode')
        if self.maintenance=='calibration' and entry['id'] not in ('mac:F080','mac:F081','mac:F082'):
            raise ValueError('Exit calibration output before accessing other commands')
        if kind=='rom' and self.maintenance!='ROM':raise ValueError('ROM exit is only available after entering ROM in this session')
        length=entry.get('length')
        if kind=='df':
            address=integer(request.get('address') if address is None else address,0x4000,0x5FFF,'DF address')
            length=integer(request.get('length',length or 32),1,32,'DF length')
            if address+length>0x6000:raise ValueError('Data Flash access exceeds documented range')
            if entry['id']!='df:RAW' and length!=entry['length']:raise ValueError('Named field length cannot be changed')
        if write:
            if kind=='key':
                payload=hex_bytes(request.get('hex',''))
                if len(payload)!=4:raise ValueError('Key sequence requires exactly two little-endian words (4 bytes)')
            elif kind=='sbs' and entry['protocol']=='word':
                payload=integer(request.get('value'),0,65535,'Raw word').to_bytes(2,'little')
            elif kind=='df' or entry['protocol']=='block':
                payload=hex_bytes(request.get('hex',''))
                if not 1<=len(payload)<=32:raise ValueError('Payload must contain 1–32 bytes')
                if kind=='df' and len(payload)!=length:raise ValueError('Data Flash payload length mismatch')
                if entry.get('writeLength') and len(payload)!=entry['writeLength']:
                    raise ValueError(f"This command requires {entry['writeLength']} payload bytes")
                if kind=='mac' and address==0x79 and int.from_bytes(payload,'little')>100:raise ValueError('RSOC must be 0–100%')
                if kind=='mac' and address==0x7B and len(payload)!=32:raise ValueError('ManufacturerInfoC requires 32 bytes')
            elif request.get('hex') or request.get('value') is not None:raise ValueError('This command takes no payload')
        # Check security immediately before mutation, not only against stale UI state.
        if write and kind not in ('key','rom') and self.maintenance!='calibration':
            security=(self.read_status(0x54)>>8)&3
            if security==0:raise ValueError('Unknown device security state')
            full=kind=='mac' and address in (0x35,0x37,0xF00,0x33)
            if full and security!=1:raise ValueError('Command requires FULL ACCESS')
            if security==3 and not entry.get('writeSealed',False):raise ValueError('Command requires UNSEALED or FULL ACCESS')
        verified=None
        if not write:
            if kind=='df': raw=self.df_read(address,length)
            elif kind=='mac':raw=self.mac_read(address)
            elif entry['protocol']=='word':raw=self.read_word(address).to_bytes(2,'little')
            else:raw=self.block_read(address)
            expected=entry.get('length')
            if kind!='df' and expected and len(raw)!=expected:raise RuntimeError(f'Expected {expected} bytes, received {len(raw)}')
        else:
            raw=b''
            if kind=='key':
                self.word_write(0,int.from_bytes(payload[:2],'little'))
                self.word_write(0,int.from_bytes(payload[2:],'little'))
                raw=self.read_status(0x54).to_bytes(4,'little')
                sec=(int.from_bytes(raw,'little')>>8)&3
                if entry['id']=='key:UNSEAL' and sec not in (1,2):raise RuntimeError('Key sent; device did not enter UNSEALED mode')
                if entry['id']=='key:FULL_ACCESS' and sec!=1:raise RuntimeError('Key sent; device did not enter FULL ACCESS mode')
            elif kind=='rom':
                self.sdk('SDKWriteSMBCommand',(self.data,8,0,ADDRESS)); self.maintenance=None
            elif kind=='df':
                self.block_write(0x44,address.to_bytes(2,'little')+payload)
                time.sleep(.02)
                raw=self.df_read(address,length);verified=raw==payload
                if not verified:raise RuntimeError('Data Flash write acknowledged, but readback differs; not retried')
            elif kind=='mac':
                if payload:
                    self.block_write(0x44,address.to_bytes(2,'little')+payload)
                else:
                    if address in (0xF00,0x33):self.maintenance='ROM'
                    elif address in (0xF081,0xF082):self.maintenance='calibration'
                    self.word_write(0,address)
                    if address==0x10 and security==3:self.word_write(0,address) # documented sealed shutdown sequence
                if address in (0xF00,0x33):self.maintenance='ROM'
                elif address in (0xF081,0xF082):self.maintenance='calibration';raw=self.block_read(0x23)
                elif address==0xF080:self.maintenance=None
            elif entry['protocol']=='word':self.word_write(address,int.from_bytes(payload,'little'))
            else:self.block_write(address,payload)
        result=dict(commandId=entry['id'],action=action,hex=raw.hex(' ').upper(),bytes=list(raw),
                    timestamp=int(time.time()*1000),maintenance=self.maintenance,verified=verified,
                    message='Write acknowledged by transport; check device status.' if write else 'Read complete')
        if write and kind=='mac' and address in (0x10,0x41,0x12,0xF0):result['disconnect']=True
        if raw and len(raw)<=4:result['unsigned']=int.from_bytes(raw,'little');result['signed']=int.from_bytes(raw,'little',signed=True)
        if entry.get('dataType')=='text':result['text']=raw.decode('ascii',errors='replace').rstrip('\x00')
        return result
