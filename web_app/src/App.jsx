import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { TelemetryCards } from './components/TelemetryCards';
import { ChartsSection } from './components/ChartsSection';
import { CellBreakdown } from './components/CellBreakdown';
import { StatusTimeline } from './components/StatusTimeline';
import { RegisterInspector } from './components/RegisterInspector';
import { DataExporter } from './components/DataExporter';

import { WebSerialManager } from './utils/web_serial';
import { BatterySimulator } from './utils/battery_simulator';
import { SAFETY_STATUS_FLAGS, OPERATION_STATUS_FLAGS } from './utils/smbus_definitions';
import './App.css';

const serialManager = new WebSerialManager();
const batterySim = new BatterySimulator();

export default function App() {
  const [connectionMode, setConnectionMode] = useState('sim'); // 'sim' or 'serial'
  const [isConnected, setIsConnected] = useState(false);
  const [simMode, setSimMode] = useState('discharge');
  
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

  // Handle Incoming Telemetry (from Serial or Simulator)
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

    // Status & Event Transition Detection
    detectStatusTransitions(point, timeStr);
  };

  // Detect state transitions in SafetyStatus and OperationStatus
  const detectStatusTransitions = (point, timeStr) => {
    const sf = point.sf || 0;
    const prevSf = prevSafetyFlagsRef.current;
    
    if (sf !== prevSf) {
      SAFETY_STATUS_FLAGS.forEach(flag => {
        const nowActive = (sf & (1 << flag.bit)) !== 0;
        const prevActive = (prevSf & (1 << flag.bit)) !== 0;

        if (nowActive && !prevActive) {
          // Flag Asserted / Triggered
          addEventLog({
            type: 'safety',
            state: 'ASSERTED',
            code: flag.code,
            label: flag.label,
            desc: flag.desc,
            severity: flag.severity,
            rawHex: `0x${sf.toString(16)}`,
            timeStr
          });
        } else if (!nowActive && prevActive) {
          // Flag Cleared
          addEventLog({
            type: 'safety',
            state: 'CLEARED',
            code: flag.code,
            label: flag.label,
            desc: `${flag.label} condition returned to normal`,
            severity: 'success',
            rawHex: `0x${sf.toString(16)}`,
            timeStr
          });
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
          addEventLog({
            type: 'operation',
            state: nowActive ? 'ASSERTED' : 'CLEARED',
            code: flag.code,
            label: flag.label,
            desc: flag.desc,
            severity: flag.severity,
            rawHex: `0x${op.toString(16)}`,
            timeStr
          });
        }
      });
      prevOpFlagsRef.current = op;
    }
  };

  const addEventLog = (event) => {
    setEventLogs(prev => [...prev, event]);
  };

  // Switch Connection Mode (Simulation vs WebSerial)
  useEffect(() => {
    if (connectionMode === 'sim') {
      if (serialManager.isConnected) {
        serialManager.disconnect();
      }
      batterySim.setMode(simMode);
      batterySim.start(handleIncomingTelemetry, 100);
      setIsConnected(true);
    } else {
      batterySim.stop();
      setIsConnected(serialManager.isConnected);
    }

    return () => {
      batterySim.stop();
    };
  }, [connectionMode, simMode]);

  const handleConnectSerial = async () => {
    try {
      serialManager.onDataCallback = handleIncomingTelemetry;
      serialManager.onStatusChangeCallback = (connected) => setIsConnected(connected);
      await serialManager.connect(115200);
    } catch (err) {
      alert(`Serial connection failed: ${err.message}`);
    }
  };

  const handleDisconnectSerial = async () => {
    await serialManager.disconnect();
    setIsConnected(false);
  };

  const handleInjectSimFault = (bit) => {
    if (connectionMode === 'sim') {
      batterySim.injectFault(bit);
    }
  };

  // Extract active safety alerts
  const activeAlerts = telemetry ? SAFETY_STATUS_FLAGS.filter(f => (telemetry.sf & (1 << f.bit)) !== 0) : [];

  return (
    <div className="app-container">
      <Header
        connectionMode={connectionMode}
        setConnectionMode={setConnectionMode}
        isConnected={isConnected}
        onConnectSerial={handleConnectSerial}
        onDisconnectSerial={handleDisconnectSerial}
        simMode={simMode}
        setSimMode={setSimMode}
        isRecording={isRecording}
        onToggleRecording={() => setIsRecording(!isRecording)}
        recordCount={recordedData.length}
      />

      <main className="main-content">
        {/* Metric Summary Stat Cards */}
        <TelemetryCards telemetry={telemetry} activeAlerts={activeAlerts} />

        {/* Real-time Charts Section */}
        <ChartsSection
          history={history}
          isPaused={isPaused}
          setIsPaused={setIsPaused}
          onClearHistory={() => setHistory([])}
        />

        {/* Grid split: 4-Cell breakdown & Status Trigger Timeline */}
        <div className="content-grid-two">
          <CellBreakdown telemetry={telemetry} />
          <StatusTimeline
            eventLogs={eventLogs}
            onInjectSimFault={connectionMode === 'sim' ? handleInjectSimFault : null}
            simMode={simMode}
          />
        </div>

        {/* Register Inspector & Data Exporter */}
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
