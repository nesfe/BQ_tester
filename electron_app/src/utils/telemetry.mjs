// Plain data helpers shared by the renderer and regression tests.
export const HISTORY_LIMIT = 2000;
export const EVENT_LIMIT = 1000;
export const WINDOW_MS = 10000;

export function formatTime(timestamp) {
  const time = new Date(timestamp);
  return time.toTimeString().slice(0, 8) + '.' + String(time.getMilliseconds()).padStart(3, '0');
}

export function detectTransitions(point, previous, groups) {
  const events = [];
  for (const { field, type, flags } of groups) {
    const value = point[field];
    if (!Number.isInteger(value)) continue; // Unknown is not a cleared protection.
    const before = previous[field];
    for (const flag of flags) {
      const active = (value & (1 << flag.bit)) !== 0;
      const wasActive = before != null && (before & (1 << flag.bit)) !== 0;
      if (before == null ? !active : active === wasActive) continue;
      const state = before == null ? 'INITIAL' : active ? 'ASSERTED' : 'CLEARED';
      events.push({
        id: `${point.sequence}:${field}:${flag.bit}`,
        type, state, code: flag.code, label: flag.label, desc: flag.desc,
        severity: state === 'CLEARED' ? 'success' : flag.severity,
        rawHex: `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
        timestamp: point.timestamp, timeStr: point.timeStr, currentMa: point.i,
      });
    }
    previous[field] = value;
  }
  return events;
}

export function appendBounded(previous, additions, limit) {
  return previous.slice(Math.max(0, previous.length + additions.length - limit))
    .concat(additions.slice(-limit));
}

// Record append is O(1); materialize CSV only when the user asks for it.
export class RecordingBuffer {
  constructor() { this.clear(); }
  clear() { this.points = []; }
  append(point) { this.points.push(point); }
  get length() { return this.points.length; }
  getData() { return this.points; }
}

export function visiblePoints(history, end, windowMs = WINDOW_MS) {
  const start = end - windowMs;
  // Keep one predecessor so a line crossing the left edge is clipped correctly.
  let first = history.findIndex(point => point.timestamp >= start);
  if (first < 0) return [];
  first = Math.max(0, first - 1);
  return history.slice(first).filter(point => point.timestamp <= end);
}

export function valueDomain(points, fields, current = false) {
  let min = Infinity, max = -Infinity;
  for (const point of points) for (const field of fields) {
    const value = point[field];
    if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
  }
  if (min === Infinity) return current ? [-1, 1] : [3000, 4200];
  if (current) { min /= 1000; max /= 1000; }
  // Fit the measured range, including milliamp changes far from zero.
  // The 0.1 mA floor only prevents a degenerate scale for a constant signal.
  const padding = current ? Math.max(0.0001, (max - min) * 0.1) : 20;
  return [min - padding, max + padding];
}

export function formatCurrentTick(value, span) {
  const step = Math.max(Math.abs(span) / 4, 0.000001);
  const digits = Math.min(6, Math.max(0, Math.ceil(-Math.log10(step)) + 1));
  return String(Number(value.toFixed(digits)));
}

export function nearestPoint(points, timestamp) {
  if (!points.length) return null;
  let low = 0, high = points.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].timestamp < timestamp) low = mid + 1;
    else high = mid;
  }
  const right = points[low], left = points[low - 1];
  return left && timestamp - left.timestamp <= right.timestamp - timestamp ? left : right;
}

export function markerColor(events) {
  if (events.some(event => event.type === 'safety' && event.state === 'ASSERTED')) return '#ef4444';
  if (events.some(event => event.state === 'ASSERTED')) return '#f59e0b';
  if (events.every(event => event.state === 'CLEARED')) return '#10b981';
  return '#9ca3af';
}

export function eventText(event) {
  const state = { ASSERTED: 'ON', CLEARED: 'OFF', INITIAL: 'already active' }[event.state];
  return `${event.code} ${state} — ${event.label}`;
}
