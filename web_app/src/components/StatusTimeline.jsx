import React, { useState } from 'react';
import { ShieldAlert, Clock, AlertTriangle, CheckCircle, Zap, Filter, Bug } from 'lucide-react';
import { SAFETY_STATUS_FLAGS, OPERATION_STATUS_FLAGS } from '../utils/smbus_definitions';

export function StatusTimeline({ eventLogs, onInjectSimFault, simMode }) {
  const [filterType, setFilterType] = useState('all'); // 'all', 'safety', 'operation'

  const filteredLogs = eventLogs.filter(log => {
    if (filterType === 'safety') return log.type === 'safety';
    if (filterType === 'operation') return log.type === 'operation';
    return true;
  });

  return (
    <div className="panel-box">
      <div className="panel-header">
        <div className="flex-align-center gap-2">
          <Clock size={18} className="text-amber" />
          <h3 className="panel-title">Real-Time Status Trigger Timeline</h3>
          <span className="count-badge">{eventLogs.length} events</span>
        </div>

        <div className="flex-align-center gap-2">
          {/* Simulation fault injector */}
          {onInjectSimFault && (
            <div className="sim-fault-triggers">
              <span className="subtext-xs"><Bug size={12} /> Fault Injector:</span>
              <button className="btn-xs btn-outline-danger" onClick={() => onInjectSimFault(0)}>+CUV</button>
              <button className="btn-xs btn-outline-danger" onClick={() => onInjectSimFault(1)}>+COV</button>
              <button className="btn-xs btn-outline-warning" onClick={() => onInjectSimFault(3)}>+OCD</button>
              <button className="btn-xs btn-outline-warning" onClick={() => onInjectSimFault(8)}>+OTD</button>
            </div>
          )}

          <div className="btn-group">
            <button className={`btn-xs ${filterType === 'all' ? 'active' : ''}`} onClick={() => setFilterType('all')}>All</button>
            <button className={`btn-xs ${filterType === 'safety' ? 'active' : ''}`} onClick={() => setFilterType('safety')}>Safety Alerts</button>
            <button className={`btn-xs ${filterType === 'operation' ? 'active' : ''}`} onClick={() => setFilterType('operation')}>FETs & Ops</button>
          </div>
        </div>
      </div>

      <div className="timeline-list">
        {filteredLogs.length === 0 ? (
          <div className="timeline-empty">
            <CheckCircle size={24} className="text-muted" />
            <p>No status transitions recorded yet. Monitoring SMBus events...</p>
          </div>
        ) : (
          filteredLogs.slice(-50).reverse().map((event, idx) => {
            const isAlert = event.state === 'ASSERTED' || event.severity === 'danger';
            return (
              <div key={idx} className={`timeline-item ${isAlert ? 'timeline-alert' : 'timeline-normal'}`}>
                <div className="timeline-time">
                  <Clock size={12} /> {event.timeStr}
                </div>

                <div className="timeline-content">
                  <div className="timeline-title-row">
                    <span className={`event-badge ${event.state === 'ASSERTED' ? 'bg-danger' : 'bg-success'}`}>
                      {event.state}
                    </span>
                    <span className="event-code font-bold">{event.code}</span>
                    <span className="event-label">{event.label}</span>
                  </div>
                  <div className="event-desc text-muted">
                    {event.desc} &bull; <span className="text-dim">Raw: {event.rawHex}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
