import React from 'react';

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

  const getPercent = (v) => Math.max(0, Math.min(100, ((v - 3000) / 1200) * 100));

  return (
    <div className="panel-box">
      <div className="panel-header">
        <h3 className="panel-title">4-Series Cell Voltage Analysis</h3>
      </div>
      <div className="cell-grid">
        {cells.map(cell => {
          const deltaFromAvg = cell.voltage - avgV;
          const percent = getPercent(cell.voltage);

          return (
            <div key={cell.id} className="cell-card">
              <div className="cell-name" style={{ color: cell.color }}>{cell.name}</div>
              <div className="cell-voltage-big">{cell.voltage} <span className="unit-sm">mV</span></div>
              <div className="cell-bar-container">
                <div className="cell-bar-fill" style={{ width: `${percent}%`, backgroundColor: cell.color }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
