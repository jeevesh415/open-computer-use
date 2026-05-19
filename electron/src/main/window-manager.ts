import { BrowserWindow, screen } from 'electron'
import { release } from 'os'
import { getActiveDisplay } from './display-manager'
import { setRainbowOrigin } from './rainbow-border'

export type WindowMode = 'auth' | 'compact' | 'expanded'

const MODE_CONFIG = {
  auth:     { width: 400, height: 500, alwaysOnTop: false, skipTaskbar: false },
  compact:  { width: 360, height: 56,  alwaysOnTop: true,  skipTaskbar: false },
  expanded: { width: 520, height: 680, alwaysOnTop: true,  skipTaskbar: false },
}

const ANIM_DURATION = 320 // ms – longer for a relaxed, natural feel
const ANIM_INTERVAL = 10  // ~100fps target (OS throttles gracefully)

/** Quintic ease-out: fast start, long gentle deceleration */
function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5)
}

const MIN_EXPANDED_WIDTH = 400
const MIN_EXPANDED_HEIGHT = 520

/**
 * On Windows 10 2004+ (build 19041+), setContentProtection(true) calls
 * SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE) which makes the window
 * completely invisible to all screen capture APIs — zero flicker.
 *
 * On Windows 10 pre-2004 the same call uses WDA_MONITOR which renders the
 * window as an opaque BLACK RECTANGLE in captures — worse than the original.
 * We must detect the build number and only enable this on 19041+.
 *
 * On macOS / Linux this flag either doesn't work reliably or shows a black box,
 * so we fall back to an opacity-based approach (much smoother than win.hide()).
 */
function detectContentProtection(): boolean {
  if (process.platform !== 'win32') return false
  try {
    // os.release() on Windows returns e.g. "10.0.19041" — third segment is build number.
    // WDA_EXCLUDEFROMCAPTURE requires build 19041+ (Windows 10 2004 / May 2020 Update).
    const parts = release().split('.')
    const build = parseInt(parts[2], 10)
    return !isNaN(build) && build >= 19041
  } catch {
    return false
  }
}

/** True when setContentProtection reliably excludes windows from screen capture. */
export const contentProtectionReliable = detectContentProtection()

let mainWindow: BrowserWindow | null = null
let currentMode: WindowMode = 'auth'
let savedPosition: { x: number; y: number } | null = null
let savedExpandedSize: { width: number; height: number } | null = null
let animTimer: ReturnType<typeof setInterval> | null = null
let inPostAuthTransition = false
let enforcerInterval: ReturnType<typeof setInterval> | null = null
let isNativeDialogOpen = false
let isHiddenForScreenshot = false
let savedOpacityBeforeScreenshot = 1
let intendedOpacity = 1  // The user's actual desired opacity (not mid-fade)
let screenshotFadeTimer: ReturnType<typeof setInterval> | null = null

/**
 * True while WE are mutating the window's bounds programmatically
 * (mode-change setBounds, animateBounds frames, etc.). The 'moved' /
 * 'resize' event handlers check this and skip the savedPosition /
 * savedExpandedSize update when set — otherwise our own animation
 * frames overwrite the user's true position with a mid-animation
 * snapshot, and the *next* mode change (e.g. auto-expand on stream
 * end firing while auto-collapse is still animating) computes its
 * target from the corrupted snapshot and lands off-center.
 */
let isProgrammaticBoundsUpdate = false

/** Programmatic setBounds wrapper that suppresses the 'moved'/'resize'
 *  event handlers' state updates. Use this anywhere we set bounds
 *  ourselves rather than the user dragging/resizing. */
function setBoundsProgrammatic(win: BrowserWindow, bounds: Electron.Rectangle): void {
  isProgrammaticBoundsUpdate = true
  try {
    win.setBounds(bounds)
  } finally {
    // Reset on next tick so the synchronous 'resize'/'moved' that fires
    // immediately after setBounds (Windows/macOS) is still suppressed.
    setImmediate(() => { isProgrammaticBoundsUpdate = false })
  }
}

/** Smoothly animate window bounds from current to target. */
function animateBounds(win: BrowserWindow, target: Electron.Rectangle): void {
  if (animTimer) {
    clearInterval(animTimer)
    animTimer = null
  }

  // Set the guard IMMEDIATELY — the OS may fire 'moved'/'resize' events
  // before our first interval frame runs (10ms gap), and those still
  // need to be suppressed so they don't pollute savedPosition.
  isProgrammaticBoundsUpdate = true

  const start = win.getBounds()
  const startTime = Date.now()

  animTimer = setInterval(() => {
    if (win.isDestroyed()) {
      clearInterval(animTimer!)
      animTimer = null
      isProgrammaticBoundsUpdate = false
      return
    }

    const elapsed = Date.now() - startTime
    const t = Math.min(elapsed / ANIM_DURATION, 1)
    const e = easeOutQuint(t)

    // Re-assert each frame in case some other code path has flipped it.
    isProgrammaticBoundsUpdate = true
    win.setBounds({
      x: Math.round(start.x + (target.x - start.x) * e),
      y: Math.round(start.y + (target.y - start.y) * e),
      width: Math.round(start.width + (target.width - start.width) * e),
      height: Math.round(start.height + (target.height - start.height) * e),
    })

    if (t >= 1) {
      clearInterval(animTimer!)
      animTimer = null
      // Reset on next tick so the final 'moved'/'resize' fired
      // synchronously by setBounds is still suppressed.
      setImmediate(() => { isProgrammaticBoundsUpdate = false })
    }
  }, ANIM_INTERVAL)
}

/**
 * Start periodic topmost enforcement.
 *
 * Originally Windows-only because that platform's transparent frameless
 * windows lose their TOPMOST flag on focus changes. Linux/X11 hits the
 * same class of problem — `_NET_WM_STATE_ABOVE` is advisory and many
 * window managers / compositors don't enforce strict topmost ordering
 * across focus events. Periodic re-assertion via setAlwaysOnTop +
 * moveTop is the same belt-and-suspenders fix on both platforms.
 *
 * macOS uses real window levels (`NSWindowLevel`) which the OS enforces
 * structurally, so the enforcer is unnecessary there and we skip it.
 */
function startTopmostEnforcer(win: BrowserWindow): void {
  if (process.platform === 'darwin') return
  stopTopmostEnforcer()

  enforcerInterval = setInterval(() => {
    if (win.isDestroyed() || isHiddenForScreenshot || isNativeDialogOpen) return
    if (currentMode === 'auth') return
    if (!win.isVisible()) return
    win.setAlwaysOnTop(true, 'screen-saver', 1)
    win.moveTop()
  }, 2000)
}

/** Stop the periodic enforcer. */
function stopTopmostEnforcer(): void {
  if (enforcerInterval) {
    clearInterval(enforcerInterval)
    enforcerInterval = null
  }
}

/**
 * Push the pill's center (in display-local px) to the rainbow window so
 * its particle dispersion always emanates from the pill, not the screen
 * perimeter. Y origin sits at the center of the header bar.
 */
function pushOriginToRainbow(pill: { x: number; y: number; width: number; height: number }): void {
  if (currentMode === 'auth') return
  const display = getActiveDisplay()
  const headerCenter = currentMode === 'compact' ? 28 : 22
  const localX = pill.x - display.bounds.x + pill.width / 2
  const localY = pill.y - display.bounds.y + headerCenter
  setRainbowOrigin(localX, localY)
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win

  // On Windows, mark the overlay as excluded from screen capture.
  // This makes it completely invisible to desktopCapturer — no hide/show needed.
  if (contentProtectionReliable) {
    win.setContentProtection(true)
  }

  // Track position when the user drags the overlay. Skip events fired
  // by our own animation/setBounds (guarded via isProgrammaticBoundsUpdate)
  // — otherwise mid-animation snapshots overwrite the user's real
  // position and corrupt the next mode-change target calculation.
  win.on('moved', () => {
    if (isProgrammaticBoundsUpdate) return
    if (currentMode !== 'auth') {
      const [x, y] = win.getPosition()
      savedPosition = { x, y }
      const [w, h] = win.getSize()
      pushOriginToRainbow({ x, y, width: w, height: h })
    }
  })

  // Track size when the user resizes in expanded mode. Same guard —
  // animation frames trigger 'resize' too and would otherwise constantly
  // overwrite savedExpandedSize with mid-animation values.
  win.on('resize', () => {
    if (isProgrammaticBoundsUpdate) return
    if (currentMode === 'expanded' && !win.isDestroyed()) {
      const [w, h] = win.getSize()
      savedExpandedSize = { width: w, height: h }
      win.webContents.send('window-size-changed', { width: w, height: h })
      const [x, y] = win.getPosition()
      pushOriginToRainbow({ x, y, width: w, height: h })
    }
  })

  // Re-assert always-on-top when the window loses focus (Windows drops it for
  // transparent frameless windows when another app is clicked).
  // During the post-auth transition, use 'floating' level to beat the browser.
  win.on('blur', () => {
    if (currentMode !== 'auth' && !win.isDestroyed() && !isNativeDialogOpen) {
      const level = inPostAuthTransition ? 'floating' : 'screen-saver'
      win.setAlwaysOnTop(true, level)
      win.moveTop()
    }
  })
}

export function getWindowMode(): WindowMode {
  return currentMode
}

export function setWindowMode(mode: WindowMode): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return

  const prev = currentMode
  currentMode = mode
  let cfg = MODE_CONFIG[mode]

  // Configure always-on-top, taskbar visibility, and workspace visibility.
  // Skip re-asserting always-on-top while a native dialog is open — resumeTopmost()
  // will restore the correct level once the dialog closes.
  if (!isNativeDialogOpen) {
    win.setAlwaysOnTop(cfg.alwaysOnTop, cfg.alwaysOnTop ? 'screen-saver' : undefined)
  }
  win.setSkipTaskbar(cfg.skipTaskbar)

  // Enable resizing only in expanded mode with minimum bounds
  if (mode === 'expanded') {
    win.setResizable(true)
    win.setMinimumSize(MIN_EXPANDED_WIDTH, MIN_EXPANDED_HEIGHT)
  } else {
    // Reset minimum size BEFORE setting bounds so the window can shrink
    // to compact pill dimensions (360×56). On macOS the window server
    // enforces minimumSize even when resizable is false.
    win.setMinimumSize(0, 0)
    win.setResizable(false)
  }

  // Start/stop the periodic topmost enforcer based on mode
  if (cfg.alwaysOnTop) {
    startTopmostEnforcer(win)
  } else {
    stopTopmostEnforcer()
  }
  // Show overlay on all virtual desktops (macOS Spaces / Linux workspaces)
  if (process.platform !== 'win32') {
    win.setVisibleOnAllWorkspaces(cfg.alwaysOnTop, { visibleOnFullScreen: true })
  }

  // Calculate position on the active display (not always primary)
  const display = getActiveDisplay()
  const { width: screenW } = display.workAreaSize
  const { x: workX, y: workY } = display.workArea

  let x: number
  let y: number

  if (mode === 'auth') {
    // Center on screen
    x = workX + Math.round((screenW - cfg.width) / 2)
    y = workY + Math.round((display.workAreaSize.height - cfg.height) / 2)
    savedPosition = null
  } else if (mode === 'compact') {
    if (savedPosition) {
      x = savedPosition.x
      y = savedPosition.y
    } else {
      // Default: top-center with 16px margin
      x = workX + Math.round((screenW - cfg.width) / 2)
      y = workY + 16
    }
  } else {
    // expanded: center-align with compact pill (grows downward from same center)
    // Use saved expanded size if available, otherwise scale to screen
    const screenH = display.workAreaSize.height
    const defaultW = Math.max(cfg.width, Math.round(screenW * 0.34))
    const defaultH = Math.max(cfg.height, Math.round(screenH * 0.65))
    const expandW = savedExpandedSize?.width ?? defaultW
    const expandH = savedExpandedSize?.height ?? defaultH

    if (savedPosition) {
      const compactW = MODE_CONFIG.compact.width
      const centerX = savedPosition.x + Math.round(compactW / 2)
      x = centerX - Math.round(expandW / 2)
      y = savedPosition.y
    } else {
      x = workX + Math.round((screenW - expandW) / 2)
      y = workY + 16
    }

    cfg = { ...cfg, width: expandW, height: expandH }
  }

  // Clamp to screen bounds
  x = Math.max(workX, Math.min(x, workX + screenW - cfg.width))
  y = Math.max(workY, Math.min(y, workY + display.workAreaSize.height - cfg.height))

  const target = { x, y, width: cfg.width, height: cfg.height }

  // Auth → overlay: on Windows, transparent frameless windows lose topmost
  // z-order when setBounds and setAlwaysOnTop race each other (both use
  // SetWindowPos internally). The fix: hide → apply all changes → show.
  // ShowWindow(SW_SHOW) after hide bypasses the foreground lock and creates
  // a clean window appearance with topmost applied atomically.
  const isFromAuth = prev === 'auth' && mode !== 'auth'
  if (isFromAuth) {
    win.hide()
  }

  // Animate compact↔expanded transitions; instant for all others
  const isOverlaySwitch =
    (prev === 'compact' && mode === 'expanded') ||
    (prev === 'expanded' && mode === 'compact')

  if (isOverlaySwitch) {
    animateBounds(win, target)
  } else {
    setBoundsProgrammatic(win, target)
  }

  // Push the new pill center to the rainbow so dispersion tracks the move.
  if (mode !== 'auth') {
    pushOriginToRainbow(target)
  }

  if (isFromAuth) {
    inPostAuthTransition = true

    // Show after a brief delay so Windows processes the hidden state + bounds
    setTimeout(() => {
      if (win.isDestroyed() || isNativeDialogOpen) return
      win.setAlwaysOnTop(true, 'screen-saver')
      win.show()   // SW_SHOW activates window + brings to front
      win.focus()
    }, 200)

    // Retries: re-assert topmost in case browser reclaims foreground
    const keepOnTop = () => {
      if (win.isDestroyed() || isNativeDialogOpen) return
      win.setAlwaysOnTop(true, 'screen-saver')
      win.moveTop()
    }
    for (const delay of [600, 1200, 2000, 3000]) {
      setTimeout(keepOnTop, delay)
    }

    // End transition period
    setTimeout(() => {
      inPostAuthTransition = false
    }, 4000)
  }

  // Notify renderer of the mode change
  if (!win.isDestroyed()) {
    win.webContents.send('window-mode-changed', mode)
  }
}

/** Get current window size. */
export function getWindowSize(): { width: number; height: number } {
  const win = mainWindow
  if (!win || win.isDestroyed()) return { width: 400, height: 520 }
  const [width, height] = win.getSize()
  return { width, height }
}

/** Get current window bounds (position + size). */
export function getWindowBounds(): Electron.Rectangle {
  const win = mainWindow
  if (!win || win.isDestroyed()) return { x: 0, y: 0, width: 400, height: 520 }
  return win.getBounds()
}

let resizeTimer: ReturnType<typeof setInterval> | null = null
let resizeEdge: string | null = null
let resizeStartCursor: { x: number; y: number } | null = null
let resizeStartBounds: Electron.Rectangle | null = null

/**
 * Begin a resize drag. The main process polls cursor position via
 * screen.getCursorScreenPoint() so that resizing works even when
 * the cursor leaves the transparent frameless window.
 */
export function startResize(edge: string): void {
  const win = mainWindow
  if (!win || win.isDestroyed() || currentMode !== 'expanded') return

  resizeEdge = edge
  resizeStartCursor = screen.getCursorScreenPoint()
  resizeStartBounds = win.getBounds()

  // Poll at ~60fps
  if (resizeTimer) clearInterval(resizeTimer)
  resizeTimer = setInterval(() => {
    if (!win || win.isDestroyed() || !resizeEdge || !resizeStartCursor || !resizeStartBounds) {
      stopResize()
      return
    }

    const cursor = screen.getCursorScreenPoint()
    const dx = cursor.x - resizeStartCursor.x
    const dy = cursor.y - resizeStartCursor.y

    let { x, y, width, height } = resizeStartBounds

    if (resizeEdge.includes('right')) {
      width = Math.max(MIN_EXPANDED_WIDTH, width + dx)
    }
    if (resizeEdge.includes('bottom')) {
      height = Math.max(MIN_EXPANDED_HEIGHT, height + dy)
    }
    if (resizeEdge.includes('left')) {
      const newWidth = Math.max(MIN_EXPANDED_WIDTH, width - dx)
      x = x + (width - newWidth)
      width = newWidth
    }
    if (resizeEdge.includes('top')) {
      const newHeight = Math.max(MIN_EXPANDED_HEIGHT, height - dy)
      y = y + (height - newHeight)
      height = newHeight
    }

    win.setBounds({ x, y, width, height })
  }, 16)
}

/** Stop the resize drag. */
export function stopResize(): void {
  if (resizeTimer) {
    clearInterval(resizeTimer)
    resizeTimer = null
  }
  resizeEdge = null
  resizeStartCursor = null
  resizeStartBounds = null
}

/** Set overlay opacity (0.15 – 1.0). Notifies renderer so UI can reflect. */
export function setWindowOpacity(value: number): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  const clamped = Math.max(0.15, Math.min(1, value))
  intendedOpacity = clamped
  win.setOpacity(clamped)
  win.webContents.send('window-opacity-changed', clamped)
}

export function getWindowOpacity(): number {
  const win = mainWindow
  if (!win || win.isDestroyed()) return 1
  return win.getOpacity()
}

/**
 * Bring the overlay to the front with focus.
 * Use when the user MUST interact (e.g. approval prompts).
 * Unlike the periodic enforcer, this intentionally steals focus.
 */
export function bringToFront(): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  if (currentMode === 'auth') return
  // Don't steal focus from native dialogs — approval prompts stay in the
  // pending queue and the overlay will come to front when the dialog closes.
  if (isNativeDialogOpen) return

  win.setAlwaysOnTop(true, 'screen-saver', 1)
  win.moveTop()
  win.focus()
}

/**
 * Temporarily suspend always-on-top enforcement.
 * Use before opening native dialogs (file picker, etc.) so they aren't
 * buried behind the overlay by the periodic enforcer or blur handler.
 */
export function suspendTopmost(): void {
  const win = mainWindow
  isNativeDialogOpen = true
  if (win && !win.isDestroyed() && currentMode !== 'auth') {
    win.setAlwaysOnTop(false)
  }
}

/**
 * Resume always-on-top enforcement after a native dialog closes.
 */
export function resumeTopmost(): void {
  const win = mainWindow
  isNativeDialogOpen = false
  if (win && !win.isDestroyed() && currentMode !== 'auth') {
    win.setAlwaysOnTop(true, 'screen-saver', 1)
    win.moveTop()
  }
}

/** Hide the overlay window before taking a screenshot. */
export async function hideForScreenshot(): Promise<void> {
  const win = mainWindow
  if (!win || win.isDestroyed() || !win.isVisible()) return
  isHiddenForScreenshot = true

  // Use the user's intended opacity, not the live value which may be mid-fade
  savedOpacityBeforeScreenshot = intendedOpacity

  // Cancel any in-progress fade-in from a previous screenshot cycle
  if (screenshotFadeTimer) {
    clearInterval(screenshotFadeTimer)
    screenshotFadeTimer = null
  }

  // On Windows, content protection excludes us from capture — no need to hide
  if (contentProtectionReliable) return

  // Opacity-based hiding: much smoother than win.hide() — no OS window
  // animation, no taskbar flash, no compositor reflow. The window stays
  // in the window list but is fully transparent to the compositor.
  win.setOpacity(0)
  // Brief wait for the compositor to apply the opacity change.
  // 50ms is sufficient (vs 150ms for win.hide()) since there's no
  // window state transition — just an alpha value update.
  await new Promise((resolve) => setTimeout(resolve, 50))
}

/** Show the overlay window after screenshot capture with a smooth fade-in. */
export function showAfterScreenshot(): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  isHiddenForScreenshot = false

  // Cancel any in-progress fade from a previous cycle
  if (screenshotFadeTimer) {
    clearInterval(screenshotFadeTimer)
    screenshotFadeTimer = null
  }

  // On Windows with content protection, window was never hidden — nothing to restore
  if (contentProtectionReliable) return

  const targetOpacity = savedOpacityBeforeScreenshot

  // Re-assert topmost — may have been lost while transparent.
  // Skip if a native dialog is open — resumeTopmost() will handle it.
  if (currentMode !== 'auth' && !isNativeDialogOpen) {
    win.setAlwaysOnTop(true, 'screen-saver', 1)
    win.moveTop()
  }

  // Smooth fade-in from 0 → target over 250ms (ease-out cubic).
  // Window is already at opacity 0 from hideForScreenshot — no showInactive()
  // needed since the window was never hidden, just made transparent.
  const FADE_DURATION = 250
  const FADE_STEP = 16 // ~60fps
  const steps = Math.ceil(FADE_DURATION / FADE_STEP)
  let step = 0
  screenshotFadeTimer = setInterval(() => {
    step++
    if (win.isDestroyed()) { clearInterval(screenshotFadeTimer!); screenshotFadeTimer = null; return }
    const t = Math.min(step / steps, 1)
    const eased = 1 - Math.pow(1 - t, 3)
    win.setOpacity(eased * targetOpacity)
    if (t >= 1) { clearInterval(screenshotFadeTimer!); screenshotFadeTimer = null }
  }, FADE_STEP)
}

/**
 * Hide the overlay before a desktop action (click, type, scroll, drag).
 * Unlike screenshots, desktop actions need the window to be click-through
 * so mouse/keyboard events pass to the app underneath.
 * Uses opacity + setIgnoreMouseEvents instead of win.hide() for seamless UX.
 */
export async function hideForDesktopAction(): Promise<void> {
  const win = mainWindow
  if (!win || win.isDestroyed() || !win.isVisible()) return
  isHiddenForScreenshot = true // reuse flag to suppress topmost enforcer

  savedOpacityBeforeScreenshot = intendedOpacity

  if (screenshotFadeTimer) {
    clearInterval(screenshotFadeTimer)
    screenshotFadeTimer = null
  }

  // Make window invisible AND click-through in one go — no OS window
  // animation, no taskbar flash, no visual glitch.
  win.setOpacity(0)
  win.setIgnoreMouseEvents(true)
  await new Promise((resolve) => setTimeout(resolve, 50))
}

/**
 * Restore the overlay after a desktop action with a smooth fade-in.
 */
export function showAfterDesktopAction(): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  isHiddenForScreenshot = false

  if (screenshotFadeTimer) {
    clearInterval(screenshotFadeTimer)
    screenshotFadeTimer = null
  }

  // Restore mouse event handling first
  win.setIgnoreMouseEvents(false)

  const targetOpacity = savedOpacityBeforeScreenshot

  if (currentMode !== 'auth' && !isNativeDialogOpen) {
    win.setAlwaysOnTop(true, 'screen-saver', 1)
    win.moveTop()
  }

  // Smooth fade-in
  const FADE_DURATION = 250
  const FADE_STEP = 16
  const steps = Math.ceil(FADE_DURATION / FADE_STEP)
  let step = 0
  screenshotFadeTimer = setInterval(() => {
    step++
    if (win.isDestroyed()) { clearInterval(screenshotFadeTimer!); screenshotFadeTimer = null; return }
    const t = Math.min(step / steps, 1)
    const eased = 1 - Math.pow(1 - t, 3)
    win.setOpacity(eased * targetOpacity)
    if (t >= 1) { clearInterval(screenshotFadeTimer!); screenshotFadeTimer = null }
  }, FADE_STEP)
}

/**
 * Move the overlay window to a different display, preserving the current mode
 * layout (top-center for compact, centered for expanded).
 * Resets savedPosition since it belonged to the old display.
 */
export function moveToDisplay(display: Electron.Display): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  if (currentMode === 'auth') return

  const { x: workX, y: workY } = display.workArea
  const { width: workW, height: workH } = display.workAreaSize
  const [curW, curH] = win.getSize()

  let x: number
  let y: number

  if (currentMode === 'compact') {
    x = workX + Math.round((workW - curW) / 2)
    y = workY + 16
  } else {
    // expanded — center horizontally, near top
    x = workX + Math.round((workW - curW) / 2)
    y = workY + 16
  }

  // Clamp to work area
  x = Math.max(workX, Math.min(x, workX + workW - curW))
  y = Math.max(workY, Math.min(y, workY + workH - curH))

  savedPosition = { x, y }
  win.setBounds({ x, y, width: curW, height: curH })
}
