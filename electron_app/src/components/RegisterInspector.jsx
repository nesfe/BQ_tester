import React from 'react';
import { SBS_REGISTERS } from '../utils/smbus_definitions';

export function RegisterInspector({ telemetry }) {
  const getRegisterValue = (reg) => {
    if (!telemetry) return 'N/A';
    const fields = { 0x08: 'temp', 0x09: 'v', 0x0A: 'i', 0x0D: 'soc',
      0x3C: 'c4', 0x3D: 'c3', 0x3E: 'c2', 0x3F: 'c1', 0x51: 'sf', 0x54: 'op' };
    const value = telemetry[fields[reg.addr]];
    if (value == null) return 'N/A';
    if (reg.isBitfield) return `0x${value.toString(16).toUpperCase().padStart(8, '0')}`;
    if (reg.addr === 0x08) return `${(value / 10 - 273.15).toFixed(1)} °C`;
    return `${value} ${reg.unit}`;
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
