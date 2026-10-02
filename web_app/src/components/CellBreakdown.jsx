import React from 'react';
import { Battery, Zap, AlertTriangle, CheckCircle2 } from 'lucide-react';

export function CellBreakdown({ telemetry }) {
  if (!telemetry) return null;

  const cells = [
    { id: 1, name: 'Cell 1', voltage: telemetry.c1, color: '#6366f1' },
    { id: 2, name: 'Cell 2', voltage: telemetry.c2, color: '#10b981' },
    { id: 3, name: 'Cell 3', voltage: telemetry.c3, color: '#f59e0b' },
    { id: 4, name: 'Cell 4', voltage: telemetry.c4, color: '#ec4899' },
  ];

  const voltages = cells.map(c => c.voltage);
  const maxV = Math.max(...voltages);
  const minV = Math.min(...voltages);
  const avgV = Math.round(voltages.reduce((a, b) => a + b, 0) / 4);
  const isCbActive = (telemetry.op & (1 << 5)) !== 0;

  // Percentage scaling for cell visual bar (nominal 3000mV to 4200mV range)
  const getPercent = (v) => Math.max(0, Math.min(100, ((v - 3000) / 1200) * 100));

  return (
    <div className="panel-box">
      <div className="panel-header">
        <h3 className="panel-title">
          <Battery size={18} className="text-indigo" /> 4-Series Cell Voltage Analysis
        </h3>
        {isCbActive ? (
          <span className="badge badge-info pulsing">
            <Zap size={12} /> Cell Balancing Active (CB)
          </span>
        ) : (
          <span className="badge badge-neutral">CB Standby</span>
        )}
      </div>

      <div className="cell-grid">
        {cells.map(cell => {
          const isMax = cell.voltage === maxV && maxV !== minV;
          const isMin = cell.voltage === minV && maxV !== minV;
          const deltaFromAvg = cell.voltage - avgV;
          const percent = getPercent(cell.voltage);

          return (
            <div key={cell.id} className={`cell-card ${isMax ? 'border-max' : isMin ? 'border-min' : ''}`}>
              <div className="cell-card-header">
                <span className="cell-name" style={{ color: cell.color }}>
                  {cell.name}
                </span>
                {isMax && <span className="tag tag-max">MAX</span>}
                {isMin && <span className="tag tag-min">MIN</span>}
              </div>

              <div className="cell-voltage-big">
                {cell.voltage} <span className="unit-sm">mV</span>
              </div>

              <div className="cell-bar-container">
                <div
                  className="cell-bar-fill"
                  style={{ width: `${percent}%`, backgroundColor: cell.color }}
                />
              </div>

              <div className="cell-meta">
                <span className="subtext">
                  {(cell.voltage / 1000.0).toFixed(3)} V
                </span>
                <span className={`delta-tag ${deltaFromAvg >= 0 ? 'text-green' : 'text-orange'}`}>
                  {deltaFromAvg >= 0 ? `+${deltaFromAvg}` : deltaFromAvg} mV
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
