// HotelOps · Electron preload
// Exposes a safe, narrow API to the renderer (the React app) so it can
// trigger update checks and show update status without enabling nodeIntegration.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hotelops", {
  isElectron: true,
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke("app:get-version"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  installUpdateNow: () => ipcRenderer.invoke("update:install-now"),
  onUpdateStatus: (cb) => {
    const listener = (_evt, payload) => cb(payload);
    ipcRenderer.on("update:status", listener);
    return () => ipcRenderer.removeListener("update:status", listener);
  },
});
