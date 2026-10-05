import React, { memo } from 'react';
import { Download } from 'lucide-react';

export const DataExporter = memo(function DataExporter({ getData, count }) {
  const exportCSV = () => {
    const data = getData();
    if (!data.length) return;
    const chunks = ['Timestamp,TimeStr,Pack_mV,Pack_mA,Cell1_mV,Cell2_mV,Cell3_mV,Cell4_mV,SoC,Temp_0.1K,SafetyStatus,OperationStatus,Triggers\n'];
    for (let offset = 0; offset < data.length; offset += 4096) {
      chunks.push(data.slice(offset, offset + 4096).map(d => [
        d.timestamp, d.timeStr, d.v, d.i, d.c1, d.c2, d.c3, d.c4, d.soc, d.temp,
        d.sf == null ? '' : `0x${d.sf.toString(16)}`, d.op == null ? '' : `0x${d.op.toString(16)}`,
        (d.events || []).map(event => `${event.code}:${event.state}`).join(';'),
      ].join(',')).join('\n') + '\n');
    }
    const url = URL.createObjectURL(new Blob(chunks, { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = `bq40z50_log_${Date.now()}.csv`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="panel-box">
      <div className="panel-header">
        <h3 className="panel-title">Data Recorder & Telemetry Exporter</h3>
        <button className="btn-sm" onClick={exportCSV}>
          <Download size={12} /> Export CSV ({count})
        </button>
      </div>
    </div>
  );
});
