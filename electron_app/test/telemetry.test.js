const { test } = require('node:test');
const assert = require('node:assert/strict');
const helpers = import('../src/utils/telemetry.mjs');
const flags = [
  { field: 'sf', type: 'safety', flags: [{ bit: 4, code: 'OCD1', label: 'Overcurrent discharge', severity: 'danger' }] },
  { field: 'op', type: 'operation', flags: [{ bit: 28, code: 'CB', label: 'Balancing', severity: 'info' }] },
];
const point = (sequence, extra = {}) => ({ sequence, timestamp: 1000 + sequence * 100, timeStr: '00:00:01.000', i: -1234, sf: 0, op: 0, ...extra });

test('initial active flags are observations, not invented rising edges', async () => {
  const { detectTransitions } = await helpers;
  const previous = { sf: null, op: null };
  const events = detectTransitions(point(1, { sf: 16, op: 1 << 28 }), previous, flags);
  assert.deepEqual(events.map(e => e.state), ['INITIAL', 'INITIAL']);
  assert.equal(events[1].rawHex, '0x10000000');
  assert.equal(events[0].timestamp, 1100);
  assert.equal(events[0].currentMa, -1234);
  assert.deepEqual(detectTransitions(point(2, { sf: 16, op: 1 << 28 }), previous, flags), []);
});

test('assert and clear markers preserve sample time, signed current, and simultaneous triggers', async () => {
  const { detectTransitions } = await helpers;
  const previous = { sf: 0, op: 0 };
  const events = detectTransitions(point(3, { sf: 16, op: 1 << 28 }), previous, flags);
  assert.deepEqual(events.map(e => e.code), ['OCD1', 'CB']);
  assert.ok(events.every(e => e.state === 'ASSERTED' && e.timestamp === 1300 && e.currentMa === -1234));
  assert.equal(new Set(events.map(e => e.id)).size, 2);
  const cleared = detectTransitions(point(4, { i: 0 }), previous, flags);
  assert.ok(cleared.every(e => e.state === 'CLEARED' && e.currentMa === 0));
});

test('unknown register and reconnect do not fabricate cleared events', async () => {
  const { detectTransitions } = await helpers;
  const previous = { sf: 16, op: 1 << 28 };
  assert.deepEqual(detectTransitions(point(1, { sf: null, op: null }), previous, flags), []);
  assert.equal(previous.sf, 16);
  assert.deepEqual(detectTransitions(point(2), { sf: null, op: null }, flags), []);
});

test('coalescing render batches preserves samples and bounds history/event memory', async () => {
  const { appendBounded } = await helpers;
  assert.deepEqual(appendBounded([1, 2], [3, 4], 4), [1, 2, 3, 4]);
  assert.deepEqual(appendBounded([1, 2], [3, 4, 5], 4), [2, 3, 4, 5]);
  assert.deepEqual(appendBounded([1], [2, 3, 4, 5, 6], 3), [4, 5, 6]);
});

test('recording appends in place, retains all samples, and does not copy on every tick', async () => {
  const { RecordingBuffer } = await helpers;
  const recording = new RecordingBuffer();
  const storage = recording.getData();
  for (let n = 0; n < 36000; n++) recording.append(point(n));
  assert.equal(recording.getData(), storage);
  assert.equal(recording.length, 36000);
  assert.equal(recording.getData().at(-1).sequence, 35999);
});

test('time window uses timestamps rather than assuming a fixed acquisition frequency', async () => {
  const { visiblePoints } = await helpers;
  const history = [0, 9000, 11000, 17000, 20000, 25000].map(timestamp => ({ timestamp }));
  assert.deepEqual(visiblePoints(history, 20000).map(p => p.timestamp), [9000, 11000, 17000, 20000]);
  assert.deepEqual(visiblePoints(history, 40000), []);
});

test('current scale includes zero, preserves negative current, and ignores missing cells', async () => {
  const { valueDomain } = await helpers;
  const domain = valueDomain([{ i: -2000 }, { i: 0 }, { i: null }], ['i'], true);
  assert.ok(domain[0] < -2 && domain[1] > 0);
  assert.deepEqual(valueDomain([{ c1: 3700, c2: null }], ['c1', 'c2']), [3680, 3720]);
  assert.deepEqual(valueDomain([{ i: null }], ['i'], true), [-1, 1]);
});

test('tooltip selects real nearest samples, including timestamp boundaries', async () => {
  const { nearestPoint } = await helpers;
  const points = [100, 200, 500].map(timestamp => ({ timestamp }));
  assert.equal(nearestPoint(points, 270).timestamp, 200);
  assert.equal(nearestPoint(points, -1).timestamp, 100);
  assert.equal(nearestPoint(points, 999).timestamp, 500);
  assert.equal(nearestPoint([], 1), null);
});

test('protection assertion wins marker color over simultaneous cleared flags', async () => {
  const { markerColor, eventText } = await helpers;
  assert.equal(markerColor([{ type: 'safety', state: 'ASSERTED' }, { type: 'operation', state: 'CLEARED' }]), '#ef4444');
  assert.equal(markerColor([{ type: 'safety', state: 'CLEARED' }]), '#10b981');
  assert.match(eventText({ code: 'DSG', state: 'INITIAL', label: 'Discharge' }), /already active/);
});
