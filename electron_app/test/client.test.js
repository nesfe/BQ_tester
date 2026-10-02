const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { BridgeClient } = require('../bridge/client');

function setup() {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => { child.killed = true; };
  const client = new BridgeClient({ spawnProcess: () => child });
  return { child, client };
}

test('JSON replies are framed across chunks and matched to request IDs', async () => {
  const { child, client } = setup();
  const first = client.request('sample');
  const second = client.request('scan');
  child.stdout.write('{"id":2,"result":[]}\n{"id":1,"res');
  child.stdout.write('ult":{"i":0}}\n');
  assert.deepEqual(await second, []);
  assert.deepEqual(await first, { i: 0 });
  client.fail(new Error('test complete'));
});

test('TI errors are propagated without replacing them with WriteFile errors', async () => {
  const { child, client } = setup();
  const reply = client.request('open');
  child.stdout.write('{"id":1,"error":"TI error 123: NACK"}\n');
  await assert.rejects(reply, /TI error 123: NACK/);
  client.fail(new Error('test complete'));
});

test('timeout kills bridge, rejects pending calls, and prohibits reuse', async () => {
  const { child, client } = setup();
  const reply = client.request('sample', {}, 10);
  await assert.rejects(reply, /timed out/);
  assert.equal(child.killed, true);
  await assert.rejects(client.request('sample'), /closed/);
});

test('child crash rejects outstanding reads', async () => {
  const { child, client } = setup();
  const reply = client.request('sample');
  child.emit('exit', 1, null);
  await assert.rejects(reply, /exited \(1\)/);
  assert.equal(client.pending.size, 0);
});
