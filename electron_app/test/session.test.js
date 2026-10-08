const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Session } = require('../bridge/session');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('polling never overlaps slow USB reads and stops after disconnect', async () => {
  let running = 0, maximum = 0, reads = 0, closed = 0;
  const bridge = {
    async request(op) {
      if (op === 'open') return {};
      reads++; maximum = Math.max(maximum, ++running);
      await delay(25); running--;
      return { hasValidData: true };
    },
    async close() { closed++; },
  };
  const session = new Session(() => bridge, 1);
  let received = 0;
  session.on('telemetry', () => received++);
  await session.connect({});
  await delay(65);
  await session.disconnect();
  const before = received, beforeReads = reads;
  await delay(40);
  assert.equal(maximum, 1);
  assert.equal(received, before);
  assert.equal(reads, beforeReads);
  assert.equal(closed, 1);
});

test('failed battery handshake rejects connection and closes adapter', async () => {
  let closed = 0;
  const session = new Session(() => ({
    request: async () => { throw new Error('TI error 123: NACK'); },
    close: async () => { closed++; },
  }));
  await assert.rejects(session.connect({}), /NACK/);
  assert.equal(session.bridge, null);
  assert.equal(session.timer, null);
  assert.equal(closed, 1);
});

test('disconnect during handshake cannot restart polling', async () => {
  let finish;
  const session = new Session(() => ({
    request: () => new Promise(resolve => { finish = resolve; }),
    close: async () => {},
  }));
  let connected = false;
  session.on('state', state => { connected = state.connected; });
  const pending = session.connect({});
  await session.disconnect();
  finish({});
  await assert.rejects(pending, /cancelled/);
  assert.equal(connected, false);
  assert.equal(session.timer, null);
});

test('loss of all telemetry disconnects and preserves hardware error', async () => {
  let closed = false;
  const session = new Session(() => ({
    request: async op => op === 'open' ? {} : { hasValidData: false, errors: { v: 'USB unplugged' } },
    close: async () => { closed = true; },
  }), 1);
  const failed = new Promise(resolve => session.on('state', state => { if (!state.connected) resolve(state); }));
  await session.connect({});
  const state = await failed;
  await delay(0);
  assert.match(state.message, /USB unplugged/);
  assert.equal(closed, true);
  assert.equal(session.bridge, null);
});

test('bridge startup failure leaves connection retryable', async () => {
  const session = new Session(() => { throw new Error('Unable to spawn bridge'); });
  await assert.rejects(session.connect({}), /Unable to spawn/);
  assert.equal(session.connecting, false);
  assert.equal(session.bridge, null);
});

test('management commands serialize with polling and block late work after reconnect', async () => {
  let running=0, max=0;
  const calls=[];
  const bridge={async request(op) {
    calls.push(op); max=Math.max(max,++running); await delay(4);running--;
    return op==='sample' ? {hasValidData:true} : {};
  },async close(){}};
  const s=new Session(() => bridge,1);
  await s.connect({});
  await Promise.all([s.command('execute',{action:'read'}),s.command('execute',{action:'read'})]);
  assert.equal(max,1);
  assert.equal(calls.filter(x=>x==='execute').length,2);
  await s.disconnect();
  await assert.rejects(s.command('execute'),/not connected/);
});

test('ROM maintenance pauses polling until explicit exit; failed writes are not retried', async () => {
  let samples=0,writes=0;
  const s=new Session(() => ({async request(op,data) {
    if(op==='sample'){samples++;return {hasValidData:true};}
    if(op==='execute'){writes++;if(data.fail)throw new Error('NACK');return {maintenance:data.exit?null:'ROM'};}
    return {};
  },async close(){}}),1);
  await s.connect({});
  await s.command('execute',{action:'write'});
  const before=samples;await delay(15);assert.equal(samples,before);
  await s.command('execute',{action:'write',exit:true});await delay(15);assert.ok(samples>before);
  await assert.rejects(s.command('execute',{action:'write',fail:true}),/NACK/);
  const stopped=samples;await delay(15);assert.equal(samples,stopped);assert.equal(writes,3);
  await s.disconnect();
});

test('completion of an old command cannot cancel polling in a new connection', async () => {
  let finish, samples=0;
  const bridge={async request(op) {
    if(op==='execute')return new Promise(resolve=>{finish=resolve;});
    if(op==='sample'){samples++;return {hasValidData:true};}
    return {};
  },async close(){}};
  const s=new Session(()=>bridge,1);await s.connect({});
  const old=s.command('execute',{action:'read'});
  const rejected=assert.rejects(old,/Connection changed/);
  await delay(0);await s.disconnect();await s.connect({});
  finish({});await rejected;await delay(15);
  assert.ok(samples>0);assert.equal(s.commandsPending,0);
  await s.disconnect();
});
