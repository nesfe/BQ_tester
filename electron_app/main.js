const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { BridgeClient } = require('./bridge/client');
const { Session } = require('./bridge/session');

let mainWindow = null;
let lastReadErrors = '';
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
  if (!state.connected) lastReadErrors = '';
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
  return session.connect(device);
});
ipcMain.handle('disconnect-device', async () => {
  await session.disconnect();
  return { success: true };
});
