import React, { memo, useEffect, useRef, useState } from 'react';
import { WINDOW_MS, visiblePoints, valueDomain, nearestPoint, formatTime, markerColor, eventText } from '../utils/telemetry.mjs';

const CURRENT = [{ field: 'i', label: 'Pack Current', color: '#6366f1' }];
const CELLS = [
  { field: 'c1', label: 'Cell 1', color: '#6366f1' },
  { field: 'c2', label: 'Cell 2', color: '#10b981' },
  { field: 'c3', label: 'Cell 3', color: '#f59e0b' },
  { field: 'c4', label: 'Cell 4', color: '#ec4899' },
];
const LEFT = 65, RIGHT = 5, TOP = 5, BOTTOM = 35, HEIGHT = 200;

// The canvas owns the animation clock. React renders controls/tooltips, not every frame.
export const StreamingChart = memo(function StreamingChart({ history, current = false, running }) {
  const canvasRef = useRef(null);
  const plotRef = useRef(null);
  const model = useRef({ history, running, receivedAt: performance.now() });
  const view = useRef(null);
  const pointer = useRef(null);
  const selected = useRef(null);
  const interaction = useRef(0);
  const [tooltip, setTooltip] = useState(null);
  const tooltipId = useRef(null);
  useEffect(() => {
    const latest = history.at(-1);
    const previous = model.current;
    const changed = latest !== previous.history.at(-1);
    const now = performance.now();
    const frozenEnd = changed ? latest?.timestamp : previous.running && !running
      ? (latest?.timestamp || 0) + Math.max(0, now - previous.receivedAt)
      : previous.frozenEnd;
    model.current = { history, running, receivedAt: changed ? now : previous.receivedAt, frozenEnd };
    // A paused view cannot retain a tooltip from a cleared/replaced session.
    if (!history.includes(selected.current)) {
      selected.current = null;
      tooltipId.current = null;
      setTooltip(null);
    }
  }, [history, running]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const buffer = plotRef.current;
    const context = buffer.getContext('2d');
    const output = canvas.getContext('2d');
    const series = current ? CURRENT : CELLS;
    let width = 0, dpr = 1, frame, cachedHistory, cachedPoints = [], domain;
    let visible = true, lastEnd = null, lastHistory = null;
    let renderedEnd = null, renderedHistory = null, resized = true, baseEnd = null, drawnInteraction = -1;
    const resize = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(HEIGHT * dpr);
      buffer.width = canvas.width; buffer.height = canvas.height;
      buffer.style.width = `${width}px`; buffer.style.height = `${HEIGHT}px`;
      lastEnd = null; baseEnd = null; resized = true;
    });
    resize.observe(canvas);
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    intersection.observe(canvas);

    const show = (point, x) => {
      selected.current = point;
      if (tooltipId.current === point?.sequence) return;
      tooltipId.current = point?.sequence;
      setTooltip(point ? { point, x } : null);
    };
    // The browser composites this translation without repainting paths/text at 60 Hz.
    // Rasterize the plot and fixed axes only when a sample or interaction changes.
    function present(end) {
      const shift = (end - renderedEnd) / WINDOW_MS * (width - LEFT - RIGHT);
      buffer.style.transform = `translateX(${-shift}px)`;
      if (view.current) {
        view.current.end = end;
        view.current.x = timestamp => LEFT + (timestamp - (end - WINDOW_MS)) / WINDOW_MS * (width - LEFT - RIGHT);
      }
      if (baseEnd === renderedEnd) return;
      baseEnd = renderedEnd;
      output.setTransform(dpr, 0, 0, dpr, 0, 0);
      output.clearRect(0, 0, width, HEIGHT);
      output.drawImage(buffer, 0, 0, LEFT * dpr, HEIGHT * dpr, 0, 0, LEFT, HEIGHT);
      output.strokeStyle = '#262626'; output.lineWidth = 1; output.setLineDash([3, 3]);
      for (let tick = 0; tick <= 4; tick++) {
        const py = TOP + (HEIGHT - TOP - BOTTOM) * tick / 4;
        output.beginPath(); output.moveTo(LEFT, py); output.lineTo(width - RIGHT, py); output.stroke();
      }
      output.setLineDash([]);
      output.strokeStyle = '#737373';
      output.beginPath(); output.moveTo(LEFT, HEIGHT - BOTTOM); output.lineTo(width - RIGHT, HEIGHT - BOTTOM); output.stroke();
    }
    function draw(now) {
      frame = requestAnimationFrame(draw);
      if (!visible || document.hidden || width <= LEFT + RIGHT) return;
      const { history: data, running: live, receivedAt, frozenEnd } = model.current;
      const latest = data.at(-1);
      const end = latest ? (live ? latest.timestamp + Math.max(0, now - receivedAt) : frozenEnd ?? latest.timestamp) : 0;
      if (!resized && drawnInteraction === interaction.current && lastEnd === end && lastHistory === data) return;
      const interactionChanged = drawnInteraction !== interaction.current;
      lastEnd = end; lastHistory = data;
      if (!resized && !interactionChanged && renderedHistory === data && Math.abs(end - renderedEnd) < 1000) {
        present(end);
        return;
      }
      resized = false;
      drawnInteraction = interaction.current;
      // Compute domains only on acquisition, not on every animation frame.
      if (cachedHistory !== data) {
        cachedHistory = data;
        cachedPoints = latest ? visiblePoints(data, latest.timestamp) : [];
        domain = valueDomain(cachedPoints, series.map(item => item.field), current);
      }
      const points = cachedPoints;
      const [min, max] = domain || (current ? [-1, 1] : [3000, 4200]);
      const plotWidth = width - LEFT - RIGHT, plotHeight = HEIGHT - TOP - BOTTOM;
      const x = timestamp => LEFT + (timestamp - (end - WINDOW_MS)) / WINDOW_MS * plotWidth;
      const y = value => TOP + (max - value) / (max - min) * plotHeight;
      view.current = { points, end, width, x, y, plotWidth };
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, HEIGHT);
      context.font = '11px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
      context.lineWidth = 1;
      context.setLineDash([3, 3]);
      context.textAlign = 'right';
      for (let tick = 0; tick <= 4; tick++) {
        const value = min + (max - min) * tick / 4;
        const py = y(value);
        context.strokeStyle = '#262626';
        context.fillStyle = '#737373';
        context.fillText(`${current ? Number(value.toFixed(2)) : Math.round(value)}${current ? ' A' : ' mV'}`, LEFT - 7, py + 4);
      }
      context.textAlign = 'center';
      if (latest) for (let timestamp = Math.ceil((end - WINDOW_MS) / 2000) * 2000; timestamp <= end; timestamp += 2000) {
        const px = x(timestamp);
        context.strokeStyle = '#262626';
        context.beginPath(); context.moveTo(px, TOP); context.lineTo(px, HEIGHT - BOTTOM); context.stroke();
        context.fillStyle = '#737373';
        if (px > LEFT + 25 && px < width - 25) context.fillText(formatTime(timestamp).slice(0, 8), px, HEIGHT - BOTTOM + 15);
      }
      context.setLineDash([]);
      context.strokeStyle = '#737373';
      context.beginPath(); context.moveTo(LEFT, TOP); context.lineTo(LEFT, HEIGHT - BOTTOM);
      context.lineTo(width - RIGHT, HEIGHT - BOTTOM); context.stroke();
      context.save();
      context.beginPath(); context.rect(LEFT, TOP, plotWidth, plotHeight); context.clip();
      if (current) {
        context.strokeStyle = '#ef4444'; context.setLineDash([3, 3]);
        context.beginPath(); context.moveTo(LEFT, y(0)); context.lineTo(width - RIGHT, y(0)); context.stroke();
        context.setLineDash([]);
      }
      for (const { field, color } of series) {
        let segment = [];
        const flush = () => {
          if (!segment.length) return;
          context.beginPath();
          segment.forEach((point, index) => {
            const px = x(point.timestamp), py = y(current ? point[field] / 1000 : point[field]);
            if (index === 0) context.moveTo(px, py); else context.lineTo(px, py);
          });
          context.strokeStyle = color; context.lineWidth = current ? 1 : 2; context.stroke();
          if (segment.length === 1) {
            context.beginPath(); context.arc(x(segment[0].timestamp), y(current ? segment[0][field] / 1000 : segment[0][field]), 2, 0, Math.PI * 2);
            context.fillStyle = color; context.fill();
          }
          if (current && segment.length > 1) {
            context.lineTo(x(segment.at(-1).timestamp), y(0)); context.lineTo(x(segment[0].timestamp), y(0));
            context.closePath(); context.fillStyle = '#6366f133'; context.fill();
          }
          segment = [];
        };
        for (const point of points) {
          if (!Number.isFinite(point[field])) { flush(); continue; }
          // Don't draw a fictitious signal across paused/missing acquisition intervals.
          if (segment.length && point.timestamp - segment.at(-1).timestamp > 1000) flush();
          segment.push(point);
        }
        flush();
      }
      if (current) {
        let lastLabelRight = -Infinity, lane = 0;
        for (const point of points) {
          if (!point.events?.length || point.timestamp < end - WINDOW_MS) continue;
          const px = x(point.timestamp), color = markerColor(point.events);
          context.lineWidth = 1; context.strokeStyle = color; context.setLineDash([2, 3]);
          context.beginPath(); context.moveTo(px, TOP); context.lineTo(px, HEIGHT - BOTTOM); context.stroke();
          context.setLineDash([]);
          const py = Number.isFinite(point.i) ? y(point.i / 1000) : TOP + 8;
          context.beginPath(); context.arc(px, py, 4, 0, Math.PI * 2); context.fillStyle = color; context.fill();
          lane = px < lastLabelRight ? (lane + 1) % 3 : 0;
          const first = point.events[0];
          const label = `${first.code} ${first.state === 'INITIAL' ? '•' : first.state === 'ASSERTED' ? '↑' : '↓'}${point.events.length > 1 ? ` +${point.events.length - 1}` : ''}`;
          const labelWidth = context.measureText(label).width + 8;
          const labelX = Math.max(LEFT, Math.min(px + 5, width - labelWidth - RIGHT));
          context.fillStyle = '#0f1218e6'; context.fillRect(labelX, TOP + lane * 16, labelWidth, 15);
          context.fillStyle = color; context.textAlign = 'left'; context.fillText(label, labelX + 4, TOP + 11 + lane * 16);
          lastLabelRight = labelX + labelWidth;
        }
      }
      const cursor = pointer.current;
      let hovered = selected.current;
      if (cursor) {
        const timestamp = end - WINDOW_MS + (cursor.x - LEFT) / plotWidth * WINDOW_MS;
        // Prefer nearby event markers so grouped triggers can always be inspected.
        const marker = current ? points.find(point => point.events?.length && Math.abs(x(point.timestamp) - cursor.x) < 8) : null;
        hovered = marker || nearestPoint(points, timestamp);
        if (hovered && (hovered.timestamp < end - WINDOW_MS || Math.abs(x(hovered.timestamp) - cursor.x) > 25)) hovered = null;
        show(hovered, cursor.x);
      }
      if (hovered && hovered.timestamp >= end - WINDOW_MS && hovered.timestamp <= end) {
        context.strokeStyle = '#9ca3af'; context.lineWidth = 1;
        context.beginPath(); context.moveTo(x(hovered.timestamp), TOP); context.lineTo(x(hovered.timestamp), HEIGHT - BOTTOM); context.stroke();
      } else if (!cursor && selected.current) show(null);
      context.restore();
      renderedEnd = end; renderedHistory = data;
      present(end);
    }
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); resize.disconnect(); intersection.disconnect(); };
  }, [current]);

  const onKeyDown = event => {
    if (event.key === 'Escape') { clearSelection(); return; }
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || !view.current) return;
    event.preventDefault();
    const { points, end, x } = view.current;
    const candidates = points.filter(point => point.timestamp >= end - WINDOW_MS && (!current || point.events?.length));
    if (!candidates.length) return;
    const old = candidates.indexOf(selected.current);
    const index = old < 0 ? candidates.length - 1 : Math.max(0, Math.min(candidates.length - 1, old + (event.key === 'ArrowLeft' ? -1 : 1)));
    const point = candidates[index];
    interaction.current++;
    selected.current = point; tooltipId.current = point.sequence; pointer.current = null;
    setTooltip({ point, x: x(point.timestamp) });
  };

  const clearSelection = () => {
    interaction.current++;
    pointer.current = null; selected.current = null; tooltipId.current = null; setTooltip(null);
  };

  return (
    <div className="streaming-chart">
      <canvas ref={canvasRef} style={{ width: '100%', height: HEIGHT, display: 'block' }}
        role="img" tabIndex={0}
        aria-label={current ? 'Pack Current (A), 10-second window. Hover markers or use arrow keys to inspect observed triggers.' : 'Individual Cell Voltages (mV), 10-second window.'}
        onPointerMove={event => { const rect = event.currentTarget.getBoundingClientRect(); pointer.current = { x: event.clientX - rect.left }; interaction.current++; }}
        onPointerLeave={clearSelection}
        onBlur={clearSelection}
        onKeyDown={onKeyDown}
      />
      <div className="streaming-plot-clip" aria-hidden="true">
        <canvas ref={plotRef} className="streaming-plot-layer" />
      </div>
      {tooltip && (
        <div className="chart-tooltip" role="tooltip" style={{ left: Math.max(0, Math.min(tooltip.x + 12, (view.current?.width || 300) - 290)) }}>
          <div>{tooltip.point.timeStr}</div>
          {(current ? CURRENT : CELLS).map(({ field, label, color }) => (
            <div key={field} style={{ color }}>{label}: {tooltip.point[field] == null ? 'N/A' : current ? `${(tooltip.point[field] / 1000).toFixed(3)} A` : `${tooltip.point[field]} mV`}</div>
          ))}
          {current && tooltip.point.events?.map(event => <div key={event.id}>{eventText(event)}<br />{event.rawHex}</div>)}
          {current && tooltip.point.events?.length > 0 && <small>Observed during this poll; not the exact hardware trip time.</small>}
        </div>
      )}
    </div>
  );
});
