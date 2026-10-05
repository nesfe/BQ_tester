const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { BridgeClient } = require('./bridge/client');
const { Session } = require('./bridge/session');

let mainWindow = null;
let lastReadErrors = '';
let detectedCatalog = null;
let detectedGeneration = -1;
const createBridge = () => new BridgeClient({
  packaged: app.isPackaged, resourcesPath: process.resourcesPath, log: logToUI,
});
const session = new Session(createBridge);

function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function logToUI(msg, level = 'info') {
  send('debug-log', { time: new Date().toISOString().slice(11, 23), msg, level });
}

session.on('state', state => {
  if (!state.connected) { lastReadErrors = ''; detectedCatalog = null; detectedGeneration = -1; }
  send('connection-state', state);
  logToUI(state.message, state.connected ? 'success' : 'warning');
});
session.on('log', logToUI);
session.on('telemetry', data => {
  send('telemetry-update', data);
  const errors = Object.values(data.errors || {}).join('; ');
  if (errors !== lastReadErrors) {
    logToUI(errors || 'All telemetry reads recovered', errors ? 'warning' : 'success');
    lastReadErrors = errors;
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1550, height: 980,
    title: 'BQ_tester — BQ40Z50 Real-Time Battery Debugger',
    backgroundColor: '#0b0e14',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true },
  });
  if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (process.platform === 'darwin') session.disconnect();
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
let shuttingDown = false;
app.on('before-quit', event => {
  if (shuttingDown) return;
  event.preventDefault();
  shuttingDown = true;
  session.disconnect().finally(() => app.quit());
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

const settingsPath = () => path.join(app.getPath('userData'), 'ti-settings.json');
async function scan(directory) {
  const bridge = createBridge();
  try {
    return await bridge.request('scan', { directory });
  } finally {
    await bridge.close().catch(() => {});
  }
}
ipcMain.handle('scan-devices', async () => {
  let directory;
  try { ({ directory } = JSON.parse(await fs.readFile(settingsPath(), 'utf8'))); } catch {}
  try { return await scan(directory); } catch (error) {
    logToUI(error.message, 'danger');
    throw error;
  }
});
ipcMain.handle('choose-ti-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select bqStudio / TI SDK folder containing CMAPI.dll and commmgr.exe',
    properties: ['openDirectory'],
  });
  if (result.canceled) return null;
  const directory = result.filePaths[0];
  const devices = await scan(directory);
  await fs.writeFile(settingsPath(), JSON.stringify({ directory }), 'utf8');
  return devices;
});
ipcMain.handle('connect-device', async (_event, device) => {
  if (!device || device.type !== 'TI_CMAPI') throw new Error('Select a TI CMAPI installation first');
  logToUI(`Opening TI CMAPI: ${device.path}; SMBus address 0x16`, 'info');
  const result = await session.connect(device);
  try { result.catalog = await identifyBattery(); }
  catch (error) { logToUI(`Firmware detection: ${error.message}`, 'warning'); }
  return result;
});
ipcMain.handle('disconnect-device', async () => {
  await session.disconnect();
  return { success: true };
});

// The renderer supplies a catalogue ID, never an unrestricted SMBus operation.
ipcMain.handle('battery-catalog', async () => {
  const result = await session.command('catalog');
  return { ...result, maintenance: result.maintenance || session.maintenance };
});
async function identifyBattery() {
  const result = await session.command('identify');
  detectedCatalog = result; detectedGeneration = session.generation;
  return result;
}
ipcMain.handle('battery-identify', identifyBattery);
let commandDialogOpen = false;
ipcMain.handle('battery-command', async (_event, input) => {
  if (!input || !['read', 'write', 'execute'].includes(input.action)) throw new Error('Invalid action');
  const generation = session.generation;
  const catalog = detectedCatalog && detectedGeneration === generation ? detectedCatalog : await session.command('catalog');
  const entry = catalog.commands.find(item => item.id === input.commandId);
  if (!entry) throw new Error('Command is not supported by the detected firmware');
  const mutation = input.action !== 'read';
  if (mutation) {
    if (commandDialogOpen) throw new Error('Another command confirmation is open');
    commandDialogOpen = true;
    try {
      const answer = await dialog.showMessageBox(mainWindow, {
        type: 'warning', buttons: ['Cancel', 'Execute once'], defaultId: 0, cancelId: 0,
        title: `${entry.name} — ${catalog.identity.name}`,
        message: `Execute ${entry.id} ${entry.name}?`,
        detail: `${entry.effect || ''}\nTarget: ${entry.id === 'df:RAW' ? `0x${Number(input.address).toString(16).toUpperCase()} (${input.length} bytes)` : entry.id}\n${entry.kind === 'df' ? 'This overwrites persistent battery configuration.' : 'This can change battery operation, protection, power output or access state.'}\n${entry.kind === 'key' || entry.sensitive ? 'Secret payload is excluded from the log.' : `Payload: ${input.hex || (input.value != null ? String(input.value) : '(none)')}`}\nNo automatic retry. Check the TI command documentation and disconnect the load if required.`,
      });
      if (answer.response !== 1) return { cancelled: true };
    } finally { commandDialogOpen = false; }
  }
  if (session.generation !== generation) throw new Error('Connection changed; command cancelled');
  const args = { commandId: input.commandId, action: input.action, value: input.value,
    hex: input.hex, address: input.address, length: input.length, confirmed: mutation };
  logToUI(`${input.action}: ${entry.id} ${entry.name}`, 'info');
  try {
    const result = await session.command('execute', args);
    logToUI(`${entry.id}: ${result.message}`, 'success');
    return result;
  } catch (error) {
    logToUI(`${entry.id}: ${error.message}`, 'danger');
    throw error;
  }
});
