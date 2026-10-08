import React, { useEffect, useMemo, useRef, useState } from 'react';

function decoded(entry, result) {
  if (!result) return 'Not read';
  if (result.error) return result.error;
  if (result.cancelled) return 'Cancelled';
  if (result.text !== undefined) return result.text;
  if (entry.dataType?.startsWith('I') && result.signed != null) return `${result.signed} ${entry.unit || ''}`;
  if (entry.dataType?.startsWith('U') && result.unsigned != null) return `${result.unsigned} ${entry.unit || ''}`;
  return result.hex || result.message;
}

export function CommandExplorer({ connected, catalog, onCatalog }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('sbs');
  const [page, setPage] = useState(0);
  const [selectedId, select] = useState('');
  const [results, setResults] = useState({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [hex, setHex] = useState('');
  const [word, setWord] = useState('');
  const [address, setAddress] = useState('4000');
  const [length, setLength] = useState(32);
  const [ack, setAck] = useState('');
  const generation = useRef(0);
  const cancelled = useRef(false);
  useEffect(() => {
    generation.current++; cancelled.current = true;
    setResults({}); setBusy(false); setNotice('');setHex('');setWord('');setAck('');
  }, [connected]);
  useEffect(() => { setPage(0); }, [query, group]);
  useEffect(() => { setHex(''); setWord('');setAck(''); }, [selectedId]);
  const entries = catalog?.commands || [];
  const filtered = useMemo(() => entries.filter(e => {
    const matchGroup = group === 'all' || (group === 'control' ? e.writable && e.kind !== 'df' : e.kind === group);
    return matchGroup && `${e.id} ${e.name} ${e.group || ''} ${(e.bits || []).map(b => b.code).join(' ')}`.toLowerCase().includes(query.toLowerCase());
  }), [entries, group, query]);
  const visible = filtered.slice(page * 40, page * 40 + 40);
  const selected = entries.find(e => e.id === selectedId);
  const selectedResult = results[selectedId];
  const load = async () => {
    const epoch = generation.current;
    setBusy(true);setNotice('Detecting device and firmware…');
    try {
      const next = await window.electronAPI.identifyBattery();
      if (generation.current === epoch) { onCatalog(next);setNotice(next.identity.error || 'Firmware detected'); }
    } catch (error) { if (generation.current === epoch) setNotice(error.message); }
    finally { if (generation.current === epoch) setBusy(false); }
  };
  const run = async (entry, action, epoch) => {
    try {
      const result = await window.electronAPI.batteryCommand({ commandId: entry.id, action,
        ...(action !== 'read' ? { hex, ...(word !== '' ? { value: Number(word) } : {}) } : {}),
        ...(entry.id === 'df:RAW' ? { address: parseInt(address,16), length: Number(length) } : {}),
      });
      if (epoch === generation.current) setResults(prev => ({ ...prev, [entry.id]: result }));
      return result;
    } catch (error) {
      if (epoch === generation.current) setResults(prev => ({ ...prev, [entry.id]: { error: error.message } }));
      throw error;
    }
  };
  const execute = async action => {
    if (!selected || busy) return;
    const epoch = generation.current;setBusy(true);setNotice('');
    try {
      const result = await run(selected, action, epoch);
      if (epoch === generation.current) {
        setNotice(result.cancelled ? 'Cancelled — nothing sent' : result.message);
        if (!result.cancelled && action !== 'read') { setHex('');setWord('');setAck(''); }
        if (!result.disconnect) {
          const next = await window.electronAPI.getBatteryCatalog();
          if (epoch === generation.current) onCatalog(next);
        }
      }
    } catch (error) {
      if (epoch === generation.current) {
        setNotice(action === 'read' ? error.message : `${error.message}. Telemetry paused after command error; reconnect or detect firmware to recover.`);
        try {
          const next = await window.electronAPI.getBatteryCatalog();
          if (epoch === generation.current) onCatalog(next);
        } catch {}
      }
    } finally { if (epoch === generation.current) setBusy(false); }
  };
  const readVisible = async () => {
    const epoch = generation.current;cancelled.current = false;setBusy(true);
    const reads = visible.filter(e => e.readable && !e.sensitive && e.kind !== 'df' && e.id !== 'sbs:0023');
    let done = 0;
    for (const entry of reads) {
      if (cancelled.current || generation.current !== epoch) break;
      try { await run(entry, 'read', epoch); } catch {}
      done++;if (epoch === generation.current) setNotice(`Read ${done}/${reads.length} registers; errors remain visible`);
    }
    if (epoch === generation.current) setBusy(false);
  };
  const exportSnapshot = () => {
    // Access/authentication keys and raw DF are intentionally excluded from snapshots.
    const publicResults = Object.fromEntries(Object.entries(results).filter(([id]) => {
      const e = entries.find(item => item.id === id);return e && !e.sensitive && e.kind !== 'key' && e.kind !== 'df';
    }));
    const url = URL.createObjectURL(new Blob([JSON.stringify({ identity: catalog?.identity, results: publicResults }, null, 2)], { type:'application/json' }));
    const link = document.createElement('a');link.href=url;link.download=`bq-registers-${Date.now()}.json`;link.click();setTimeout(() => URL.revokeObjectURL(url),1000);
  };
  const isWord = selected?.kind === 'sbs' && selected.protocol === 'word';
  const needsHex = selected && (selected.protocol === 'block' || selected.kind === 'key');
  return <section className="panel-box command-explorer">
    <div className="panel-header">
      <button className="btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>Registers & commands {open ? '▾' : '▸'}</button>
      <span>{catalog?.identity?.name || 'Firmware not detected'} {catalog?.identity?.version && ` · FW ${catalog.identity.version} · build ${catalog.identity.build}`}</span>
    </div>
    {open && <>
      <div className="command-toolbar">
        <button className="btn-sm" disabled={!connected || busy || ['ROM','calibration'].includes(catalog?.maintenance)} onClick={load}>Detect firmware</button>
        <input className="select-xs" aria-label="Search registers" placeholder="Name, address or bit…" value={query} onChange={e => setQuery(e.target.value)} />
        <select className="select-xs" aria-label="Command category" value={group} onChange={e => setGroup(e.target.value)}>
          <option value="sbs">SBS registers</option><option value="mac">ManufacturerAccess</option><option value="control">Control commands</option><option value="df">Data Flash</option><option value="all">All</option>
        </select>
        <button className="btn-sm" disabled={!connected || busy || Boolean(catalog?.maintenance)} onClick={readVisible}>Read visible</button>
        {busy && <button className="btn-sm" onClick={() => { cancelled.current=true; }}>Stop after current read</button>}
        <button className="btn-sm" disabled={!Object.keys(results).length} onClick={exportSnapshot}>Export snapshot</button>
      </div>
      {catalog?.identity?.error && <p role="alert">{catalog.identity.error}. Commands are unavailable until firmware is identified.</p>}
      {catalog?.maintenance && <p role="status">{catalog.maintenance} mode — normal telemetry paused. Use the corresponding exit command.</p>}
      <div className="command-layout">
        <div>
          <div className="command-table-scroll"><table className="command-table"><thead><tr><th>Command</th><th>Name</th><th>Access</th><th>Last result</th></tr></thead>
            <tbody>{visible.map(e => <tr key={e.id} className={selectedId===e.id ? 'command-selected' : ''}>
              <td><button className="btn-sm" onClick={() => select(e.id)}>{e.id}</button></td><td>{e.name}</td><td>{e.access}</td><td title={results[e.id]?.hex}>{decoded(e,results[e.id])}</td>
            </tr>)}</tbody></table></div>
          <div className="command-toolbar">
            <button className="btn-sm" disabled={page===0} onClick={() => setPage(page-1)}>Previous</button>
            <span>{filtered.length} entries · page {page+1}/{Math.max(1,Math.ceil(filtered.length/40))}</span>
            <button className="btn-sm" disabled={(page+1)*40>=filtered.length} onClick={() => setPage(page+1)}>Next</button>
          </div>
        </div>
        <div className="command-detail">
          {selected ? <>
            <h3>{selected.name}</h3><p>{selected.id} · {selected.protocol} · {selected.dataType || 'raw'} {selected.length ? ` · ${selected.length} bytes` : ''}</p>
            <p>{selected.effect || (selected.kind==='df' ? 'Persistent battery configuration. Read and preserve the original value before editing.' : 'Availability depends on firmware, security state and device configuration.')}</p>
            <p>SEALED read: {!selected.readable ? 'not available' : selected.sealed ? 'documented' : 'restricted / see TI manual'}. Write: {!selected.writable ? 'not available (read only)' : selected.writeSealed ? 'device may allow in SEALED mode' : 'UNSEALED / FULL ACCESS may be required'}.</p>
            <a href={`${catalog.source}#page=${selected.page}`} target="_blank" rel="noreferrer">TI documentation · {selected.section}</a>
            {selected.id==='df:RAW' && <div className="command-toolbar"><label>Address hex <input aria-label="Data Flash address" value={address} onChange={e => setAddress(e.target.value)} /></label><label>Bytes <input type="number" min="1" max="32" value={length} onChange={e => setLength(e.target.value)} /></label></div>}
            <button className="btn-sm" disabled={!connected || busy || !selected.readable} onClick={() => execute('read')}>Read selected</button>
            {selected.writable && <div className="command-write">
              {isWord && <label>Raw word (0–65535; decimal or 0xHEX)<input aria-label="Raw word" value={word} onChange={e => setWord(e.target.value)} /></label>}
              {needsHex && <label>Payload bytes (HEX, excluding command/address)<input aria-label="Command payload" type={selected.sensitive || selected.kind==='key' ? 'password' : 'text'} autoComplete="off" value={hex} onChange={e => setHex(e.target.value)} /></label>}
              {selected.writeLength && <p>Required payload: {selected.writeLength} bytes.</p>}
              {selected.inputHint && <p>{selected.inputHint}</p>}
              {selected.kind==='key' && <p>Enter two key words as four little-endian bytes. No keys are filled in or saved automatically.</p>}
              <label>Type {selected.id} to enable execution<input aria-label="Confirm command ID" autoComplete="off" value={ack} onChange={e => setAck(e.target.value)} /></label>
              <button className="btn btn-danger" disabled={!connected || busy || ack!==selected.id || (isWord && !word.trim()) || (needsHex && !hex.trim())} onClick={() => execute('write')}>Execute once…</button>
            </div>}
            {selectedResult && <div className="command-result"><p>{decoded(selected,selectedResult)}</p>{selectedResult.hex && decoded(selected,selectedResult)!==selectedResult.hex && <code>{selectedResult.hex}</code>}{selectedResult.timestamp && <p>Observed: {new Date(selectedResult.timestamp).toLocaleTimeString()}</p>}
              {selectedResult.bytes && (selected.bits || (selected.dataType?.startsWith('H') ? Array.from({length: Math.min(32,selectedResult.bytes.length*8)},(_,n)=>({code:`Bit ${n}`,lo:n,hi:n,label:'Raw bit (see TI manual for field meaning)'})) : [])).map(bit => {
                const number=selectedResult.bytes.reduce((n,b,i) => n+(BigInt(b)<<BigInt(8*i)),0n);
                const value=Number((number>>BigInt(bit.lo))&((1n<<BigInt(bit.hi-bit.lo+1))-1n));
                return <div key={`${bit.code}:${bit.lo}`} className={value ? 'command-bit-active' : ''}>{bit.code} [{bit.hi===bit.lo ? bit.lo : `${bit.hi}:${bit.lo}`}] = {value} — {bit.label}</div>;
              })}
            </div>}
          </> : <p>Select a register or command. Reads are on demand; opening this panel does not start a full battery scan.</p>}
        </div>
      </div>
      {notice && <p role="status">{notice}</p>}
    </>}
  </section>;
}
