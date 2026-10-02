import React from 'react';
import { Download, FileSpreadsheet, Trash2 } from 'lucide-react';

export function DataExporter({ history, recordedData, onClearBuffer }) {
  const exportCSV = () => {
    const dataToExport = recordedData.length > 0 ? recordedData : history;
    if (dataToExport.length === 0) {
      alert("No data recorded to export!");
      return;
    }

    const headers = [
      "Timestamp", "TimeStr", "Pack_Voltage_mV", "Pack_Current_mA",
      "Cell1_mV", "Cell2_mV", "Cell3_mV", "Cell4_mV",
      "SoC_Percent", "Temp_C_x10", "SafetyStatus_Hex", "OperationStatus_Hex"
    ];

    const rows = dataToExport.map(d => [
      d.timestamp,
      d.timeStr,
      d.v,
      d.i,
      d.c1,
      d.c2,
      d.c3,
      d.c4,
      d.soc,
      d.temp,
      `0x${(d.sf || 0).toString(16)}`,
      `0x${(d.op || 0).toString(16)}`
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `bq40z50_log_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "_")}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportJSON = () => {
    const dataToExport = recordedData.length > 0 ? recordedData : history;
    if (dataToExport.length === 0) {
      alert("No data recorded to export!");
      return;
    }

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(dataToExport, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `bq40z50_log_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "_")}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="panel-box">
      <div className="panel-header">
        <div className="flex-align-center gap-2">
          <FileSpreadsheet size={18} className="text-emerald" />
          <h3 className="panel-title">Data Recorder & Telemetry Exporter</h3>
        </div>

        <div className="flex-align-center gap-2">
          <button className="btn-xs btn-primary" onClick={exportCSV}>
            <Download size={12} /> Export CSV ({recordedData.length || history.length} samples)
          </button>

          <button className="btn-xs btn-secondary" onClick={exportJSON}>
            <Download size={12} /> Export JSON
          </button>

          <button className="btn-xs btn-outline-danger" onClick={onClearBuffer}>
            <Trash2 size={12} /> Clear Log Buffer
          </button>
        </div>
      </div>
    </div>
  );
}
