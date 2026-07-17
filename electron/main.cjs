// Electron main process — wraps the Personal CRM web app in a native desktop
// window and applies automatic updates pulled from GitHub Releases.
const { app, BrowserWindow, shell, Menu, dialog } = require('electron')
const path = require('node:path')

const isDev = !!process.env.ELECTRON_DEV
let autoUpdater = null

// When set, the shell loads the live web app from this URL, so every launch runs
// the latest deployed version — no reinstall needed. If the URL can't be reached
// (offline), it falls back to the copy bundled inside the app. Leave '' to always
// use the bundled copy.
const REMOTE_URL = 'https://personal-crm-seven-fawn.vercel.app'

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 380,
    minHeight: 560,
    backgroundColor: '#0f172a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  const loadBundled = () => win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  if (isDev) {
    win.loadURL('http://127.0.0.1:5173')
  } else if (REMOTE_URL) {
    // Live-load the hosted app; if unreachable (offline), use the bundled copy.
    win.webContents.on('did-fail-load', (_e, errorCode, _desc, _url, isMainFrame) => {
      if (isMainFrame && errorCode !== -3 /* aborted */) loadBundled()
    })
    win.loadURL(REMOTE_URL)
  } else {
    loadBundled()
  }

  // Open mailto:/tel:/https links (from contact cards) in the real browser or
  // mail client instead of hijacking the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const allowed =
      url.startsWith('file:') ||
      url.startsWith('http://127.0.0.1') ||
      (REMOTE_URL && url.startsWith(REMOTE_URL))
    if (!allowed) {
      e.preventDefault()
      shell.openExternal(url)
    }
  })

  return win
}

function setupAutoUpdate() {
  if (isDev || !app.isPackaged) return
  try {
    autoUpdater = require('electron-updater').autoUpdater
  } catch {
    return // updater not bundled (e.g. dev) — skip silently
  }
  autoUpdater.autoDownload = true
  autoUpdater.on('update-downloaded', async (info) => {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `Personal CRM ${info.version} has been downloaded.`,
      detail: 'Restart the app to finish updating.',
    })
    if (response === 0) autoUpdater.quitAndInstall()
  })
  autoUpdater.on('error', (err) => console.error('auto-update error:', err))
  autoUpdater.checkForUpdatesAndNotify()
  // Keep checking every 6 hours for long-running sessions.
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000)
}

function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Check for Updates…',
          click: () => {
            if (autoUpdater) autoUpdater.checkForUpdatesAndNotify()
            else dialog.showMessageBox({ message: 'Updates are only available in the installed app.' })
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// Single-instance: focus the existing window instead of opening a second one.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    buildMenu()
    createWindow()
    setupAutoUpdate()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
