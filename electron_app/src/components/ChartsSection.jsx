import React, { useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine
} from 'recharts';
import { Pause, Play, RefreshCw } from 'lucide-react';

export function ChartsSection({ history, isPaused, setIsPaused, onClearHistory }) {
  const [windowSize, setWindowSize] = useState(100);

  const displayData = history.slice(-windowSize).map(item => ({
    time: item.timeStr,
    currentA: (item.i / 1000.0),
    voltageV: (item.v / 1000.0),
    cell1: item.c1,
    cell2: item.c2,
    cell3: item.c3,
    cell4: item.c4,
    tempC: (item.temp / 10.0),
    soc: item.soc
  }));

  return (
    <div className="charts-container">
      <div className="charts-header">
        <h2 className="section-title">Real-Time Telemetry Waveforms</h2>
        <div className="controls-group">
          <button className="btn-sm" onClick={() => setIsPaused(!isPaused)}>
            {isPaused ? <Play size={14} /> : <Pause size={14} />} {isPaused ? 'Resume' : 'Pause'}
          </button>
          <button className="btn-sm" onClick={onClearHistory}>
            <RefreshCw size={14} /> Clear
          </button>
        </div>
      </div>

      <div className="charts-grid">
        <div className="chart-box">
          <div className="chart-box-title">Pack Current (A)</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={displayData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
              <XAxis dataKey="time" stroke="#737373" tick={{ fontSize: 11 }} />
              <YAxis stroke="#737373" tick={{ fontSize: 11 }} unit=" A" domain={['auto', 'auto']} />
              <Tooltip contentStyle={{ backgroundColor: '#171717', borderColor: '#404040' }} />
              <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="3 3" />
              <Area type="monotone" dataKey="currentA" stroke="#6366f1" fill="#6366f1" fillOpacity={0.2} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-box">
          <div className="chart-box-title">Individual Cell Voltages (mV)</div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={displayData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
              <XAxis dataKey="time" stroke="#737373" tick={{ fontSize: 11 }} />
              <YAxis stroke="#737373" tick={{ fontSize: 11 }} domain={['dataMin - 20', 'dataMax + 20']} unit=" mV" />
              <Tooltip contentStyle={{ backgroundColor: '#171717', borderColor: '#404040' }} />
              <Line type="monotone" dataKey="cell1" name="Cell 1" stroke="#6366f1" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="cell2" name="Cell 2" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="cell3" name="Cell 3" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="cell4" name="Cell 4" stroke="#ec4899" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
