const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let hidModule = null;
try {
  hidModule = require('node-hid');
} catch (e) {
  console.warn("node-hid not available, falling back to simulated/mock HID mode:", e.message);
}

const TI_VID = 0x0451;
const EV2400_PIDS = [0x0037, 0x0036, 0x0034, 0x0035, 0x0038];

let mainWindow = null;
let activeDevice = null;
let pollingInterval = null;
let activeHeader = 0x33; // Default EV2400 header

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    title: "BQ_tester — BQ40Z50 Real-Time Battery Debugger",
    backgroundColor: "#0b0e14",
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (pollingInterval) clearInterval(pollingInterval);
  if (activeDevice) {
    try { activeDevice.close(); } catch(e) {}
  }
  if (process.platform !== 'darwin') app.quit();
});

// === IPC Hardware Communication Handlers ===

// 1. Scan for USB HID Devices
ipcMain.handle('scan-devices', async () => {
  if (!hidModule) {
    return [{ name: "⚠️ node-hid Native Module Not Loaded", path: "", type: "NONE" }];
  }

  try {
    const devices = hidModule.devices();
    const found = [];
    const seenPaths = new Set();

    for (const d of devices) {
      const vid = d.vendorId;
      const pid = d.productId;
      const pathStr = d.path;

      if (seenPaths.has(pathStr)) continue;

      if (vid === TI_VID || EV2400_PIDS.includes(pid) || (d.product && d.product.includes('EV2400'))) {
        seenPaths.add(pathStr);
        found.push({
          name: `🔌 TI ${d.product || 'EV2400'} (VID:0x${vid.toString(16).padStart(4,'0')} PID:0x${pid.toString(16).padStart(4,'0')} IF:${d.interface})`,
          path: pathStr,
          vid, pid, interface: d.interface,
          type: "EV2400"
        });
      }
    }

    if (found.length === 0) {
      found.push({
        name: "⚡ Force Connect TI EV2400 (Default VID:0x0451 PID:0x0037)",
        path: "FORCE",
        vid: TI_VID,
        pid: 0x0037,
        type: "EV2400_FORCE"
      });
    }

    return found;
  } catch (e) {
    console.error("Scan error:", e);
    return [{ name: `Scan Error: ${e.message}`, path: "", type: "ERROR" }];
  }
});

// 2. Connect to Selected USB HID EV2400 Device
ipcMain.handle('connect-device', async (event, deviceInfo) => {
  if (pollingInterval) clearInterval(pollingInterval);
  if (activeDevice) {
    try { activeDevice.close(); } catch(e) {}
    activeDevice = null;
  }

  if (!hidModule) {
    throw new Error("node-hid native USB module is not available.");
  }

  try {
    if (deviceInfo.path && deviceInfo.path !== "FORCE") {
      activeDevice = new hidModule.HID(deviceInfo.path);
    } else {
      const vid = deviceInfo.vid || TI_VID;
      const pid = deviceInfo.pid || 0x0037;
      activeDevice = new hidModule.HID(vid, pid);
    }

    // Auto-probe working SMBus header (0x33, 0x0B, 0x03, 0x16)
    probeHeader();

    // Start 10Hz High-Speed Background Polling
    pollingInterval = setInterval(pollTelemetry, 100);
    return { success: true, message: "Connected to TI EV2400 SMBus" };
  } catch (err) {
    throw new Error(`Failed to open EV2400 USB port. Make sure TI bqStudio is CLOSED! Details: ${err.message}`);
  }
});

// 3. Disconnect Device
ipcMain.handle('disconnect-device', async () => {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = null;
  if (activeDevice) {
    try { activeDevice.close(); } catch(e) {}
    activeDevice = null;
  }
  return { success: true };
});

// Auto-probe working EV2400 SMBus HID header format
function probeHeader() {
  if (!activeDevice) return;
  const testHeaders = [0x33, 0x0B, 0x03, 0x16, 0x2C];
  for (const hdr of testHeaders) {
    const val = readSmbusWord(0x09, hdr); // Voltage (0x09)
    if (val !== null && val > 2000 && val < 30000) {
      activeHeader = hdr;
      console.log(`[EV2400 Electron Engine] Locked onto SMBus Header: 0x${hdr.toString(16)}`);
      return;
    }
  }
}

// Low-Level USB HID SMBus Read Word transaction
function readSmbusWord(regCmd, header = activeHeader, slaveAddr = 0x16) {
  if (!activeDevice) return null;

  const pkt = new Uint8Array(64);
  pkt[0] = 0x00;           // Report ID
  pkt[1] = header;         // EV2400 SMBus Command Header
  pkt[2] = slaveAddr & 0xFE; // BQ40Z50 8-bit Write Address (0x16)
  pkt[3] = regCmd & 0xFF;  // Register Command
  pkt[4] = 0x02;           // Read 2 bytes

  try {
    activeDevice.write(Array.from(pkt));
    const res = activeDevice.readTimeout(200);
    if (res && res.length >= 3) {
      if (res.length >= 4 && (res[0] === 0x00 || res[0] === header)) {
        const val = res[2] | (res[3] << 8);
        return val !== 0xFFFF ? val : null;
      } else {
        const val = res[1] | (res[2] << 8);
        return val !== 0xFFFF ? val : null;
      }
    }
  } catch (e) {
    // Fail silently on single register read
  }
  return null;
}

// Polling Loop executed at 10Hz
function pollTelemetry() {
  if (!activeDevice || !mainWindow) return;

  const v = readSmbusWord(0x09);       // Pack Voltage (mV)
  const i_raw = readSmbusWord(0x0A);   // Current (mA)
  const c1 = readSmbusWord(0x3F);      // Cell 1 (mV)
  const c2 = readSmbusWord(0x3E);      // Cell 2 (mV)
  const c3 = readSmbusWord(0x3D);      // Cell 3 (mV)
  const c4 = readSmbusWord(0x3C);      // Cell 4 (mV)
  const soc = readSmbusWord(0x0D);     // SoC (%)
  const temp = readSmbusWord(0x08);    // Temp (0.1 K)
  const sf = readSmbusWord(0x51);      // SafetyStatus
  const op = readSmbusWord(0x54);      // OperationStatus

  if (v === null && c1 === null && temp === null) {
    return; // Skip empty frames
  }

  let i_val = 0;
  if (i_raw !== null) {
    i_val = i_raw < 32768 ? i_raw : (i_raw - 65536);
  }

  const telemetry = {
    v: v || 0,
    i: i_val,
    c1: c1 || 0,
    c2: c2 || 0,
    c3: c3 || 0,
    c4: c4 || 0,
    soc: soc || 0,
    temp: temp || 2982,
    sf: sf || 0,
    op: op || 0x0007,
    timestamp: Date.now()
  };

  // Push frame directly to renderer process over IPC
  mainWindow.webContents.send('telemetry-update', telemetry);
}
