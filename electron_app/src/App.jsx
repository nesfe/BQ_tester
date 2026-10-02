import React, { useState, useEffect, useRef } from 'react';
import { Activity, RefreshCw, Play, Download, ShieldAlert, Cpu } from 'lucide-react';
import { TelemetryCards } from '../../web_app/src/components/TelemetryCards';
import { ChartsSection } from '../../web_app/src/components/ChartsSection';
import { CellBreakdown } from '../../web_app/src/components/CellBreakdown';
import { StatusTimeline } from '../../web_app/src/components/StatusTimeline';
import { RegisterInspector } from '../../web_app/src/components/RegisterInspector';
import { DataExporter } from '../../web_app/src/components/DataExporter';
import { SAFETY_STATUS_FLAGS, OPERATION_STATUS_FLAGS } from './utils/smbus_definitions';

export default function App() {
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Disconnected');
  const [telemetry, setTelemetry] = useState(null);
  const [history, setHistory] = useState([]);
  const [eventLogs, setEventLogs] = useState([]);
  const [recordedData, setRecordedData] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const prevSafetyFlagsRef = useRef(0);
  const prevOpFlagsRef = useRef(0);
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;
  const isRecordingRef = useRef(isRecording);
  isRecordingRef.current = isRecording;

  // Initial scan for USB HID devices
  const scanDevices = async () => {
    if (window.electronAPI) {
      try {
        const list = await window.electronAPI.scanDevices();
        setDevices(list);
        if (list.length > 0) {
          setSelectedDevice(list[0]);
        }
      } catch (e) {
        console.error("Scan error:", e);
      }
    }
  };

  useEffect(() => {
    scanDevices();

    // Subscribe to high-speed IPC telemetry stream from Electron Main Process
    if (window.electronAPI) {
      const unsubscribe = window.electronAPI.onTelemetryUpdate((data) => {
        handleIncomingTelemetry(data);
      });
      return () => unsubscribe();
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

    if (!isPausedRef.current) {
      setHistory(prev => {
        const next = [...prev, point];
        return next.length > 2000 ? next.slice(next.length - 2000) : next;
      });
    }

    if (isRecordingRef.current) {
      setRecordedData(prev => [...prev, point]);
    }

    detectStatusTransitions(point, timeStr);
  };

  const detectStatusTransitions = (point, timeStr) => {
    const sf = point.sf || 0;
    const prevSf = prevSafetyFlagsRef.current;

    if (sf !== prevSf) {
      SAFETY_STATUS_FLAGS.forEach(flag => {
        const nowActive = (sf & (1 << flag.bit)) !== 0;
        const prevActive = (prevSf & (1 << flag.bit)) !== 0;

        if (nowActive && !prevActive) {
          setEventLogs(prev => [...prev, {
            type: 'safety', state: 'ASSERTED', code: flag.code, label: flag.label,
            desc: flag.desc, severity: flag.severity, rawHex: `0x${sf.toString(16)}`, timeStr
          }]);
        } else if (!nowActive && prevActive) {
          setEventLogs(prev => [...prev, {
            type: 'safety', state: 'CLEARED', code: flag.code, label: flag.label,
            desc: `${flag.label} returned to normal`, severity: 'success', rawHex: `0x${sf.toString(16)}`, timeStr
          }]);
        }
      });
      prevSafetyFlagsRef.current = sf;
    }

    const op = point.op || 0;
    const prevOp = prevOpFlagsRef.current;
    if (op !== prevOp) {
      OPERATION_STATUS_FLAGS.forEach(flag => {
        const nowActive = (op & (1 << flag.bit)) !== 0;
        const prevActive = (prevOp & (1 << flag.bit)) !== 0;

        if (nowActive !== prevActive) {
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
        setStatusMsg("Connecting...");
        const res = await window.electronAPI.connectDevice(selectedDevice);
        setIsConnected(true);
        setStatusMsg("Connected (10Hz SMBus)");
      } catch (err) {
        setIsConnected(false);
        setStatusMsg("Error");
        alert(err.message);
      }
    }
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
            <h1 className="brand-title">BQ_tester <span className="badge-v">Electron 60FPS</span></h1>
            <p className="brand-subtitle">High-Speed Real-Time SMBus BQ40Z50 Debugger</p>
          </div>
        </div>

        <div className="controls-group">
          <select
            className="select-xs"
            value={selectedDevice ? JSON.stringify(selectedDevice) : ''}
            onChange={(e) => setSelectedDevice(JSON.parse(e.target.value))}
          >
            {devices.map((d, i) => (
              <option key={i} value={JSON.stringify(d)}>{d.name}</option>
            ))}
          </select>

          <button className="btn-sm" onClick={scanDevices}>
            <RefreshCw size={14} /> Scan USB
          </button>

          <button
            className={`btn ${isConnected ? 'btn-danger' : 'btn-primary'}`}
            onClick={toggleConnect}
          >
            {isConnected ? 'Disconnect EV2400' : 'Connect Device'}
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
      </main>
    </div>
  );
}
