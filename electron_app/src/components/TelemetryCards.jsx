import React from 'react';
import { Zap, BatteryCharging, Thermometer, ShieldAlert, Layers, Scale } from 'lucide-react';

export function TelemetryCards({ telemetry, activeAlerts }) {
  if (!telemetry) return null;

  const currentA = telemetry.i == null ? 'N/A' : (telemetry.i / 1000.0).toFixed(2);
  const voltageV = telemetry.v == null ? 'N/A' : (telemetry.v / 1000.0).toFixed(2);
  const tempC = telemetry.temp == null ? 'N/A' : (telemetry.temp / 10.0 - 273.15).toFixed(1);

  const cellVoltages = [telemetry.c1, telemetry.c2, telemetry.c3, telemetry.c4];
  const maxCell = Math.max(...cellVoltages);
  const minCell = Math.min(...cellVoltages);
  const cellDelta = cellVoltages.every(Number.isFinite) ? maxCell - minCell : 'N/A';

  const isCharging = telemetry.i > 100;
  const isDischarging = telemetry.i < -100;

  return (
    <div className="telemetry-grid">
      <div className={`stat-card ${isCharging ? 'card-charge' : isDischarging ? 'card-discharge' : ''}`}>
        <div className="card-header">
          <span className="card-title">Pack Current</span>
          <Zap size={18} className={isCharging ? 'text-green' : isDischarging ? 'text-orange' : ''} />
        </div>
        <div className="card-value">
          {currentA} <span className="card-unit">A</span>
        </div>
      </div>

      <div className="stat-card">
        <div className="card-header">
          <span className="card-title">Total Pack Voltage</span>
          <Layers size={18} className="text-indigo" />
        </div>
        <div className="card-value">
          {voltageV} <span className="card-unit">V</span>
        </div>
      </div>

      <div className="stat-card">
        <div className="card-header">
          <span className="card-title">State of Charge (SoC)</span>
          <BatteryCharging size={18} className="text-cyan" />
        </div>
        <div className="card-value">
          {telemetry.soc == null ? 'N/A' : `${telemetry.soc}%`}
        </div>
      </div>

      <div className="stat-card">
        <div className="card-header">
          <span className="card-title">Cell Imbalance (ΔV)</span>
          <Scale size={18} className={cellDelta > 40 ? 'text-red' : 'text-blue'} />
        </div>
        <div className="card-value">
          {cellDelta} <span className="card-unit">mV</span>
        </div>
      </div>

      <div className="stat-card">
        <div className="card-header">
          <span className="card-title">Temperature</span>
          <Thermometer size={18} className={tempC > 50 ? 'text-red' : 'text-emerald'} />
        </div>
        <div className="card-value">
          {tempC} <span className="card-unit">°C</span>
        </div>
      </div>

      <div className={`stat-card ${activeAlerts.length > 0 ? 'card-alert-active' : ''}`}>
        <div className="card-header">
          <span className="card-title">Safety Status</span>
          <ShieldAlert size={18} className={telemetry.sf == null ? '' : telemetry.sf !== 0 ? 'text-red' : 'text-green'} />
        </div>
        <div className="card-value">
          {telemetry.sf == null ? 'UNKNOWN' : telemetry.sf !== 0 ? `0x${telemetry.sf.toString(16).toUpperCase()}` : 'NORMAL'}
        </div>
      </div>
    </div>
  );
}
