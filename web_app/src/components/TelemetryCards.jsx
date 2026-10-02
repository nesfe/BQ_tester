import React from 'react';
import { Zap, BatteryCharging, Thermometer, ShieldAlert, Layers, Scale } from 'lucide-react';

export function TelemetryCards({ telemetry, activeAlerts }) {
  if (!telemetry) return null;

  const currentA = (telemetry.i / 1000.0).toFixed(2);
  const voltageV = (telemetry.v / 1000.0).toFixed(2);
  const tempC = (telemetry.temp / 10.0).toFixed(1);

  const cellVoltages = [telemetry.c1, telemetry.c2, telemetry.c3, telemetry.c4];
  const maxCell = Math.max(...cellVoltages);
  const minCell = Math.min(...cellVoltages);
  const cellDelta = (maxCell - minCell);

  const isCharging = telemetry.i > 100;
  const isDischarging = telemetry.i < -100;

  return (
    <div className="telemetry-grid">
      {/* Pack Current */}
      <div className={`stat-card ${isCharging ? 'card-charge' : isDischarging ? 'card-discharge' : ''}`}>
        <div className="card-header">
          <span className="card-title">Pack Current</span>
          <Zap size={18} className={isCharging ? 'text-green' : isDischarging ? 'text-orange' : ''} />
        </div>
        <div className="card-value">
          {currentA} <span className="card-unit">A</span>
        </div>
        <div className="card-footer">
          {isCharging ? (
            <span className="badge badge-success">Charging ({telemetry.i} mA)</span>
          ) : isDischarging ? (
            <span className="badge badge-warning">Discharging ({telemetry.i} mA)</span>
          ) : (
            <span className="badge badge-neutral">Standby / Idle</span>
          )}
        </div>
      </div>

      {/* Pack Voltage */}
      <div className="stat-card">
        <div className="card-header">
          <span className="card-title">Total Pack Voltage</span>
          <Layers size={18} className="text-indigo" />
        </div>
        <div className="card-value">
          {voltageV} <span className="card-unit">V</span>
        </div>
        <div className="card-footer">
          <span className="subtext">{telemetry.v} mV (4S Pack)</span>
        </div>
      </div>

      {/* State of Charge (SoC) */}
      <div className="stat-card">
        <div className="card-header">
          <span className="card-title">State of Charge (SoC)</span>
          <BatteryCharging size={18} className="text-cyan" />
        </div>
        <div className="card-value">
          {telemetry.soc}%
        </div>
        <div className="progress-bar-bg">
          <div
            className={`progress-bar-fill ${telemetry.soc < 20 ? 'bg-red' : telemetry.soc > 80 ? 'bg-green' : 'bg-cyan'}`}
            style={{ width: `${Math.max(0, Math.min(100, telemetry.soc))}%` }}
          />
        </div>
      </div>

      {/* Cell Imbalance Delta */}
      <div className={`stat-card ${cellDelta > 40 ? 'card-alert' : ''}`}>
        <div className="card-header">
          <span className="card-title">Cell Imbalance (ΔV)</span>
          <Scale size={18} className={cellDelta > 40 ? 'text-red' : 'text-blue'} />
        </div>
        <div className="card-value">
          {cellDelta} <span className="card-unit">mV</span>
        </div>
        <div className="card-footer">
          {cellDelta > 40 ? (
            <span className="badge badge-danger">High Imbalance!</span>
          ) : (
            <span className="badge badge-success">Balanced (&le; 40mV)</span>
          )}
        </div>
      </div>

      {/* Temperature */}
      <div className="stat-card">
        <div className="card-header">
          <span className="card-title">Temperature</span>
          <Thermometer size={18} className={tempC > 50 ? 'text-red' : 'text-emerald'} />
        </div>
        <div className="card-value">
          {tempC} <span className="card-unit">°C</span>
        </div>
        <div className="card-footer">
          <span className="subtext">{((tempC * 9/5) + 32).toFixed(1)} °F</span>
        </div>
      </div>

      {/* Active Alerts */}
      <div className={`stat-card ${activeAlerts.length > 0 ? 'card-alert-active' : ''}`}>
        <div className="card-header">
          <span className="card-title">Safety Status</span>
          <ShieldAlert size={18} className={activeAlerts.length > 0 ? 'text-red pulsing' : 'text-green'} />
        </div>
        <div className="card-value">
          {activeAlerts.length} <span className="card-unit">Alerts</span>
        </div>
        <div className="card-footer">
          {activeAlerts.length > 0 ? (
            <span className="badge badge-danger">{activeAlerts.map(a => a.code).join(', ')}</span>
          ) : (
            <span className="badge badge-success">System Normal (0x0000)</span>
          )}
        </div>
      </div>
    </div>
  );
}
