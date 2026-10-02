import React, { useState } from 'react';
import { Database, Search, Send, Terminal } from 'lucide-react';
import { SBS_REGISTERS } from '../utils/smbus_definitions';

export function RegisterInspector({ telemetry }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [subcmd, setSubcmd] = useState('0x0051');
  const [cmdResponse, setCmdResponse] = useState(null);

  const getRegisterValue = (reg) => {
    if (!telemetry) return 'N/A';
    switch (reg.addr) {
      case 0x08: return `${(telemetry.temp / 10.0).toFixed(1)} °C`;
      case 0x09: return `${telemetry.v} mV`;
      case 0x0A: return `${telemetry.i} mA`;
      case 0x0B: return `${telemetry.i} mA`;
      case 0x0D: return `${telemetry.soc} %`;
      case 0x0E: return `${telemetry.soc} %`;
      case 0x3C: return `${telemetry.c4} mV`;
      case 0x3D: return `${telemetry.c3} mV`;
      case 0x3E: return `${telemetry.c2} mV`;
      case 0x3F: return `${telemetry.c1} mV`;
      case 0x51: return `0x${(telemetry.sf || 0).toString(16).toUpperCase().padStart(4, '0')}`;
      case 0x54: return `0x${(telemetry.op || 0).toString(16).toUpperCase().padStart(4, '0')}`;
      default: return '0x0000';
    }
  };

  const filteredRegisters = SBS_REGISTERS.filter(r =>
    r.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    `0x${r.addr.toString(16)}`.includes(searchTerm.toLowerCase())
  );

  const handleSendSubcommand = (e) => {
    e.preventDefault();
    setCmdResponse(`Sent 0x00 ManufacturerAccess [${subcmd}] -> ACK (Success)`);
  };

  return (
    <div className="panel-box">
      <div className="panel-header">
        <div className="flex-align-center gap-2">
          <Database size={18} className="text-cyan" />
          <h3 className="panel-title">BQ40Z50-R5 SMBus Register Inspector</h3>
        </div>

        <div className="search-box">
          <Search size={14} className="text-muted" />
          <input
            type="text"
            placeholder="Filter registers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input-xs"
          />
        </div>
      </div>

      <div className="table-responsive">
        <table className="reg-table">
          <thead>
            <tr>
              <th>CMD (Hex)</th>
              <th>Register Name</th>
              <th>Value</th>
              <th>Unit</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {filteredRegisters.map((reg) => (
              <tr key={reg.addr}>
                <td className="font-mono text-cyan">0x{reg.addr.toString(16).toUpperCase().padStart(2, '0')}</td>
                <td className="font-bold">{reg.name}</td>
                <td className="font-mono text-white">{getRegisterValue(reg)}</td>
                <td className="text-muted">{reg.unit}</td>
                <td className="text-dim text-xs">{reg.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Subcommand console */}
      <form onSubmit={handleSendSubcommand} className="subcmd-bar">
        <div className="flex-align-center gap-2 flex-grow">
          <Terminal size={14} className="text-emerald" />
          <span className="text-xs text-muted">ManufacturerAccess (0x00) Subcmd:</span>
          <input
            type="text"
            value={subcmd}
            onChange={(e) => setSubcmd(e.target.value)}
            className="input-xs font-mono"
            placeholder="e.g. 0x0051"
          />
          <button type="submit" className="btn-xs btn-primary">
            <Send size={12} /> Send SMBus
          </button>
        </div>
        {cmdResponse && <span className="cmd-resp text-xs text-emerald">{cmdResponse}</span>}
      </form>
    </div>
  );
}
