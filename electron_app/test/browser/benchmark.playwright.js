// Two production previews: v2.1.0 on 5186, current branch on 5187.
async (page) => {
 const measure = async (page) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const before = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const frames = await page.evaluate(() => new Promise(resolve => {
    const start = performance.now(), intervals = [];
    let last = start;
    function frame(now) {
      intervals.push(now - last); last = now;
      if (now - start < 10000) requestAnimationFrame(frame);
      else resolve({ frames: intervals.length, slowFrames: intervals.filter(n => n > 34).length, longestMs: Math.max(...intervals) });
    }
    requestAnimationFrame(frame);
  }));
  const after = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const result = { ...frames };
  for (const name of ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration']) result[name] = after[name] - before[name];
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await cdp.detach();
  return result;
};
  await page.setViewportSize({ width: 1550, height: 980 });
  await page.addInitScript(() => {
    window.electronAPI = {
      scanDevices: async () => [{ name: 'TI test installation', type: 'TI_CMAPI', path: 'fixture' }],
      onConnectionState: cb => { window.testState = cb; return () => {}; },
      onTelemetryUpdate: cb => { window.testTelemetry = cb; return () => {}; },
      onDebugLog: cb => () => {},
      connectDevice: async () => { window.testState({ connected: true, message: 'Connected via TI CMAPI' }); return { success: true }; },
      disconnectDevice: async () => { window.testState({ connected: false, message: 'Disconnected' }); },
      chooseTIDirectory: async () => null,
    };
    window.startTelemetryFixture = () => {
      clearInterval(window.fixtureTimer);
      let n = 0;
      window.fixtureTimer = setInterval(() => {
        const i = Math.round(Math.sin(n / 8) * 3000);
        window.testTelemetry({ v:14800, i, c1:3700+n%10, c2:3710, c3:3680, c4:3710,
          temp:2982, soc:50, sf:n%60>=40?16:0, op: n%40>=20?268435462:6,
          hasValidData:true, errors:{}, timestamp:Date.now() });
        n++;
      }, 100);
    };
  });

 const results=[];
 for (const [version, port] of [['2.1.0',5186], ['2.2.0',5187]]) {
  await page.goto(`http://127.0.0.1:${port}`);
  await page.getByRole('button',{name:'Connect Device',exact:true}).click();
  await page.getByRole('button',{name:'Start CSV Log',exact:true}).click();
  await page.evaluate(() => {
    const base = Date.now();
    for(let n=-100;n<0;n++) window.testTelemetry({v:14800,i:Math.round(Math.sin(n/8)*3000),c1:3700+n%10,c2:3710,c3:3680,c4:3710,temp:2982,soc:50,sf:n%60>=40?16:0,op:n%40>=20?268435462:6,hasValidData:true,errors:{},timestamp:base+n*100});
    window.startTelemetryFixture();
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  results.push({version,...await measure(page)});
  await page.evaluate(() => clearInterval(window.fixtureTimer));
 }
 return results;
}
