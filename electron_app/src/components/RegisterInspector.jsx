import React from 'react';
import { SBS_REGISTERS } from '../utils/smbus_definitions';

export function RegisterInspector({ telemetry }) {
  const getRegisterValue = (reg) => {
    if (!telemetry) return 'N/A';
    switch (reg.addr) {
      case 0x08: return `${(telemetry.temp / 10.0).toFixed(1)} °C`;
      case 0x09: return `${telemetry.v} mV`;
      case 0x0A: return `${telemetry.i} mA`;
      case 0x0D: return `${telemetry.soc} %`;
      case 0x3C: return `${telemetry.c4} mV`;
      case 0x3D: return `${telemetry.c3} mV`;
      case 0x3E: return `${telemetry.c2} mV`;
      case 0x3F: return `${telemetry.c1} mV`;
      case 0x51: return `0x${(telemetry.sf || 0).toString(16).toUpperCase()}`;
      case 0x54: return `0x${(telemetry.op || 0).toString(16).toUpperCase()}`;
      default: return '0x0000';
    }
  };

  return (
    <div className="panel-box">
      <div className="panel-header">
        <h3 className="panel-title">BQ40Z50 Register Inspector</h3>
      </div>
      <table className="reg-table">
        <thead>
          <tr>
            <th>CMD (Hex)</th>
            <th>Name</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {SBS_REGISTERS.map((reg) => (
            <tr key={reg.addr}>
              <td>0x{reg.addr.toString(16).toUpperCase()}</td>
              <td>{reg.name}</td>
              <td>{getRegisterValue(reg)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
