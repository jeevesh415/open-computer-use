import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } from 'electron'
import { join, resolve } from 'path'
import { pathToFileURL } from 'url'
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
import { launchAtLogin } from './launch-at-login'
import { errorReporter, reportError } from './error-reporter'
import { isTestMode } from './test-mode'

// ── Top-level error capture ───────────────────────────────────────────────
// Install BEFORE any other module imports so even import-time crashes are
// captured (the reporter itself lazily initialises its disk + WS sinks; only
// the stdout sink is unconditionally available, which is what we want for
// import-phase failures).
process.on('uncaughtException', (err) => {
  reportError('main_unhandled_exception', { error: err })
})
process.on('unhandledRejection', (reason) => {
  reportError('main_unhandled_rejection', { error: reason })
})

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

// ── Linux Wayland fixes ──────────────────────────────────────────────────
// Electron 40 has a known regression where the GPU process zygote doesn't
// inherit ozone platform + DRM-syncobj flags on Wayland, producing ~5x
// CPU overhead on multi-monitor setups (electron/electron#50462). We pin
// the platform hint to auto (so X11 sessions still work) and explicitly
// enable WaylandLinuxDrmSyncobj so the GPU process uses the right sync
// path. Skip on non-Linux platforms — these flags are no-ops elsewhere
// but adding them unconditionally would still appear in user-agent and
// `chrome://gpu` reports unnecessarily.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
  app.commandLine.appendSwitch('enable-features', 'WaylandLinuxDrmSyncobj')
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let auth: ElectronAuth | null = null
let wsBridge: WebSocketBridge | null = null
let approvalManager: ApprovalManager | null = null

// ``process.env.COASTY_BACKEND_URL`` is REPLACED at build time by the Rollup
// ``define`` in electron.vite.config.ts — production builds bake the URL
// from the dev's .env into the bundle so packaged installers ship with a
// useful default. That bake-time substitution means a runtime env-var
// override has no effect.
//
// ``COASTY_TEST_BACKEND_URL`` is NOT in the define list, so it remains a
// genuine runtime lookup. Playwright e2e tests use it to point the app at
// a fake-backend on a random port without rebuilding. Order:
//   1. Runtime test override   (COASTY_TEST_BACKEND_URL)
//   2. Build-time baked URL    (COASTY_BACKEND_URL, replaced by Rollup)
//   3. Local-dev default       (localhost:8001)
const BACKEND_URL =
  process.env.COASTY_TEST_BACKEND_URL
  || process.env.COASTY_BACKEND_URL
  || 'http://localhost:8001'

// ── URL security: outbound + navigation guards ───────────────────────────
//
// External links from the renderer (window.open, will-navigate) flow through
// these two predicates. The allowlist is intentionally narrow:
//   - isSafeExternalUrl: schemes we'll forward to shell.openExternal
//   - isAllowedAppNavigation: URLs the BrowserWindow itself may navigate to
//
// Any other URL is silently dropped (deny). This blocks `javascript:`,
// `file://`, `data:`, `chrome:`, `vbscript:`, `about:`, `blob:`, ftp/ldap/
// gopher, plus URLs targeting localhost / RFC1918 ranges, oversized URLs,
// and URLs with embedded CRLF (header-injection style). See
// `electron/src/main/url-window-security.test.ts` for the full contract.

const SAFE_EXTERNAL_SCHEMES = new Set(['https:', 'http:', 'mailto:'])
const MAX_URL_LENGTH = 2048

function isPrivateOrLoopbackHostname(hostname: string): boolean {
  // hostname comes from URL parser — already lowercased + IPv6 surrounded by []
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h === '0.0.0.0' || h === '[::1]' || h === '::1') return true
  // IPv4 private / loopback / link-local ranges
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const a = parseInt(m[1], 10)
    const b = parseInt(m[2], 10)
    if (a === 127) return true                                  // 127/8 loopback
    if (a === 10) return true                                   // 10/8 private
    if (a === 192 && b === 168) return true                     // 192.168/16 private
    if (a === 172 && b >= 16 && b <= 31) return true            // 172.16-31/12 private
    if (a === 169 && b === 254) return true                     // 169.254/16 link-local
    if (a === 0) return true                                    // 0/8 "this network"
  }
  return false
}

export function isSafeExternalUrl(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0) return false
  if (url.length > MAX_URL_LENGTH) return false
  // CRLF in a URL has no legitimate use and enables header-injection style
  // attacks against any downstream HTTP layer (e.g. an OS handler).
  if (url.includes('\r') || url.includes('\n')) return false

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (!SAFE_EXTERNAL_SCHEMES.has(parsed.protocol)) return false

  // mailto: has no host component to validate (RFC 6068).
  if (parsed.protocol === 'mailto:') return true

  // For http/https, reject loopback + private network targets — those are
  // never legitimate destinations for an "open in browser" link from the
  // overlay and are the standard SSRF / pivot vector when an attacker can
  // craft URLs.
  if (!parsed.hostname) return false
  if (isPrivateOrLoopbackHostname(parsed.hostname)) return false

  return true
}

// The bundled renderer's URL prefix — captured at app startup. In dev this
// is the electron-vite dev server (e.g. http://localhost:5173); in
// production it's the file:// URL of the packaged HTML inside the asar.
// Anything outside this exact prefix is rejected for in-window navigation.
let RENDERER_PREFIX = ''

function computeRendererPrefix(): string {
  if (process.env.ELECTRON_RENDERER_URL) {
    return process.env.ELECTRON_RENDERER_URL
  }
  // Production: derive the file:// URL of the packaged renderer HTML the
  // same way createWindow() loads it (mainWindow.loadFile(join(__dirname,
  // '../renderer/index.html'))). pathToFileURL gives a properly-encoded
  // file:// URL identical to what Chromium reports for that file.
  return pathToFileURL(join(__dirname, '../renderer/index.html')).toString()
}

export function isAllowedAppNavigation(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0) return false
  if (!RENDERER_PREFIX) return false
  // Strict prefix match — no normalization. The renderer URL is pinned at
  // startup, so any URL that isn't a hash/query-only continuation of it
  // (e.g. file:///…/index.html#/login) is rejected.
  return url.startsWith(RENDERER_PREFIX)
}

/**
 * Install URL-handling guards on a WebContents:
 *   - setWindowOpenHandler: only safe-scheme external URLs reach
 *     shell.openExternal; everything else is silently denied.
 *   - will-navigate / will-redirect: block any navigation that would take
 *     the window away from the bundled renderer; if the URL is a safe
 *     external link, open it in the user's default browser instead.
 *   - will-attach-webview: disable webviews entirely (we don't use them
 *     and they expand the attack surface).
 */
function installWebContentsGuards(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url).catch(() => { /* best-effort */ })
    }
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    if (isAllowedAppNavigation(url)) return
    event.preventDefault()
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url).catch(() => { /* best-effort */ })
    }
  })

  contents.on('will-redirect', (event, url) => {
    if (isAllowedAppNavigation(url)) return
    event.preventDefault()
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url).catch(() => { /* best-effort */ })
    }
  })

  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
}

// Guard against double-registration (hot-reload, repeated whenReady).
let webContentsGuardRegistered = false
function registerWebContentsGuard(): void {
  if (webContentsGuardRegistered) return
  webContentsGuardRegistered = true
  app.on('web-contents-created', (_event, contents) => {
    installWebContentsGuards(contents)
  })
}

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

  // External links + navigation guards are installed via the
  // registerWebContentsGuard listener, which catches every WebContents
  // — main overlay, rainbow border, devtools. Keeping the registration
  // centralized prevents drift between windows.

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
  // Now that `app` is ready, the reporter can resolve userData/logs and
  // start writing the file sink. The HTTP fallback URL comes from the same
  // env var the WS bridge uses so they always match.
  errorReporter.init({
    backendUrl: process.env.COASTY_BACKEND_URL,
    getAuthToken: async () => {
      try { return (await auth?.getSession())?.access_token ?? null } catch { return null }
    },
  })

  // Renderer / GPU / utility process crashes — Electron emits these on `app`
  // when a child process dies. Without a listener these go to stderr only.
  app.on('render-process-gone', (_event, _wc, details) => {
    reportError('render_process_gone', {
      message: `Renderer gone: reason=${details.reason}, exitCode=${details.exitCode}`,
      context: { reason: details.reason, exitCode: details.exitCode },
    })
  })
  app.on('child-process-gone', (_event, details) => {
    reportError('child_process_gone', {
      message: `Child process gone: type=${details.type}, reason=${details.reason}`,
      context: {
        type: details.type,
        reason: details.reason,
        exitCode: details.exitCode,
        serviceName: details.serviceName,
        name: details.name,
      },
    })
  })

  // Pin the bundled-renderer URL prefix used by the navigation guard.
  // Captured ONCE at startup so a later mutation of process.env can't widen
  // the allowlist; in production this is the file:// URL of the asar HTML.
  RENDERER_PREFIX = computeRendererPrefix()

  // Install URL guards (setWindowOpenHandler + will-navigate + will-redirect
  // + will-attach-webview) for every WebContents the app ever creates,
  // including auxiliary windows like the rainbow border.
  registerWebContentsGuard()

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

  // ── Session-death → forced sign-out ─────────────────────────────────
  //
  // When the auth layer declares the session dead (refresh failed,
  // network error during refresh, scheduled refresh failed, WS bridge
  // reported auth_failed, etc.), we broadcast a single
  // ``auth:session-died`` IPC event to the renderer. The renderer's
  // auth-store auto-signs-out and routes the UI to the AuthScreen.
  //
  // Why this is here and not in ipc-handlers: the auth layer must
  // fire-and-forget — it shouldn't depend on whether the renderer
  // window exists yet, on the IPC layer being initialized, etc.
  // index.ts owns the lifecycle of both processes, so this is the
  // right place to bridge them.
  //
  // We also tear down the WS bridge synchronously so it doesn't keep
  // reconnecting with a token that just got nuked. The bridge's own
  // auth_error path would catch this on the next reconnect, but
  // doing it here makes the user-perceived response instant: click
  // (or refresh failure) → bridge gone → no spurious connection
  // attempts during the brief window before the renderer reacts.
  auth.onSessionDead((reason) => {
    console.warn(`[App] Session declared dead (${reason}) — tearing down bridge + signalling renderer`)
    try {
      wsBridge?.disconnect()
    } catch (err) {
      console.error('[App] Bridge teardown during session-death failed:', err)
    }
    wsBridge = null
    // Broadcast to the renderer if it's alive. The renderer's
    // auth-store init() subscribes to this; on receipt it calls
    // ``signOut()`` which routes the UI to the AuthScreen.
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.webContents.send('auth:session-died', { reason })
      } catch (err) {
        console.error('[App] Failed to broadcast session-died:', err)
      }
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
  // Defense-in-depth: even if a future change to checkAllPermissions
  // re-introduces a `_debug` field, the IPC layer must never forward it
  // to the renderer (P2-01).
  secureHandle('permissions:check', async () => {
    const result = (await checkAllPermissions()) as unknown as Record<string, unknown>
    const { _debug: _drop, ...safe } = result
    void _drop
    return safe
  })
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

  // Renderer-side error forwarding. The renderer's `window.onerror`,
  // `unhandledrejection`, and React ErrorBoundary all funnel here via the
  // preload bridge. We accept ONLY a structured shape and re-stamp the
  // category server-side so the renderer can't claim to be a main-process
  // unhandled exception (which would mislead diagnostics).
  ipcMain.on('error:report', (_event, raw: any) => {
    if (!raw || typeof raw !== 'object') return
    const fromBoundary = raw.from === 'boundary'
    reportError(fromBoundary ? 'renderer_react_boundary' : 'renderer_unhandled', {
      message: typeof raw.message === 'string' ? raw.message : '<unknown>',
      error: raw.stack && typeof raw.stack === 'string' ? { message: raw.message, stack: raw.stack } : undefined,
      context: {
        url: typeof raw.url === 'string' ? raw.url : undefined,
        line: typeof raw.line === 'number' ? raw.line : undefined,
        col: typeof raw.col === 'number' ? raw.col : undefined,
        component: typeof raw.component === 'string' ? raw.component : undefined,
        userAgent: typeof raw.userAgent === 'string' ? raw.userAgent : undefined,
      },
    })
  })

  // Launch on system startup — opt-in, persisted to userData. Defaults to
  // OFF for fresh installs (Windows AV products and behavioural EDR flag
  // default-on persistence as a malware fingerprint). Existing users keep
  // their auto-launch state on upgrade because launch-at-login seeds the
  // preference from `getLoginItemSettings()` on first read.
  // Skip the auto-updater entirely under ``COASTY_TEST_MODE`` — Playwright /
  // smoke runs MUST NOT fire real HTTP requests to ``updates.coasty.ai`` (it
  // creates flaky tests from transient network blips AND it pollutes the
  // update server's analytics with fake clients).
  if (app.isPackaged && !isTestMode()) {
    launchAtLogin.applyOnStartup()
    initAutoUpdater()
  }

  // Renderer-side toggle: settings UI calls these via the preload bridge.
  ipcMain.handle('launch-at-login:get', () => launchAtLogin.getEnabled())
  ipcMain.handle('launch-at-login:set', (_event, enabled: boolean) => {
    launchAtLogin.setEnabled(!!enabled)
    return launchAtLogin.getEnabled()
  })

  installAppMenu()
  createWindow()
  createTray()

  // Pre-compile the native screenshot helper (macOS only) so it's ready
  // before the first screenshot request. Compilation takes ~2-3s the first
  // time; the binary is cached to disk across app restarts.
  //
  // Skipped under test mode — the Swift compile spawns a child process the
  // test harness has no reason to wait on, and screenshots are stubbed in
  // tests anyway.
  if (!isTestMode()) {
    warmupNativeScreenshot()
  }

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
