import React, { memo } from 'react';
import { Pause, Play, RefreshCw } from 'lucide-react';
import { StreamingChart } from './StreamingChart';

export const ChartsSection = memo(function ChartsSection({ history, isPaused, setIsPaused, onClearHistory, isConnected }) {
  const running = isConnected && !isPaused;
  return (
    <div className="charts-container">
      <div className="charts-header">
        <h2 className="section-title">Real-Time Telemetry Waveforms</h2>
        <div className="controls-group">
          <button className="btn-sm" onClick={() => setIsPaused(!isPaused)}>
            {isPaused ? <Play size={14} /> : <Pause size={14} />} {isPaused ? 'Resume' : 'Pause'}
          </button>
          <button className="btn-sm" onClick={onClearHistory}><RefreshCw size={14} /> Clear</button>
        </div>
      </div>
      <div className="charts-grid">
        <div className="chart-box">
          <div className="chart-box-title">Pack Current (A)</div>
          <StreamingChart history={history} current running={running} />
        </div>
        <div className="chart-box">
          <div className="chart-box-title">Individual Cell Voltages (mV)</div>
          <StreamingChart history={history} running={running} />
        </div>
      </div>
    </div>
  );
});
