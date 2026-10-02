import React from 'react';
import { Cpu, Usb, Play, Pause, AlertTriangle, ShieldCheck, Download, RefreshCw, Activity } from 'lucide-react';

export function Header({
  connectionMode,
  setConnectionMode,
  isConnected,
  onConnectSerial,
  onDisconnectSerial,
  simMode,
  setSimMode,
  isRecording,
  onToggleRecording,
  recordCount,
  sampleRateMs,
  setSampleRateMs
}) {
  return (
    <header className="header-bar">
      <div className="brand-section">
        <div className="logo-icon">
          <Activity size={24} color="#6366f1" />
        </div>
        <div>
          <h1 className="brand-title">BQ_tester <span className="badge-v">BQ40Z50-R5</span></h1>
          <p className="brand-subtitle">Real-Time SMBus Telemetry & Safety Status Debugger</p>
        </div>
      </div>

      <div className="controls-group">
        {/* Mode Selector */}
        <div className="mode-toggle">
          <button
            className={`btn-tab ${connectionMode === 'serial' ? 'active' : ''}`}
            onClick={() => setConnectionMode('serial')}
          >
            <Usb size={16} /> MSP430 WebSerial
          </button>
          <button
            className={`btn-tab ${connectionMode === 'sim' ? 'active' : ''}`}
            onClick={() => setConnectionMode('sim')}
          >
            <Cpu size={16} /> Live Simulation
          </button>
        </div>

        {/* Serial Connection Action */}
        {connectionMode === 'serial' && (
          <div>
            {!isConnected ? (
              <button className="btn btn-primary" onClick={onConnectSerial}>
                <Usb size={16} /> Connect MSP430 Port
              </button>
            ) : (
              <button className="btn btn-danger" onClick={onDisconnectSerial}>
                Disconnect Port
              </button>
            )}
          </div>
        )}

        {/* Simulation preset controls */}
        {connectionMode === 'sim' && (
          <div className="sim-presets">
            <span className="preset-label">Load Profile:</span>
            <button className={`btn-sm ${simMode === 'discharge' ? 'active' : ''}`} onClick={() => setSimMode('discharge')}>Discharge (-2.8A)</button>
            <button className={`btn-sm ${simMode === 'pulse_load' ? 'active' : ''}`} onClick={() => setSimMode('pulse_load')}>High Pulse (-9A)</button>
            <button className={`btn-sm ${simMode === 'charge' ? 'active' : ''}`} onClick={() => setSimMode('charge')}>Charge (+3A)</button>
            <button className={`btn-sm ${simMode === 'idle' ? 'active' : ''}`} onClick={() => setSimMode('idle')}>Idle (0A)</button>
          </div>
        )}

        {/* Recording Controls */}
        <div className="record-box">
          <button
            className={`btn ${isRecording ? 'btn-recording' : 'btn-secondary'}`}
            onClick={onToggleRecording}
          >
            {isRecording ? (
              <>
                <span className="rec-dot pulsing"></span> Recording ({recordCount})
              </>
            ) : (
              <>
                <Play size={14} /> Start CSV Log
              </>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
