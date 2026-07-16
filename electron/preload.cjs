// Minimal, secure preload. contextIsolation is on, so the renderer only sees
// exactly what we expose here — a flag it can use to show desktop-only UI.
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  electron: process.versions.electron,
})
