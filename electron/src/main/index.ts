import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } from 'electron'
import { join, resolve } from 'path'
import { ElectronAuth } from './auth'
import { WebSocketBridge } from './ws-bridge'
import { registerIpcHandlers } from './ipc-handlers'
import { setMainWindow, setWindowMode, setWindowOpacity, getWindowOpacity, getWindowSize, getWindowBounds, startResize, stopResize, moveToDisplay } from './window-manager'
import { initAutoUpdater, getUpdateStatus, getUpdateVersion, checkForUpdates, quitAndInstall } from './auto-updater'
import {
  checkAllPermissions,
  requestAccessibility,
  openScreenRecordingSettings,
  openAccessibilitySettings,
} from './permissions'
import { ApprovalManager } from './approval-manager'
import { showAmbientRainbow, hideAmbientRainbow, moveRainbowToDisplay } from './rainbow-border'
import { warmupNativeScreenshot } from './native-screenshot'
import { getDisplayList, getActiveDisplayId, setActiveDisplayId, getActiveDisplay } from './display-manager'
import { performFullShutdown } from './app-shutdown'

// ── Custom protocol for OAuth deep links ──────────────────────────────────
// Registers coasty:// so the browser can redirect back to the app after
// OAuth instead of showing http://127.0.0.1:PORT in the address bar.
const PROTOCOL_SCHEME = 'coasty'
if (process.defaultApp) {
  // Dev mode: register with the path to electron binary + script
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, process.execPath, [resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL_SCHEME)
}

// Hold protocol URLs that arrive before auth is initialized (cold start on macOS)
let pendingProtocolUrl: string | null = null

// macOS: protocol URLs arrive via the open-url event
app.on('open-url', (event, url) => {
  event.preventDefault()
  if (url.startsWith(`${PROTOCOL_SCHEME}://`)) {
    if (auth) {
      auth.handleProtocolCallback(url)
    } else {
      pendingProtocolUrl = url
    }
  }
})

// Prevent multiple instances — second instance just focuses the existing window.
// This also avoids GPU cache lock conflicts on Windows.
const gotSingleLock = app.requestSingleInstanceLock()
if (!gotSingleLock) {
  app.quit()
}

// Disable GPU shader disk cache — a small overlay app doesn't benefit from it,
// and on Windows the cache directory gets locked between restarts causing
// "Unable to move the cache: Access is denied" errors.
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let auth: ElectronAuth | null = null
let wsBridge: WebSocketBridge | null = null
let approvalManager: ApprovalManager | null = null

const BACKEND_URL = process.env.COASTY_BACKEND_URL || 'http://localhost:8001'

function getIconPath(): string {
  // In dev, icons are in electron/build/; in production, they're in resources/
  const devPath = join(__dirname, '../../build/icon.png')
  const prodPath = join(process.resourcesPath, 'icon.png')
  return app.isPackaged ? prodPath : devPath
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 500,
    title: 'Coasty Desktop',
    icon: getIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
  })

  // Set the dock icon on macOS (BrowserWindow.icon is ignored on macOS)
  if (process.platform === 'darwin' && app.dock) {
    const dockIcon = nativeImage.createFromPath(getIconPath())
    if (!dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon)
    }
  }

  // Register with window manager for mode switching & screenshot hiding
  setMainWindow(mainWindow)

  // Open all external links in the user's default browser instead of a new Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // User-initiated close path (Alt+F4, ⌘W, taskbar close, in-app × button).
  // Runs BEFORE the window is destroyed so the rainbow-border BrowserWindow
  // is torn down in time for `window-all-closed` to fire. Without this, the
  // lingering rainbow window blocks quit and the process stays in the
  // background even though the UI has disappeared.
  mainWindow.on('close', () => {
    performFullShutdown({ wsBridge, auth, tray })
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // In development, load from dev server; in production, load the built file
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createTray(): void {
  const icon = nativeImage.createFromPath(getIconPath()).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setToolTip('Coasty Desktop')

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ])
  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    mainWindow?.show()
  })
}

/**
 * Install a minimal application menu so the standard quit shortcut works.
 *
 * The overlay is a frameless transparent window with no native chrome, so
 * there's no red traffic light or window-menu "Close" item. Without this
 * menu, ⌘Q on macOS has no owner and does nothing, which is a major reason
 * the app feels impossible to quit. We keep the menu intentionally tiny —
 * a single app submenu on macOS with a Quit role, and no visible menu bar
 * on Windows/Linux (setting null frees the menu entirely).
 */
function installAppMenu(): void {
  if (process.platform === 'darwin') {
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: app.name || 'Coasty',
        submenu: [
          { label: 'Hide Coasty', role: 'hide' },
          { label: 'Hide Others', role: 'hideOthers' },
          { label: 'Show All', role: 'unhide' },
          { type: 'separator' },
          {
            label: 'Quit Coasty',
            accelerator: 'Command+Q',
            click: () => app.quit(),
          },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  } else {
    // Windows / Linux: no visible menu bar, but Alt+F4 / taskbar close still work.
    Menu.setApplicationMenu(null)
  }
}

// Second instance tried to launch — focus existing window instead.
// On Windows/Linux, protocol URLs arrive here as command-line arguments.
app.on('second-instance', (_event, argv) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
  // Handle protocol callback (Windows/Linux deep link)
  const protocolUrl = argv.find(arg => arg.startsWith(`${PROTOCOL_SCHEME}://`))
  if (protocolUrl && auth) {
    auth.handleProtocolCallback(protocolUrl)
  }
})

app.whenReady().then(async () => {
  // Initialize auth and approval manager
  auth = new ElectronAuth()
  approvalManager = new ApprovalManager()

  // Process any protocol URL that arrived before auth was ready (macOS cold start)
  if (pendingProtocolUrl) {
    auth.handleProtocolCallback(pendingProtocolUrl)
    pendingProtocolUrl = null
  }

  // Propagate refreshed tokens to the WebSocket bridge so reconnects use fresh JWTs
  auth.onTokenRefresh((token) => {
    if (wsBridge) {
      wsBridge.updateToken(token)
    }
  })

  // Register IPC handlers
  registerIpcHandlers(auth, () => wsBridge, (bridge) => { wsBridge = bridge }, BACKEND_URL, approvalManager, () => mainWindow)

  // Validate IPC sender for all inline handlers
  const _ipcHandle = ipcMain.handle.bind(ipcMain)
  function secureHandle(channel: string, handler: (...args: any[]) => any): void {
    _ipcHandle(channel, async (event: Electron.IpcMainInvokeEvent, ...args: any[]) => {
      if (event.sender !== mainWindow?.webContents) {
        console.error(`[Security] Blocked unauthorized IPC call to '${channel}'`)
        return null
      }
      return handler(event, ...args)
    })
  }

  // App version — exposed to renderer for display
  secureHandle('app:get-version', () => app.getVersion())

  // Window mode control — renderer requests mode changes
  secureHandle('window:set-mode', async (_event, mode: string) => {
    setWindowMode(mode as 'auth' | 'compact' | 'expanded')
    // Show a subtle ambient rainbow when overlay is expanded, hide when collapsed
    if (mode === 'expanded') {
      showAmbientRainbow()
    } else if (mode === 'compact') {
      hideAmbientRainbow()
    }
  })

  // Window opacity control
  secureHandle('window:set-opacity', async (_event, value: number) => {
    setWindowOpacity(value)
  })
  secureHandle('window:get-opacity', async () => {
    return getWindowOpacity()
  })

  // Window size query
  secureHandle('window:get-size', async () => {
    return getWindowSize()
  })

  // Window bounds for custom resize
  secureHandle('window:get-bounds', async () => {
    return getWindowBounds()
  })

  // Custom resize for frameless transparent windows — main process polls cursor
  secureHandle('window:start-resize', async (_event, edge: string) => {
    startResize(edge)
  })
  secureHandle('window:stop-resize', async () => {
    stopResize()
  })

  // Action approval IPC
  secureHandle('approval:get-mode', () => approvalManager!.getMode())
  secureHandle('approval:set-mode', (_event, mode: string) => {
    approvalManager!.setMode(mode as any)
  })
  secureHandle('approval:respond', (_event, id: string, approved: boolean, reason?: string) => {
    approvalManager!.handleResponse(id, approved, reason)
  })

  // Permissions IPC (macOS)
  secureHandle('permissions:check', () => checkAllPermissions())
  secureHandle('permissions:request-accessibility', () => requestAccessibility())
  secureHandle('permissions:open-screen-recording', () => openScreenRecordingSettings())
  secureHandle('permissions:open-accessibility', () => openAccessibilitySettings())

  // Display selection (multi-monitor)
  secureHandle('displays:list', () => getDisplayList())
  secureHandle('displays:get-active', () => getActiveDisplayId())
  secureHandle('displays:set-active', (_event, id: number | null) => {
    setActiveDisplayId(id)
    // Move overlay + rainbow border to the selected display
    const display = getActiveDisplay()
    moveToDisplay(display)
    moveRainbowToDisplay(display)
  })

  // App restart (used after granting permissions)
  secureHandle('app:relaunch', () => {
    app.relaunch()
    app.exit(0)
  })

  // Full quit triggered from the renderer (in-app × button in the overlay).
  // Delegates to `app.quit()` so the before-quit hook runs and cleanup is
  // funnelled through the single `performFullShutdown` routine.
  secureHandle('app:quit', () => {
    app.quit()
  })

  // Auto-update IPC
  secureHandle('update:get-status', () => getUpdateStatus())
  secureHandle('update:get-version', () => getUpdateVersion())
  secureHandle('update:check', () => checkForUpdates())
  secureHandle('update:install', () => quitAndInstall())

  // Launch on system startup (only in packaged builds)
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true })
    initAutoUpdater()
  }

  installAppMenu()
  createWindow()
  createTray()

  // Pre-compile the native screenshot helper (macOS only) so it's ready
  // before the first screenshot request. Compilation takes ~2-3s the first
  // time; the binary is cached to disk across app restarts.
  warmupNativeScreenshot()

})

// Quit the process as soon as the last window is gone, on every platform.
// The app is an overlay — there is no "dock-only" state the user benefits
// from, and leaving the process alive when no windows exist causes the
// ghost-background-task complaint on both macOS and Windows.
app.on('window-all-closed', () => {
  app.quit()
})

// Programmatic quit path (tray menu, ⌘Q via app menu, auto-updater install).
// `performFullShutdown` is idempotent, so running it again after the
// mainWindow `close` handler is safe and covers the case where quit is
// initiated without a prior window close.
app.on('before-quit', () => {
  performFullShutdown({ wsBridge, auth, tray })
  tray = null
})
