const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let hidModule = null;
try {
  hidModule = require('node-hid');
} catch (e) {
  console.warn("node-hid not available:", e.message);
}

const TI_VID = 0x0451;
const EV2400_PIDS = [0x0037, 0x0036, 0x0034, 0x0035, 0x0038];

let mainWindow = null;
let activeDevice = null;
let pollingInterval = null;

// Locked HID Write Buffer Size & Mode
let lockedWriteSize = null;
let lockedWriteMode = null;

// Locked SMBus Protocol Parameters after Auto-Probe
let workingHeader = 0x0B;
let workingAddr = 0x16; // 8-bit write address
let workingOffset = 2;  // Offset in HID response
let workingEndian = 'LE'; // Little Endian

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1550,
    height: 980,
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

function logToUI(msg, level = 'info') {
  if (mainWindow) {
    mainWindow.webContents.send('debug-log', {
      time: new Date().toTimeString().split(' ')[0] + '.' + String(new Date().getMilliseconds()).padStart(3, '0'),
      msg,
      level
    });
  }
}

// === Safe HID Write with Auto Buffer-Size Lock (Fixes Windows WriteFile 0x00000057 / ERROR_INVALID_PARAMETER) ===
function safeWrite(device, reportId, payloadBytes) {
  if (!device) return false;

  const payload = Array.isArray(payloadBytes) ? payloadBytes : Array.from(payloadBytes);

  // If we already locked in the working write buffer size and mode, use it directly!
  if (lockedWriteSize && lockedWriteMode) {
    const buf = new Uint8Array(lockedWriteSize);
    buf[0] = reportId;
    for (let i = 0; i < payload.length && (i + 1) < lockedWriteSize; i++) {
      buf[i + 1] = payload[i];
    }
    const arr = Array.from(buf);
    if (lockedWriteMode === 'write') {
      device.write(arr);
    } else {
      device.sendFeatureReport(arr);
    }
    return true;
  }

  // Windows HID expects exact report lengths matching device descriptor (65, 64, 33, 17, 9)
  const sizesToTry = [65, 64, 33, 17, 9];

  for (const size of sizesToTry) {
    try {
      const buf = new Uint8Array(size);
      buf[0] = reportId;
      for (let i = 0; i < payload.length && (i + 1) < size; i++) {
        buf[i + 1] = payload[i];
      }
      const arr = Array.from(buf);
      device.write(arr);
      lockedWriteSize = size;
      lockedWriteMode = 'write';
      logToUI(`✅ Locked HID Output Report Size: ${size} bytes (device.write)`, 'info');
      return true;
    } catch (e) {}
  }

  // Fallback to sendFeatureReport if Output Report is rejected
  for (const size of sizesToTry) {
    try {
      const buf = new Uint8Array(size);
      buf[0] = reportId;
      for (let i = 0; i < payload.length && (i + 1) < size; i++) {
        buf[i + 1] = payload[i];
      }
      const arr = Array.from(buf);
      device.sendFeatureReport(arr);
      lockedWriteSize = size;
      lockedWriteMode = 'feature';
      logToUI(`✅ Locked HID Feature Report Size: ${size} bytes (sendFeatureReport)`, 'info');
      return true;
    } catch (e) {}
  }

  throw new Error("Cannot write to HID device: WriteFile ERROR_INVALID_PARAMETER (0x57) on all report sizes.");
}

// === IPC Handlers ===

ipcMain.handle('scan-devices', async () => {
  if (!hidModule) {
    return [{ name: "⚠️ node-hid Native Module Not Loaded", path: "", type: "NONE" }];
  }

  try {
    const devices = hidModule.devices();
    const found = [];
    const seenPaths = new Set();

    // Sort devices so interface 0 comes first
    devices.sort((a, b) => (a.interface ?? 99) - (b.interface ?? 99));

    for (const d of devices) {
      const vid = d.vendorId;
      const pid = d.productId;
      const pathStr = d.path;

      if (seenPaths.has(pathStr)) continue;

      if (vid === TI_VID || EV2400_PIDS.includes(pid) || (d.product && d.product.toUpperCase().includes('EV2400'))) {
        seenPaths.add(pathStr);
        const isSmbus = d.interface === 0 || pathStr.includes('MI_00');
        const label = isSmbus ? " [SMBus - Recommended]" : ` [IF:${d.interface}]`;
        found.push({
          name: `🔌 TI ${d.product || 'EV2400'} (PID:0x${pid.toString(16).padStart(4,'0')}${label})`,
          path: pathStr,
          vid, pid, interface: d.interface,
          type: "EV2400"
        });
      }
    }

    if (found.length === 0) {
      found.push({
        name: "⚡ Auto-Detect EV2400 SMBus Interface 0",
        path: "AUTO_IF0",
        vid: TI_VID,
        pid: 0x0037,
        type: "EV2400_FORCE"
      });
    }

    return found;
  } catch (e) {
    return [{ name: `Scan Error: ${e.message}`, path: "", type: "ERROR" }];
  }
});

ipcMain.handle('connect-device', async (event, deviceInfo) => {
  if (pollingInterval) clearInterval(pollingInterval);
  if (activeDevice) {
    try { activeDevice.close(); } catch(e) {}
    activeDevice = null;
  }
  lockedWriteSize = null;
  lockedWriteMode = null;

  if (!hidModule) {
    throw new Error("node-hid module unavailable.");
  }

  try {
    let targetPath = deviceInfo.path;

    // Search for Interface 0 specifically if AUTO_IF0 or FORCE
    if (!targetPath || targetPath === "AUTO_IF0" || targetPath === "FORCE") {
      const devList = hidModule.devices();
      const match = devList.find(d => 
        (d.vendorId === TI_VID || EV2400_PIDS.includes(d.productId)) && 
        (d.interface === 0 || d.path.includes('MI_00'))
      );
      if (match) {
        targetPath = match.path;
        logToUI(`Found EV2400 SMBus Interface 0: ${targetPath}`, 'info');
      }
    }

    if (targetPath && targetPath !== "AUTO_IF0" && targetPath !== "FORCE") {
      activeDevice = new hidModule.HID(targetPath);
      logToUI(`Opened EV2400 USB path: ${targetPath}`, 'success');
    } else {
      const vid = deviceInfo.vid || TI_VID;
      const pid = deviceInfo.pid || 0x0037;
      activeDevice = new hidModule.HID(vid, pid);
      logToUI(`Opened EV2400 by VID:0x${vid.toString(16)} PID:0x${pid.toString(16)}`, 'success');
    }

    // Send EV2400 SMBus Clock & Pullup Config using safeWrite
    initEV2400SMBus();

    // Probe SMBus headers, slave addresses, and response offsets
    const probeSuccess = probeProtocol();

    if (!probeSuccess) {
      logToUI('⚠️ Bus probe could not confirm battery telemetry. Polling will attempt default SMBus parameters...', 'warning');
    }

    // Start 10Hz Telemetry Polling
    pollingInterval = setInterval(pollTelemetry, 100);
    return { success: true };
  } catch (err) {
    logToUI(`Connect Error: ${err.message}`, 'danger');
    throw new Error(`Could not open EV2400 USB port. Make sure TI bqStudio is CLOSED! Details: ${err.message}`);
  }
});

ipcMain.handle('disconnect-device', async () => {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = null;
  if (activeDevice) {
    try { activeDevice.close(); } catch(e) {}
    activeDevice = null;
  }
  logToUI('Disconnected from EV2400', 'warning');
  return { success: true };
});

function initEV2400SMBus() {
  if (!activeDevice) return;
  try {
    // 1. Send EV2400 SMBus 100kHz clock init packet
    safeWrite(activeDevice, 0x00, [0x10, 0x00, 0x01]);

    // 2. Enable EV2400 3.3V internal SMBus pullup resistors
    safeWrite(activeDevice, 0x00, [0x2C, 0x01, 0x01]);

    // 3. Enable Port Power
    safeWrite(activeDevice, 0x00, [0x01, 0x01, 0x01]);

    logToUI('✅ EV2400 SMBus Port Configured (100kHz Clock, Internal Pullups ENABLED)', 'success');
  } catch(e) {
    logToUI(`EV2400 Init Warning: ${e.message}`, 'warning');
  }
}

function probeProtocol() {
  if (!activeDevice) return false;

  const testHeaders = [0x0B, 0x33, 0x03, 0x05, 0x08, 0x16, 0x2C];
  const testAddrs = [0x16, 0x0B, 0x17];
  const testOffsets = [2, 1, 3];
  const testEndians = ['LE', 'BE'];

  logToUI('Scanning EV2400 SMBus packet formats on BQ40Z50...', 'info');

  for (const hdr of testHeaders) {
    for (const addr of testAddrs) {
      for (const offset of testOffsets) {
        for (const endian of testEndians) {
          const val = rawReadWord(0x09, hdr, addr, offset, endian);
          if (val !== null && val >= 2500 && val <= 25000) {
            // Verify with temperature (0x08)
            const tempVal = rawReadWord(0x08, hdr, addr, offset, endian);
            const socVal = rawReadWord(0x0D, hdr, addr, offset, endian);

            const isTempValid = tempVal !== null && tempVal >= 2500 && tempVal <= 3600;
            const isSocValid = socVal !== null && socVal >= 0 && socVal <= 100;

            if (isTempValid || isSocValid) {
              workingHeader = hdr;
              workingAddr = addr;
              workingOffset = offset;
              workingEndian = endian;

              const vVolts = (val / 1000).toFixed(3);
              const tempC = tempVal ? ((tempVal / 10) - 273.15).toFixed(1) : "N/A";
              logToUI(`✅ LOCKED SMBUS PARAMS! Header:0x${hdr.toString(16).toUpperCase()} Addr:0x${addr.toString(16).toUpperCase()} Offset:${offset} Endian:${endian}`, 'success');
              logToUI(`🔋 Live Packet Verified -> Voltage: ${vVolts}V | Temp: ${tempC}°C | SoC: ${socVal !== null ? socVal + '%' : 'N/A'}`, 'success');
              return true;
            }
          }
        }
      }
    }
  }

  logToUI('❌ SMBus Auto-Probe Warning: No battery telemetry response received.', 'danger');
  logToUI('📋 Check hardware connections: 1) SCL, SDA, GND wired properly? 2) Battery pack awake (VSTART)? 3) bqStudio closed?', 'warning');
  return false;
}

function rawReadWord(regCmd, hdr = workingHeader, addr = workingAddr, offset = workingOffset, endian = workingEndian) {
  if (!activeDevice) return null;

  // Flush stale reports from node-hid internal queue before sending new request
  try {
    let dummy;
    let limit = 0;
    do {
      dummy = activeDevice.readTimeout(2);
      limit++;
    } while (dummy && dummy.length > 0 && limit < 10);
  } catch(e) {}

  try {
    safeWrite(activeDevice, 0x00, [hdr & 0xFF, addr & 0xFF, regCmd & 0xFF, 0x02]);
    const res = activeDevice.readTimeout(120);

    if (res && res.length > (offset + 1)) {
      // Check for error/NACK status bytes
      if (res[1] === 0xFF && res[2] === 0xFF) return null;

      let val = 0;
      if (endian === 'LE') {
        val = res[offset] | (res[offset + 1] << 8);
      } else {
        val = (res[offset] << 8) | res[offset + 1];
      }

      if (val !== 0xFFFF && val !== 0x0000) {
        return val;
      }
    }
  } catch (e) {}

  return null;
}

function pollTelemetry() {
  if (!activeDevice || !mainWindow) return;

  const v = rawReadWord(0x09);       // Pack Voltage (mV)
  const i_raw = rawReadWord(0x0A);   // Current (mA)
  const c1 = rawReadWord(0x3F);      // Cell 1 (mV)
  const c2 = rawReadWord(0x3E);      // Cell 2 (mV)
  const c3 = rawReadWord(0x3D);      // Cell 3 (mV)
  const c4 = rawReadWord(0x3C);      // Cell 4 (mV)
  const soc = rawReadWord(0x0D);     // SoC (%)
  const temp = rawReadWord(0x08);    // Temp (0.1 K)
  const sf = rawReadWord(0x51);      // SafetyStatus
  const op = rawReadWord(0x54);      // OperationStatus

  let i_val = 0;
  if (i_raw !== null) {
    i_val = i_raw < 32768 ? i_raw : (i_raw - 65536);
  }

  // Always emit telemetry object so UI updates
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
    hasValidData: (v !== null || c1 !== null || temp !== null),
    timestamp: Date.now()
  };

  mainWindow.webContents.send('telemetry-update', telemetry);
}


