import React, { useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ReferenceLine
} from 'recharts';
import { Pause, Play, RefreshCw, ZoomIn } from 'lucide-react';

export function ChartsSection({ history, isPaused, setIsPaused, onClearHistory }) {
  const [windowSize, setWindowSize] = useState(100);
  const [activeTab, setActiveTab] = useState('all'); // 'all', 'current', 'cells', 'voltage_temp'

  // Filter history to current display window
  const displayData = history.slice(-windowSize).map(item => ({
    time: item.timeStr,
    currentA: (item.i / 1000.0),
    currentmA: item.i,
    voltageV: (item.v / 1000.0),
    voltagemV: item.v,
    cell1: item.c1,
    cell2: item.c2,
    cell3: item.c3,
    cell4: item.c4,
    tempC: (item.temp / 10.0),
    soc: item.soc,
    hasFault: item.sf !== 0
  }));

  return (
    <div className="charts-container">
      <div className="charts-header">
        <div className="charts-title-group">
          <h2 className="section-title">Real-Time Telemetry Waveforms</h2>
          <span className="live-indicator">
            <span className={`dot ${isPaused ? 'dot-paused' : 'dot-live'}`}></span>
            {isPaused ? 'PAUSED' : 'LIVE 10Hz'}
          </span>
        </div>

        <div className="charts-controls">
          {/* View Filter */}
          <div className="btn-group">
            <button className={`btn-xs ${activeTab === 'all' ? 'active' : ''}`} onClick={() => setActiveTab('all')}>All Graphs</button>
            <button className={`btn-xs ${activeTab === 'current' ? 'active' : ''}`} onClick={() => setActiveTab('current')}>Current Only</button>
            <button className={`btn-xs ${activeTab === 'cells' ? 'active' : ''}`} onClick={() => setActiveTab('cells')}>Cell Voltages</button>
          </div>

          {/* Buffer Window Selector */}
          <div className="window-selector">
            <span className="label-xs">Samples:</span>
            <select
              value={windowSize}
              onChange={(e) => setWindowSize(Number(e.target.value))}
              className="select-xs"
            >
              <option value={50}>50 (~5s)</option>
              <option value={100}>100 (~10s)</option>
              <option value={250}>250 (~25s)</option>
              <option value={500}>500 (~50s)</option>
            </select>
          </div>

          <button
            className={`btn-icon ${isPaused ? 'btn-icon-active' : ''}`}
            onClick={() => setIsPaused(!isPaused)}
            title={isPaused ? "Resume Live Graph" : "Pause Live Graph"}
          >
            {isPaused ? <Play size={16} /> : <Pause size={16} />}
          </button>

          <button
            className="btn-icon"
            onClick={onClearHistory}
            title="Clear Graph Buffer"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      <div className="charts-grid">
        {/* GRAPH 1: Pack Current Consumption */}
        {(activeTab === 'all' || activeTab === 'current') && (
          <div className="chart-box">
            <div className="chart-box-title">
              <span className="dot-title dot-current"></span> Pack Current Draw (Amperes)
            </div>
            <div className="chart-wrapper">
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={displayData}>
                  <defs>
                    <linearGradient id="currentGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                  <XAxis dataKey="time" stroke="#737373" tick={{ fontSize: 11 }} />
                  <YAxis stroke="#737373" tick={{ fontSize: 11 }} unit=" A" domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#171717', borderColor: '#404040', borderRadius: '8px' }}
                    formatter={(val) => [`${val.toFixed(2)} A (${(val * 1000).toFixed(0)} mA)`, 'Current']}
                  />
                  <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="3 3" label={{ value: '0A Zero Line', fill: '#ef4444', fontSize: 10 }} />
                  <Area type="monotone" dataKey="currentA" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#currentGradient)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* GRAPH 2: Individual Cell Voltages 1-4 */}
        {(activeTab === 'all' || activeTab === 'cells') && (
          <div className="chart-box">
            <div className="chart-box-title">
              <span className="dot-title dot-cells"></span> Individual Cell Voltages (Cell 1 .. Cell 4 mV)
            </div>
            <div className="chart-wrapper">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={displayData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                  <XAxis dataKey="time" stroke="#737373" tick={{ fontSize: 11 }} />
                  <YAxis stroke="#737373" tick={{ fontSize: 11 }} domain={['dataMin - 20', 'dataMax + 20']} unit=" mV" />
                  <Tooltip contentStyle={{ backgroundColor: '#171717', borderColor: '#404040', borderRadius: '8px' }} />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Line type="monotone" dataKey="cell1" name="Cell 1" stroke="#6366f1" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="cell2" name="Cell 2" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="cell3" name="Cell 3" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="cell4" name="Cell 4" stroke="#ec4899" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* GRAPH 3: Total Voltage & Temperature */}
        {activeTab === 'all' && (
          <div className="chart-box full-width">
            <div className="chart-box-title">
              <span className="dot-title dot-temp"></span> Total Pack Voltage & Temperature Trends
            </div>
            <div className="chart-wrapper">
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={displayData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                  <XAxis dataKey="time" stroke="#737373" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" stroke="#3b82f6" tick={{ fontSize: 11 }} unit=" V" domain={['auto', 'auto']} />
                  <YAxis yAxisId="right" orientation="right" stroke="#f97316" tick={{ fontSize: 11 }} unit=" °C" domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ backgroundColor: '#171717', borderColor: '#404040', borderRadius: '8px' }} />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Line yAxisId="left" type="monotone" dataKey="voltageV" name="Pack Voltage (V)" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line yAxisId="right" type="monotone" dataKey="tempC" name="Temperature (°C)" stroke="#f97316" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
