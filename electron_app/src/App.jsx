import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { TelemetryCards } from './components/TelemetryCards';
import { ChartsSection } from './components/ChartsSection';
import { CellBreakdown } from './components/CellBreakdown';
import { StatusTimeline } from './components/StatusTimeline';
import { RegisterInspector } from './components/RegisterInspector';
import { DataExporter } from './components/DataExporter';
import { DebugConsole } from './components/DebugConsole';
import { SAFETY_STATUS_FLAGS, OPERATION_STATUS_FLAGS } from './utils/smbus_definitions';
import { HISTORY_LIMIT, EVENT_LIMIT, appendBounded, detectTransitions, RecordingBuffer, formatTime } from './utils/telemetry.mjs';

const STATUS_GROUPS = [
  { field: 'sf', type: 'safety', flags: SAFETY_STATUS_FLAGS },
  { field: 'op', type: 'operation', flags: OPERATION_STATUS_FLAGS },
];

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
  const [recordedCount, setRecordedCount] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const previousStatus = useRef({ sf: null, op: null });
  const sequence = useRef(0);
  const recording = useRef(new RecordingBuffer());
  const pending = useRef({ latest: null, points: [], events: [] });
  const scheduledFrame = useRef(null);
  const historyRef = useRef(history);
  historyRef.current = history;
  const getExportData = useCallback(() => recording.current.length ? recording.current.getData() : historyRef.current, []);
  const clearHistory = useCallback(() => {
    pending.current.points = [];
    setHistory([]);
  }, []);
  const clearDebug = useCallback(() => setDebugLogs([]), []);
  const clearPending = () => {
    if (scheduledFrame.current !== null) cancelAnimationFrame(scheduledFrame.current);
    scheduledFrame.current = null;
    pending.current = { latest: null, points: [], events: [] };
  };
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
          // Flush acquired samples before resetting; CSV and events must not lose the last poll.
          flushTelemetry();
          clearPending();
          setTelemetry(null);
          previousStatus.current = { sf: null, op: null };
        }
      });
      const unsubTelemetry = window.electronAPI.onTelemetryUpdate((data) => {
        handleIncomingTelemetry(data);
      });
      const unsubDebug = window.electronAPI.onDebugLog((log) => {
        setDebugLogs(prev => [...prev.slice(-100), log]);
      });
      return () => {
        clearPending();
        unsubState();
        unsubTelemetry();
        unsubDebug();
      };
    }
  }, []);

  const flushTelemetry = () => {
    if (scheduledFrame.current !== null) cancelAnimationFrame(scheduledFrame.current);
    scheduledFrame.current = null;
    const batch = pending.current;
    pending.current = { latest: null, points: [], events: [] };
    if (!batch.latest) return;
    setTelemetry(batch.latest);
    if (batch.points.length) setHistory(prev => appendBounded(prev, batch.points, HISTORY_LIMIT));
    if (batch.events.length) setEventLogs(prev => appendBounded(prev, batch.events, EVENT_LIMIT));
    setRecordedCount(recording.current.length);
  };

  const handleIncomingTelemetry = (data) => {
    const timestamp = data.timestamp ?? Date.now();
    const point = { ...data, timestamp, timeStr: formatTime(timestamp), sequence: ++sequence.current };
    point.events = detectTransitions(point, previousStatus.current, STATUS_GROUPS);
    const batch = pending.current;
    batch.latest = point;
    // Ingest every sample, even when drawing is coalesced into a single browser frame.
    if (!isPausedRef.current) {
      batch.points.push(point);
      if (batch.points.length > HISTORY_LIMIT) batch.points.shift();
    }
    batch.events.push(...point.events);
    if (batch.events.length > EVENT_LIMIT) batch.events.splice(0, batch.events.length - EVENT_LIMIT);
    if (isRecordingRef.current && point.hasValidData) recording.current.append(point);
    if (scheduledFrame.current === null) scheduledFrame.current = requestAnimationFrame(flushTelemetry);
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
        clearPending();
        previousStatus.current = { sf: null, op: null };
        setTelemetry(null);
        setHistory([]);
        setEventLogs([]);
        setStatusMsg("Opening TI adapter & reading battery...");
        await window.electronAPI.connectDevice(selectedDevice);
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
            <h1 className="brand-title">BQ_tester <span className="badge-v">v2.2.0 Electron</span></h1>
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
            {isRecording ? `🔴 REC (${recordedCount})` : 'Start CSV Log'}
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
          onClearHistory={clearHistory}
          isConnected={isConnected}
        />

        <div className="content-grid-two">
          <CellBreakdown telemetry={telemetry} />
          <StatusTimeline eventLogs={eventLogs} />
        </div>

        <div className="content-grid-two">
          <RegisterInspector telemetry={telemetry} />
          <DataExporter
            getData={getExportData}
            count={recordedCount || history.length}
          />
        </div>

        <DebugConsole logs={debugLogs} onClear={clearDebug} />
      </main>
    </div>
  );
}

