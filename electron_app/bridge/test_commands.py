import ctypes as C
import unittest
from commands import CATALOG, decode_identity
from ti_bridge import Adapter
from test_ti_bridge import FakeTI, Function

class CommandTI(FakeTI):
    def __init__(self):
        super().__init__()
        self.security=2;self.sent=[];self.df=bytes(range(32));self.bad_echo=False
        self.SDKWriteSMBWordReadBlock=Function(self.mac)
        self.SDKReadSMBBlock=Function(self.block)
        self.SDKWriteSMBWord=Function(self.write_word)
        self.SDKWriteSMBBlock=Function(self.write_block)
        self.SDKWriteSMBCommand=Function(lambda *args: self.sent.append(('command',args[1])) or 0)
        self.SDKWriteSMBBlkReadBlk=Function(self.df_read)
    def mac(self,pipe,word_cmd,mac,delay,block_cmd,buffer,size,count,address):
        assert word_cmd==0 and block_cmd==0x23 and address==0x16
        raw={1:b'\x00\x45',2:bytes.fromhex('45 00 05 05 00 24 00 01 00 00 00'),3:b'\x01\x00',0x54:(self.security<<8).to_bytes(4,'little')}.get(mac,b'\x00'*4)
        for i,b in enumerate(raw):buffer[i]=b
        C.cast(count,C.POINTER(C.c_short))[0]=len(raw)
        self.sent.append(('mac',mac))
        return 0
    def block(self,pipe,cmd,data,count,size,address):
        data[0]=42;C.cast(count,C.POINTER(C.c_short))[0]=1;return 0
    def write_word(self,pipe,cmd,value,delay,address):
        self.sent.append(('word',cmd,value&0xFFFF));return 0
    def write_block(self,pipe,cmd,data,length,delay,address):
        raw=bytes(data[:length]);self.sent.append(('block',cmd,raw))
        if cmd==0x44 and int.from_bytes(raw[:2],'little')>=0x4000:self.df=raw[2:]+self.df[len(raw)-2:]
        return 0
    def df_read(self,pipe,first,selector,length,delay,second,data,size,count,address):
        assert first==second==0x44 and length==2 and address==0x16
        raw=(b'\x00\x00' if self.bad_echo else bytes(selector))+self.df
        for i,b in enumerate(raw):data[i]=b
        C.cast(count,C.POINTER(C.c_short))[0]=len(raw);return 0

class CommandsTests(unittest.TestCase):
    def setUp(self):
        self.ti=CommandTI();self.a=Adapter(self.ti);self.a.open('commmgr.exe');self.a.identify();self.ti.sent=[]
    def run_command(self,id,action='read',**args):
        return self.a.execute(dict(commandId=id,action=action,**args))
    def test_identity_orders_revisions_unknown_and_foreign(self):
        for rev in range(6):
            for order in ('little','big'):
                fw=(0x4500).to_bytes(2,order)+((rev<<8)|0x11).to_bytes(2,order)+(42).to_bytes(2,order)+b'\x00'*5
                result=decode_identity(b'\x00\x45',fw,b'\x01\x00')
                self.assertEqual(result['profile'],f'r{rev}');self.assertEqual(result['version'],f'{rev}.11');self.assertEqual(result['build'],42)
        self.assertIsNone(decode_identity(b'\x00\x45',bytes.fromhex('45 00 09 00 00 00 00 00 00 00 00'),b'\x00\x00')['profile'])
        with self.assertRaises(ValueError):decode_identity(b'\x00\x45',b'\x00'*11,b'\x00\x00')
        with self.assertRaises(ValueError):decode_identity(b'\x00\x45',b'\x00'*4,b'\x00\x00')
    def test_read_only_unknown_and_confirmation_reject_without_usb(self):
        for request in [dict(commandId='mac:DEAD',action='write',confirmed=True),dict(commandId='sbs:0009',action='write',value=0,confirmed=True),dict(commandId='mac:001F',action='write')]:
            with self.assertRaises(ValueError):self.a.execute(request)
        self.assertEqual(self.ti.sent,[])
    def test_sealed_write_is_blocked_and_sealed_read_works(self):
        self.ti.security=3
        self.assertEqual(self.run_command('sbs:000A')['signed'],-1)
        with self.assertRaisesRegex(ValueError,'UNSEALED'):self.run_command('mac:001F','write',confirmed=True)
        self.assertFalse(any(x[0]=='word' for x in self.ti.sent))
    def test_shutdown_sealed_sequence_is_atomic_and_requests_disconnect(self):
        self.ti.security=3
        result=self.run_command('mac:0010','write',confirmed=True)
        self.assertEqual([x for x in self.ti.sent if x[0]=='word'],[('word',0,0x10),('word',0,0x10)])
        self.assertTrue(result['disconnect'])
    def test_rsoc_payload_exact_and_range(self):
        for payload in ['','64','GG','65 00']:
            with self.assertRaises(ValueError):self.run_command('mac:0079','write',hex=payload,confirmed=True)
        self.assertEqual(self.ti.sent,[])
        self.run_command('mac:0079','write',hex='64 00',confirmed=True)
        self.assertEqual(self.ti.sent[-1],('block',0x44,b'\x79\x00\x64\x00'))
    def test_key_sizes_follow_revision_and_full_access(self):
        for rev,size in enumerate([8,8,8,16,24,28]):
            self.a.identity['profile']=f'r{rev}';self.ti.security=1
            self.run_command('mac:0035','write',hex='11 '*size,confirmed=True)
            self.assertEqual(len(self.ti.sent[-1][2]),size+2)
            with self.assertRaises(ValueError):self.run_command('mac:0035','write',hex='11 '*(size-1),confirmed=True)
        self.ti.security=2
        with self.assertRaisesRegex(ValueError,'FULL ACCESS'):self.run_command('mac:0037','write',hex='11 '*16,confirmed=True)
    def test_key_sequence_little_endian_no_read_between_words(self):
        self.run_command('key:UNSEAL','write',hex='34 12 78 56',confirmed=True)
        self.assertEqual(self.ti.sent,[('word',0,0x1234),('word',0,0x5678),('mac',0x54)])
    def test_df_boundary_echo_and_readback(self):
        result=self.run_command('df:RAW',address=0x4000,length=4)
        self.assertEqual(result['hex'],'00 01 02 03')
        with self.assertRaises(ValueError):self.run_command('df:RAW',address=0x5FFF,length=2)
        with self.assertRaises(ValueError):self.run_command('df:RAW','write',address=0x4000,length=2,hex='01',confirmed=True)
        result=self.run_command('df:RAW','write',address=0x4000,length=2,hex='34 12',confirmed=True)
        self.assertTrue(result['verified'])
        self.ti.bad_echo=True
        with self.assertRaisesRegex(RuntimeError,'echo'):self.run_command('df:RAW',address=0x4000,length=4)
    def test_rom_requires_full_access_and_only_exit_is_allowed(self):
        self.ti.security=1
        result=self.run_command('mac:0F00','write',confirmed=True)
        self.assertEqual(result['maintenance'],'ROM')
        with self.assertRaises(ValueError):self.run_command('sbs:0009')
        with self.assertRaises(RuntimeError):self.a.identify()
        result=self.run_command('rom:EXIT','write',confirmed=True)
        self.assertIsNone(result['maintenance']);self.assertEqual(self.ti.sent[-1],('command',8))
    def test_calibration_commands_are_not_reads_and_suspend_polling(self):
        with self.assertRaises(ValueError):self.run_command('mac:F081')
        result=self.run_command('mac:F081','write',confirmed=True)
        self.assertEqual(result['maintenance'],'calibration')
        with self.assertRaises(ValueError):self.run_command('mac:0051')
        self.assertIsNone(self.run_command('mac:F080','write',confirmed=True)['maintenance'])
    def test_catalog_integrity_and_known_fields(self):
        for rev,profile in CATALOG['profiles'].items():
            entries={e['id']:e for e in profile['commands']}
            self.assertEqual(len(entries),len(profile['commands']))
            self.assertGreater(len(entries),700)
            self.assertEqual(entries['mac:F081']['protocol'],'command')
            self.assertFalse(entries['mac:0037']['readable'])
            self.assertEqual(entries['mac:0056']['length'],3)
            self.assertEqual(entries['df:4000']['length'],2)
            for entry in entries.values():
                for bit in entry.get('bits',[]):self.assertLessEqual(bit['lo'],bit['hi'])
        self.assertTrue(next(e for e in CATALOG['profiles']['r2']['commands'] if e['id']=='mac:3008')['writable'])
        self.assertFalse(next(e for e in CATALOG['profiles']['r5']['commands'] if e['id']=='sbs:0049')['readable'])
        self.assertNotIn('mac:000A',{e['id'] for e in CATALOG['profiles']['r1']['commands']})

if __name__=='__main__':unittest.main()
