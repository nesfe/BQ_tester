"""Build factual command/bit/address metadata from TI TRMs (pdftotext -layout).
Usage: python scripts/build_catalog.py /path/to/texts
No TI prose/manual is bundled. Entries link to the original section/page.
"""
import json,re,sys
from pathlib import Path
SLUGS=['sluua43a','sluubc1d','sluubk0b','sluubu5a','sluuch2','sluucn4b']
ROOT=Path(__file__).resolve().parents[1]
profiles={}
for rev,slug in enumerate(SLUGS):
 text=Path(sys.argv[1],f'r{rev}.txt').read_text()
 # Exclude TOC dotted leaders; headings are the authoritative command enumeration.
 heads=[m for m in re.finditer(r'(?m)^(\d+\.\d+(?:\.\d+)?)\s+(?:ManufacturerAccess\(\)\s+)?(0x[\dA-Fa-f]{2,4})\s+([^\n]+)$',text) if '...' not in m[0]]
 entries={}
 for i,m in enumerate(heads):
  section,addr,name=m.groups(); address=int(addr,16)
  kind='mac' if section.count('.')==2 else 'sbs'
  if address>=0x4000 and address not in (0xF080,0xF081,0xF082): continue
  if kind=='sbs' and address==0: continue
  body=text[m.end():heads[i+1].start() if i+1<len(heads) else m.end()+1200]
  name=name.strip().replace('()','')
  page=text[:m.start()].count('\f')+1
  # MAC summary tables, augmented by the actual per-command sections (some tables omit LED commands).
  row=next((line for line in text.splitlines() if re.match(r'^\s*'+re.escape(addr)+r'\s+',line,re.I) and re.search(r'\s(R/W|RW|R|W)\s+(Block|—)',line)), '') if kind=='mac' else ''
  if kind=='mac':
   columns=re.split(r'\s{2,}',row.strip())
   access=next((c for c in columns if c in ('R','W','R/W','RW')),None)
   access=access or ('W' if address in range(0x10,0x42) else 'R')
   if address==0x37: access='W' # AuthenticationKey has no direct key readback.
   if address in (0xF080,0xF081,0xF082): access='W' # Stateful calibration, never a background read.
   if address==0x3008: access='W'
   if address in (0xF1,0xF2): access='R' # Descriptive sections specify reads despite W in summary.
   protocol='block' if access!='W' or 'Block' in columns else 'command'
   ai=next((i for i,c in enumerate(columns) if c in ('R','W','R/W','RW')), -1)
   sealed=ai>=0 and len(columns)>ai+4 and columns[ai+4]=='Yes'
   if address==0x3008:protocol='block';sealed=True
  else:
   rows=[line for line in body.splitlines() if re.match(r'^\s*'+re.escape(addr)+r'\s+',line,re.I)]
   row=' '.join(rows)
   access='R/W' if 'R/W' in row else 'W' if re.search(r'\sW\s',row) else 'R'
   protocol='block' if 'Block' in row or re.search(r'read[- ]block|block read',body,re.I) else 'word'
   sealed=not bool(re.search(r'\b—\s+R',row))
  e=dict(id=f'{kind}:{address:04X}',kind=kind,address=address,name=name,section=section,page=page,
         access=access,protocol=protocol,sealed=sealed,readable='R' in access,writable='W' in access)
  # Single bits and multi-bit enumerations; no fabricated names for reserved fields.
  bits=[]
  for b in re.finditer(r'(?m)^\s*([A-Za-z][\w_]*(?:\[\w+\])?)\s*\(Bits?\s+(\d+)(?:[–−-](\d+))?\):\s*([^\n]*)',body):
   code,hi,lo,label=b.groups()
   if code.upper() in ('RSVD','RESERVED'): continue
   hi=int(hi);lo=int(lo or hi)
   hi,lo=max(hi,lo),min(hi,lo)
   if hi<64: bits.append(dict(code=code,hi=hi,lo=lo,label=label.strip()))
  if bits:e['bits']=bits
  if kind=='sbs':
   dtype=re.search(r'\b([UIHF][124]|S\d+)\b',row)
   e['dataType']=dtype[1] if dtype else 'raw'
   e['length']=2 if protocol=='word' else None
   if address in (0x20,0x21,0x22):e['dataType']='text'
   unit=re.split(r'\s{2,}',rows[0].strip())[-1] if rows else ''
   if unit and len(unit)<25 and not re.fullmatch(r'[0-9xA-Fa-f.-]+',unit):e['unit']=unit
   if address in (1,0xF,0x10,0x18):e['unit']='mAh / 10 mWh (BatteryMode.CAPM)'
   if address==4:e['unit']='mA / 10 mW (BatteryMode.CAPM)'
  else:
   e['length']=4 if address in range(0x50,0x55) else 3 if address in (0x55,0x56) else 2 if address in (1,3,4,5,6,8,9,0x57) else 11 if address==2 else None
  permissions=re.findall(r'(?<!\S)(R/W|RW|R|W|—)(?!\S)',row)
  e['writeSealed']=sealed if kind=='mac' else bool(permissions and 'W' in permissions[0])
  if kind=='mac' and address in (0xF080,0xF081,0xF082,0x8A): e['protocol']='command'
  if kind=='mac' and address==0x79:e['protocol']='block'; e['writeLength']=2; e['inputHint']='RSOC 0–100, unsigned little-endian word. Example 64 00 = 100%.'
  if kind=='mac' and address==0xB2:e['name']='ChargingCurrentOverride'
  if kind=='mac':
   write_lengths={0x35:[8,8,8,16,24,28][rev],0x37:16,0x79:2,0x7B:32,0x8B:3,0x9D:2,0x9E:2,0xB0:10,0xB2:30,0x3008:2}
   if address in write_lengths:e['writeLength']=write_lengths[address]
  e['sensitive']=kind=='mac' and address in (0x35,0x37) or kind=='sbs' and address==0x2F
  entries[e['id']]=e
 # Calibration output start shares a heading with stop; enumerate both commands.
 if 'mac:F080' in entries:
  entries['mac:F080']['name']='Exit calibration output'
  entries['mac:F081']={**entries['mac:F080'],'id':'mac:F081','address':0xF081,'name':'Output CC and ADC for calibration'}
 # Documented backwards-compatible reset and ROM entry aliases.
 for address,target in [(0x12,0x41),(0x33,0xF00)]:
  if f'0x{address:04X}' in text and f'mac:{target:04X}' in entries:
   entries[f'mac:{address:04X}']={**entries[f'mac:{target:04X}'],'id':f'mac:{address:04X}','address':address,'name':entries[f'mac:{target:04X}']['name']+' (compatibility alias)'}
 # Execution effects are authored separately from TI's factual register metadata.
 effects={0x1D:'Toggles the physical FUSE output; a connected chemical fuse can open irreversibly.',0x24:'Toggles permanent-failure protection. May persist across reset.',0x26:'Toggles firmware control of the fuse output. May persist across reset.',0x10:'Turns off charge/discharge FETs and enters shutdown; charger may be required to wake.',0x11:'Requests sleep when sleep conditions permit.',0x1E:'Toggles precharge FET in manufacturing test mode.',0x1F:'Toggles charge FET in manufacturing test mode.',0x20:'Toggles discharge FET in manufacturing test mode.',0x22:'Toggles firmware FET control; may persist across reset.',0x21:'Toggles gauging; may persist across reset.',0x28:'Erases lifetime history.',0x29:'Erases permanent-failure diagnostic history.',0x2A:'Erases black-box history.',0x30:'Seals the battery; known keys are needed to regain access.',0x35:'Reads or replaces access keys; a wrong key can prevent future access.',0x37:'Programs the 128-bit authentication key (FULL ACCESS required). Secure-memory provisioning is a separate TI procedure.',0x41:'Resets the gauge and interrupts telemetry.',0xF00:'Enters ROM; normal telemetry stops until ROM exit. Firmware flashing is a separate procedure.',0x79:'Temporarily overrides RSOC until the next gauging simulation.',0x8A:'Reloads the external TMP468 sensor configuration.',0xB0:'Overrides charging voltages; changes may persist in flash.',0xB2:'Overrides charging currents; changes may persist in flash.',0xF081:'Starts raw calibration output and suspends normal telemetry.',0xF082:'Starts calibration output with internally shorted current inputs; telemetry is suspended.',0xF080:'Stops calibration output and resumes telemetry.'}
 for entry in entries.values():
  effect_address={0x12:0x41,0x33:0xF00}.get(entry['address'],entry['address'])
  if entry['kind']=='mac' and effect_address in effects:entry['effect']=effects[effect_address]
 # Direct block status aliases use the same bit layouts as MAC, but keep distinct addresses/protocols.
 for e in list(entries.values()):
  if e['kind']=='sbs' and f"mac:{e['address']:04X}" in entries:
   mac=entries[f"mac:{e['address']:04X}"]
   if 'bits' in mac:e['bits']=mac['bits']
   if e['protocol']=='block':e['length']=mac.get('length')
 entries['sbs:0000']=dict(id='sbs:0000',kind='sbs',address=0,name='ManufacturerAccess (OperationStatus low word)',section=f'{heads[0][1].split(".")[0]}.1',page=heads[0].start() and text[:heads[0].start()].count('\f')+1,access='R',protocol='word',sealed=True,readable=True,writable=False,length=2,dataType='H2')
 # Data flash summary: every named physical address is independently accessible.
 for m in re.finditer(r'(?m)^([^\n]*?)\b(0x[4-5][0-9A-Fa-f]{3})\s+(.+?)\s{2,}([UIHF][124]|S\d+)\s+([^\n]+)$',text):
  prefix,addr,name,dtype,tail=m.groups(); address=int(addr,16)
  if ' ' not in name and name.startswith('0x'):continue
  length=int(dtype[1:])
  entries[f'df:{address:04X}']=dict(id=f'df:{address:04X}',kind='df',address=address,name=name.strip(),group=' / '.join(re.split(r'\s{2,}',prefix.strip())),dataType=dtype,length=length,access='R/W',protocol='block',sealed=False,readable=True,writable=True,page=text[:m.start()].count('\f')+1,section='Data Flash Table',unit=re.split(r'\s{2,}',tail.strip())[-1])
 # Operations documented outside the command list.
 for name in ['UNSEAL','FULL_ACCESS','KEY_SEQUENCE']:
  entries['key:'+name]=dict(id='key:'+name,kind='key',address=0,name=name,access='W',protocol='keys',sealed=True,readable=False,writable=True,length=4,section='Security',page=1)
 entries['rom:EXIT']=dict(id='rom:EXIT',kind='rom',address=8,name='Return from ROM to firmware',access='W',protocol='command',sealed=False,readable=False,writable=True,section='ROM Mode',page=1)
 # Documented read/write access to any DF address, including fields not split by text extraction.
 entries['df:RAW']=dict(id='df:RAW',kind='df',address=None,name='Data Flash address range 0x4000–0x5FFF',access='R/W',protocol='block',sealed=False,readable=True,writable=True,section='Data Flash Access',page=1)
 profiles[f'r{rev}']=dict(revision=rev,name='BQ40Z50'+(f'-R{rev}' if rev else ''),source=f'https://www.ti.com/lit/ug/{slug}/{slug}.pdf',commands=sorted(entries.values(),key=lambda e:(e['kind'],e['address'] or 0,e['id'])))
 print(rev,{kind:sum(e['kind']==kind for e in entries.values()) for kind in ['sbs','mac','df','key','rom']})
# One entry per line keeps generated changes reviewable without a huge pretty-print diff.
chunks=['{\n  "schema": 1,\n  "profiles": {']
for key,profile in profiles.items():
 metadata={k:v for k,v in profile.items() if k!='commands'}
 header=json.dumps(metadata,ensure_ascii=False)[:-1]
 commands=',\n'.join('        '+json.dumps(e,ensure_ascii=False) for e in profile['commands'])
 chunks.append('    '+json.dumps(key)+': '+header+', "commands": [\n'+commands+'\n    ]}'+(',' if key!='r5' else ''))
chunks.append('  }\n}\n')
(ROOT/'bridge/catalog.json').write_text('\n'.join(chunks))
