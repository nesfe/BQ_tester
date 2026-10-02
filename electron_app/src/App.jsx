import React, { useState, useEffect, useRef } from 'react';
import { Activity, RefreshCw, Play, Download, ShieldAlert, Cpu, Terminal } from 'lucide-react';
import { TelemetryCards } from './components/TelemetryCards';
import { ChartsSection } from './components/ChartsSection';
import { CellBreakdown } from './components/CellBreakdown';
import { StatusTimeline } from './components/StatusTimeline';
import { RegisterInspector } from './components/RegisterInspector';
import { DataExporter } from './components/DataExporter';
import { DebugConsole } from './components/DebugConsole';
import { SAFETY_STATUS_FLAGS, OPERATION_STATUS_FLAGS } from './utils/smbus_definitions';

export default function App() {
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Disconnected');
  const [telemetry, setTelemetry] = useState(null);
  const [history, setHistory] = useState([]);
  const [eventLogs, setEventLogs] = useState([]);
  const [debugLogs, setDebugLogs] = useState([]);
  const [recordedData, setRecordedData] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const prevSafetyFlagsRef = useRef(null);
  const prevOpFlagsRef = useRef(null);
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;
  const isRecordingRef = useRef(isRecording);
  isRecordingRef.current = isRecording;

  const scanDevices = async () => {
    if (window.electronAPI) {
      try {
        const list = await window.electronAPI.scanDevices();
        setDevices(list);
        setSelectedDevice(list[0] || null);
      } catch (e) {
        setDevices([]);
        setSelectedDevice(null);
        setStatusMsg(e.message);
      }
    }
  };

  useEffect(() => {
    scanDevices();

    if (window.electronAPI) {
      const unsubState = window.electronAPI.onConnectionState((state) => {
        setIsConnected(state.connected);
        setStatusMsg(state.message);
        if (!state.connected) {
          setTelemetry(null);
          prevSafetyFlagsRef.current = null;
          prevOpFlagsRef.current = null;
        }
      });
      const unsubTelemetry = window.electronAPI.onTelemetryUpdate((data) => {
        handleIncomingTelemetry(data);
      });
      const unsubDebug = window.electronAPI.onDebugLog((log) => {
        setDebugLogs(prev => [...prev.slice(-100), log]);
      });
      return () => {
        unsubState();
        unsubTelemetry();
        unsubDebug();
      };
    }
  }, []);

  const handleIncomingTelemetry = (data) => {
    const timeNow = new Date();
    const timeStr = timeNow.toTimeString().split(' ')[0] + '.' + String(timeNow.getMilliseconds()).padStart(3, '0');

    const point = {
      ...data,
      timeStr,
      timestamp: timeNow.getTime()
    };

    setTelemetry(point);

    if (!isPausedRef.current && point.hasValidData) {
      setHistory(prev => {
        const next = [...prev, point];
        return next.length > 2000 ? next.slice(next.length - 2000) : next;
      });
    }

    if (isRecordingRef.current && point.hasValidData) {
      setRecordedData(prev => [...prev, point]);
    }

    detectStatusTransitions(point, timeStr);
  };

  const detectStatusTransitions = (point, timeStr) => {
    const sf = point.sf;
    const prevSf = prevSafetyFlagsRef.current;

    if (sf != null && sf !== prevSf) {
      SAFETY_STATUS_FLAGS.forEach(flag => {
        const nowActive = (sf & (1 << flag.bit)) !== 0;
        const prevActive = (prevSf & (1 << flag.bit)) !== 0;

        if (nowActive && !prevActive) {
          setEventLogs(prev => [...prev, {
            type: 'safety', state: 'ASSERTED', code: flag.code, label: flag.label,
            desc: flag.desc, severity: flag.severity, rawHex: `0x${sf.toString(16)}`, timeStr
          }]);
        } else if (!nowActive && prevActive && prevSf != null) {
          setEventLogs(prev => [...prev, {
            type: 'safety', state: 'CLEARED', code: flag.code, label: flag.label,
            desc: `${flag.label} returned to normal`, severity: 'success', rawHex: `0x${sf.toString(16)}`, timeStr
          }]);
        }
      });
      prevSafetyFlagsRef.current = sf;
    }

    const op = point.op;
    const prevOp = prevOpFlagsRef.current;
    if (op != null && op !== prevOp) {
      OPERATION_STATUS_FLAGS.forEach(flag => {
        const nowActive = (op & (1 << flag.bit)) !== 0;
        const prevActive = (prevOp & (1 << flag.bit)) !== 0;

        if (nowActive !== prevActive && (prevOp != null || nowActive)) {
          setEventLogs(prev => [...prev, {
            type: 'operation', state: nowActive ? 'ASSERTED' : 'CLEARED',
            code: flag.code, label: flag.label, desc: flag.desc, severity: flag.severity,
            rawHex: `0x${op.toString(16)}`, timeStr
          }]);
        }
      });
      prevOpFlagsRef.current = op;
    }
  };

  const toggleConnect = async () => {
    if (isConnecting) return;
    if (!window.electronAPI) {
      alert("Electron API not found!");
      return;
    }

    if (isConnected) {
      await window.electronAPI.disconnectDevice();
      setIsConnected(false);
      setStatusMsg("Disconnected");
    } else {
      if (!selectedDevice) {
        alert("Please select a USB device!");
        return;
      }

      try {
        setIsConnecting(true);
        setTelemetry(null);
        setHistory([]);
        setStatusMsg("Opening TI adapter & reading battery...");
        const res = await window.electronAPI.connectDevice(selectedDevice);
        setIsConnected(true);
        setStatusMsg("Connected via TI CMAPI");
      } catch (err) {
        setIsConnected(false);
        setStatusMsg(err.message);
        alert(err.message);
      } finally {
        setIsConnecting(false);
      }
    }
  };

  const chooseTIDirectory = async () => {
    try {
      const list = await window.electronAPI.chooseTIDirectory();
      if (list) {
        setDevices(list);
        setSelectedDevice(list[0] || null);
        setStatusMsg('TI libraries found; ready to connect');
      }
    } catch (error) { setStatusMsg(error.message); }
  };

  const activeAlerts = telemetry ? SAFETY_STATUS_FLAGS.filter(f => (telemetry.sf & (1 << f.bit)) !== 0) : [];

  return (
    <div className="app-container">
      <header className="header-bar">
        <div className="brand-section">
          <div className="logo-icon">
            <Activity size={24} color="#6366f1" />
          </div>
          <div>
            <h1 className="brand-title">BQ_tester <span className="badge-v">v2.1.0 Electron</span></h1>
            <p className="brand-subtitle">High-Speed Real-Time SMBus BQ40Z50 Debugger</p>
          </div>
        </div>

        <div className="controls-group">
          <select
            disabled={isConnected || isConnecting}
            className="select-xs"
            value={selectedDevice ? JSON.stringify(selectedDevice) : ''}
            onChange={(e) => setSelectedDevice(JSON.parse(e.target.value))}
          >
            {devices.map((d, i) => (
              <option key={i} value={JSON.stringify(d)}>{d.name}</option>
            ))}
          </select>

          <button className="btn-sm" onClick={scanDevices} disabled={isConnected || isConnecting}>
            <RefreshCw size={14} /> Find TI libraries
          </button>

          <button className="btn-sm" onClick={chooseTIDirectory} disabled={isConnected || isConnecting}>
            TI libraries…
          </button>

          <button
            disabled={isConnecting || (!isConnected && !selectedDevice)}
            className={`btn ${isConnected ? 'btn-danger' : 'btn-primary'}`}
            onClick={toggleConnect}
          >
            {isConnecting ? 'Connecting…' : isConnected ? 'Disconnect EV2400' : 'Connect Device'}
          </button>

          <button
            className={`btn ${isRecording ? 'btn-recording' : 'btn-secondary'}`}
            onClick={() => setIsRecording(!isRecording)}
          >
            {isRecording ? `🔴 REC (${recordedData.length})` : 'Start CSV Log'}
          </button>
        </div>
      </header>

      <main className="main-content">
        <p role="status">{statusMsg}</p>
        {telemetry && Object.keys(telemetry.errors || {}).length > 0 && (
          <p role="alert" className="text-red">Some registers could not be read. Missing values are shown as N/A; see the debug log.</p>
        )}

        <TelemetryCards telemetry={telemetry} activeAlerts={activeAlerts} />

        <ChartsSection
          history={history}
          isPaused={isPaused}
          setIsPaused={setIsPaused}
          onClearHistory={() => setHistory([])}
        />

        <div className="content-grid-two">
          <CellBreakdown telemetry={telemetry} />
          <StatusTimeline eventLogs={eventLogs} />
        </div>

        <div className="content-grid-two">
          <RegisterInspector telemetry={telemetry} />
          <DataExporter
            history={history}
            recordedData={recordedData}
            onClearBuffer={() => setRecordedData([])}
          />
        </div>

        <DebugConsole logs={debugLogs} onClear={() => setDebugLogs([])} />
      </main>
    </div>
  );
}

