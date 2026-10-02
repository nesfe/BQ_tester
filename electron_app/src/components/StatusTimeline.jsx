import React from 'react';
import { Clock } from 'lucide-react';

export function StatusTimeline({ eventLogs }) {
  return (
    <div className="panel-box">
      <div className="panel-header">
        <h3 className="panel-title">Real-Time Status Trigger Timeline</h3>
        <span className="count-badge">{eventLogs.length} events</span>
      </div>

      <div className="timeline-list">
        {eventLogs.length === 0 ? (
          <div className="timeline-empty">Monitoring SMBus events...</div>
        ) : (
          eventLogs.slice(-50).reverse().map((event, idx) => (
            <div key={idx} className={`timeline-item ${event.state === 'ASSERTED' ? 'timeline-alert' : 'timeline-normal'}`}>
              <span className="timeline-time">{event.timeStr}</span>
              <span className="event-code font-bold">{event.code}</span>
              <span className="event-label">{event.label}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
