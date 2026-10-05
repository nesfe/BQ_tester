const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {EventEmitter}=require('node:events');

function harness() {
  const handlers=new Map(),calls=[],dialogs=[];
  let session;
  const catalog={identity:{name:'BQ40Z50-R5'},commands:[{id:'mac:001F',name:'CHG FET',kind:'mac',effect:'Toggles CHG FET'}, {id:'key:UNSEAL',name:'UNSEAL',kind:'key',sensitive:true}]};
  class FakeSession extends EventEmitter {
    constructor(){super();this.generation=1;session=this;}
    async command(op,data){calls.push({op,data});return op==='catalog'?catalog:{message:'Acknowledged'};}
  }
  const dialog={async showMessageBox(_window,options){dialogs.push(options);return {response:0};}};
  const electron={app:{whenReady:()=>new Promise(()=>{}),on:()=>{}},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},dialog};
  vm.runInNewContext(readFileSync(path.join(__dirname,'../main.js'),'utf8'),{
    require:name=>name==='electron'?electron:name==='./bridge/session'?{Session:FakeSession}:name==='./bridge/client'?{BridgeClient:class{}}:require(name),process,__dirname:path.join(__dirname,'..'),
  });
  return {handlers,calls,dialogs,dialog,session,execute:input=>handlers.get('battery-command')({},input)};
}

test('native cancellation does not execute commands even if renderer supplies confirmed=true',async()=>{
  const h=harness();
  const result=await h.execute({commandId:'mac:001F',action:'write',confirmed:true});
  assert.equal(result.cancelled,true);
  assert.deepEqual(h.calls.map(x=>x.op),['catalog']);
  assert.equal(h.dialogs[0].defaultId,0);
  assert.match(h.dialogs[0].detail,/Toggles CHG FET/);
});

test('connection change while confirmation is open cancels the write',async()=>{
  const h=harness();
  h.dialog.showMessageBox=async()=>{h.session.generation++;return {response:1};};
  await assert.rejects(h.execute({commandId:'mac:001F',action:'write'}),/Connection changed/);
  assert.equal(h.calls.filter(x=>x.op==='execute').length,0);
});

test('native confirmation sends one explicit write and does not expose secret payload',async()=>{
  const h=harness();
  h.dialog.showMessageBox=async(_window,options)=>{h.dialogs.push(options);return {response:1};};
  await h.execute({commandId:'key:UNSEAL',action:'write',hex:'34 12 78 56',extra:'ignored'});
  const writes=h.calls.filter(x=>x.op==='execute');assert.equal(writes.length,1);
  assert.equal(writes[0].data.confirmed,true);assert.equal(writes[0].data.extra,undefined);
  assert.ok(!h.dialogs[0].detail.includes('34 12 78 56'));
});

test('unknown commands and actions cannot be sent through IPC',async()=>{
  const h=harness();
  await assert.rejects(h.execute({commandId:'mac:DEAD',action:'write'}),/not supported/);
  await assert.rejects(h.execute({commandId:'mac:001F',action:'raw'}),/Invalid action/);
  assert.equal(h.dialogs.length,0);assert.equal(h.calls.filter(x=>x.op==='execute').length,0);
});
