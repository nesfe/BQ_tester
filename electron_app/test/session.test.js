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
