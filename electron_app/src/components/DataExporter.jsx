import React from 'react';
import { Download } from 'lucide-react';

export function DataExporter({ history, recordedData, onClearBuffer }) {
  const exportCSV = () => {
    const dataToExport = recordedData.length > 0 ? recordedData : history;
    if (dataToExport.length === 0) return;

    const headers = ["Timestamp", "TimeStr", "Pack_mV", "Pack_mA", "Cell1_mV", "Cell2_mV", "Cell3_mV", "Cell4_mV", "SoC", "Temp"];
    const rows = dataToExport.map(d => [d.timestamp, d.timeStr, d.v, d.i, d.c1, d.c2, d.c3, d.c4, d.soc, d.temp]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `bq40z50_log_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="panel-box">
      <div className="panel-header">
        <h3 className="panel-title">Data Recorder & Telemetry Exporter</h3>
        <button className="btn-sm" onClick={exportCSV}>
          <Download size={12} /> Export CSV ({recordedData.length || history.length})
        </button>
      </div>
    </div>
  );
}
