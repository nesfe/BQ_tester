// Run with Playwright CLI run-code; see docs/TELEMETRY_CHARTS.md.
async (page) => {
  const check = (ok, message) => { if (!ok) throw new Error(message); };
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
  await page.reload();
  await page.getByRole('button', {name:'Connect Device',exact:true}).click();
  await page.getByRole('button', {name:'Start CSV Log',exact:true}).click();
  await page.evaluate(() => {
    window.fixtureBase = Date.now();
    for (let n = 0; n <= 100; n++) window.testTelemetry({
      v:14800, i:n === 70 ? null : -n*10, c1:3700, c2:3710, c3:3680, c4:3710,
      temp:2982, soc:50, sf:n === 70 ? null : n>=60 && n<80 ? 16 : 0,
      op:n===70 ? null : n>=60 && n<80 ? 268435462 : 6,
      hasValidData:true, errors:{}, timestamp:window.fixtureBase-10000+n*100,
    });
  });
  await page.getByRole('button', {name:'Pause',exact:true}).click();
  const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await frame();
  const chart = page.getByRole('img', {name:/Pack Current/});
  const bitmap = () => chart.locator('..').evaluate(el => [...el.querySelectorAll('canvas')].map(c => c.toDataURL()+c.style.transform).join('|'));
  await chart.focus();
  await chart.press('Escape');
  await frame();
  const before = await bitmap();
  await page.evaluate(() => window.testTelemetry({v:14800,i:0,c1:3700,c2:3710,c3:3680,c4:3710,temp:2982,soc:50,sf:16,op:268435462,hasValidData:true,errors:{},timestamp:window.fixtureBase+100}));
  await frame();
  check(await bitmap() === before, 'Paused chart changed while acquiring');
  check(await page.getByRole('button', {name:/REC \(102\)/}).count() === 1, 'Pause dropped recorded sample');
  await chart.focus();
  await chart.press('ArrowLeft');
  await frame();
  check((await page.getByRole('tooltip').innerText()).includes('OCD1 OFF'), 'Missing clear marker');
  await chart.press('ArrowLeft');
  await frame();
  let text = await page.getByRole('tooltip').innerText();
  check(text.includes('OCD1 ON') && text.includes('CB ON') && text.includes('0x10000006') && text.includes('-0.600 A'), 'Grouped marker has wrong flags or current: '+text);
  await chart.press('Escape');
  await frame();
  check(await page.getByRole('tooltip').count() === 0, 'Escape did not dismiss');
  check(await bitmap() === before, 'Escape left a stale crosshair on paused chart');
  await chart.press('ArrowLeft');
  await frame();
  await page.mouse.move(0,0);
  await chart.blur();
  await frame();
  check(await bitmap() === before, 'Blur left a stale crosshair');
  await page.evaluate(() => {
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => {window.exportedCSV = blob.text(); return original(blob);};
  });
  await page.getByRole('button', {name:'Export CSV (102)',exact:true}).click();
  const csv = await page.evaluate(() => window.exportedCSV);
  const rows = csv.trim().split('\n');
  check(rows.length === 103, 'CSV lost batched samples');
  check(rows[61].endsWith('OCD1:ASSERTED;CB:ASSERTED'), 'CSV missing grouped assertion');
  check(rows[81].endsWith('OCD1:CLEARED;CB:CLEARED'), 'CSV missing grouped clearing');
  check(rows[71].split(',')[3] === '' && rows[71].split(',')[10] === '', 'Unknown became zero');
  await page.getByRole('button', {name:'Clear',exact:true}).click();
  await frame();
  await chart.focus();
  await chart.press('ArrowLeft');
  await frame();
  check(await page.getByRole('tooltip').count() === 0, 'Clear retained markers');
  await page.getByRole('button', {name:'Resume',exact:true}).click();
  await page.evaluate(() => window.testTelemetry({v:14800,i:0,c1:3700,c2:3710,c3:3680,c4:3710,temp:2982,soc:50,sf:0,op:6,hasValidData:true,errors:{},timestamp:Date.now()}));
  await frame();
  check(await bitmap() !== before, 'Resume did not render');
  await page.getByRole('button', {name:'Disconnect EV2400',exact:true}).click();
  await page.getByRole('button', {name:'Connect Device',exact:true}).click();
  await page.evaluate(() => window.testTelemetry({v:14800,i:0,c1:3700,c2:3710,c3:3680,c4:3710,temp:2982,soc:50,sf:16,op:6,hasValidData:true,errors:{},timestamp:Date.now()}));
  await frame();
  await chart.focus();
  await chart.press('ArrowLeft');
  await frame();
  text = await page.getByRole('tooltip').innerText();
  check(text.includes('OCD1 already active'), 'Reconnect invented protection trip');
  return {passed:true, csvRows:rows.length-1, checks:['batched acquisition','pause and recording','grouped ON/OFF markers','keyboard/Escape/blur','CSV flags/timestamps/missing values','clear/resume','reconnect initial status']};
}
