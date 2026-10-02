const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  scanDevices: () => ipcRenderer.invoke('scan-devices'),
  connectDevice: (deviceInfo) => ipcRenderer.invoke('connect-device', deviceInfo),
  disconnectDevice: () => ipcRenderer.invoke('disconnect-device'),
  onTelemetryUpdate: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('telemetry-update', subscription);
    return () => ipcRenderer.removeListener('telemetry-update', subscription);
  }
});
