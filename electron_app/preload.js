const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  chooseTIDirectory: () => ipcRenderer.invoke('choose-ti-directory'),
  onConnectionState: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('connection-state', subscription);
    return () => ipcRenderer.removeListener('connection-state', subscription);
  },
  scanDevices: () => ipcRenderer.invoke('scan-devices'),
  connectDevice: (deviceInfo) => ipcRenderer.invoke('connect-device', deviceInfo),
  disconnectDevice: () => ipcRenderer.invoke('disconnect-device'),
  onTelemetryUpdate: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('telemetry-update', subscription);
    return () => ipcRenderer.removeListener('telemetry-update', subscription);
  },
  onDebugLog: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('debug-log', subscription);
    return () => ipcRenderer.removeListener('debug-log', subscription);
  }
});
