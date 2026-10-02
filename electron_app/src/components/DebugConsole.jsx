import React from 'react';
import { Terminal } from 'lucide-react';

export function DebugConsole({ logs, onClear }) {
  return (
    <div className="panel-box">
      <div className="panel-header">
        <div className="flex-align-center gap-2">
          <Terminal size={18} className="text-emerald" />
          <h3 className="panel-title">EV2400 SMBus Hardware Debug Log Terminal</h3>
        </div>
        <button className="btn-xs btn-secondary" onClick={onClear}>Clear Terminal</button>
      </div>

      <div className="console-log-area font-mono">
        {logs.length === 0 ? (
          <div className="text-muted text-xs">Waiting for EV2400 device connection...</div>
        ) : (
          logs.slice(-40).map((log, idx) => (
            <div key={idx} className={`console-line log-${log.level}`}>
              <span className="text-dim">[{log.time}]</span> {log.msg}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
