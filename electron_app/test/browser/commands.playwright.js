// Run against the Vite development server with Playwright CLI run-code.
async (page) => {
  const check=(value,message)=>{if(!value)throw new Error(message);};
  await page.setViewportSize({width:1550,height:980});
  const profile=await page.evaluate(async()=> (await (await fetch('/bridge/catalog.json')).json()).profiles.r5);
  await page.addInitScript(profile => {
    window.commandCalls=[];
    window.catalogFixture={identity:{name:'BQ40Z50-R5',profile:'r5',version:'5.05',build:36},source:profile.source,commands:profile.commands,maintenance:null};
    window.electronAPI={
      scanDevices:async()=>[{type:'TI_CMAPI',name:'TI fixture',path:'fixture'}],
      onConnectionState:cb=>{window.stateFixture=cb;return()=>{};},
      onTelemetryUpdate:cb=>{window.telemetryFixture=cb;return()=>{};},onDebugLog:()=>()=>{},
      connectDevice:async()=>{window.stateFixture({connected:true,message:'Connected'});return {catalog:window.catalogFixture};},
      disconnectDevice:async()=>window.stateFixture({connected:false,message:'Disconnected'}),
      identifyBattery:async()=>window.catalogFixture,getBatteryCatalog:async()=>window.catalogFixture,
      batteryCommand:async request=>{
        window.commandCalls.push(request);
        if(request.action!=='read' && !window.approveFixture)return {cancelled:true};
        return {commandId:request.commandId,hex:'10 00 00 00',bytes:[16,0,0,0],unsigned:16,signed:16,timestamp:Date.now(),message:request.action==='read'?'Read complete':'Write acknowledged by transport; check device status.'};
      },
    };
  },profile);
  await page.reload();
  await page.getByRole('button',{name:'Connect Device',exact:true}).click();
  await page.getByRole('button',{name:/Registers & commands/}).click();
  check((await page.locator('.command-explorer').innerText()).includes('FW 5.05'),'Identity absent');
  check(await page.locator('.command-table tbody tr').count()===40,'Unbounded table rendering');
  await page.getByLabel('Command category').selectOption('mac');
  await page.getByLabel('Search registers').fill('0051');
  await page.getByRole('button',{name:'mac:0051',exact:true}).click();
  await page.getByRole('button',{name:'Read selected',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.command-result')?.textContent.includes('OCD1'));
  check((await page.locator('.command-result').innerText()).includes('OCD1 [4] = 1'),'Bit mapping incorrect');
  await page.getByLabel('Command category').selectOption('control');
  await page.getByLabel('Search registers').fill('001F');
  await page.getByRole('button',{name:'mac:001F',exact:true}).click();
  check(await page.getByRole('button',{name:'Execute once…',exact:true}).isDisabled(),'Write enabled without acknowledgement');
  await page.getByLabel('Confirm command ID').fill('mac:001F');
  await page.getByRole('button',{name:'Execute once…',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.command-explorer').textContent.includes('Cancelled — nothing sent'));
  await page.evaluate(()=>window.approveFixture=true);
  await page.getByRole('button',{name:'Execute once…',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.command-explorer').textContent.includes('Write acknowledged'));
  check(await page.getByLabel('Confirm command ID').inputValue()==='','Confirmation not cleared after execution');
  await page.getByLabel('Search registers').fill('0037');
  await page.getByRole('button',{name:'mac:0037',exact:true}).click();
  check(await page.getByRole('button',{name:'Read selected',exact:true}).isDisabled(),'Authentication key exposed as a readable key');
  check(await page.getByLabel('Command payload').getAttribute('type')==='password','Secret input is not masked');
  await page.getByLabel('Command category').selectOption('df');
  await page.getByLabel('Search registers').fill('df:RAW');
  await page.getByRole('button',{name:'df:RAW',exact:true}).click();
  check(await page.getByLabel('Data Flash address').inputValue()==='4000','Raw DF range UI missing');
  await page.getByRole('button',{name:'Disconnect EV2400',exact:true}).click();
  check(await page.getByRole('button',{name:'Execute once…',exact:true}).count()===0,'Stale command retained after disconnect');
  return {passed:true,catalogEntries:profile.commands.length,checks:['firmware identity','pagination/search','decoded status bits','control acknowledgement/cancellation','secret masking','DF controls','disconnect cleanup']};
}
