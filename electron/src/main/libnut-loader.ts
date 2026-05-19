/**
 * Cross-platform libnut loader with Wayland detection and graceful fallback.
 *
 * Why a wrapper instead of `require('@nut-tree-fork/libnut')` directly?
 *
 *   1. The meta package's high-level API is async wrapper classes; we want
 *      the raw sync N-API surface from the platform-specific binding
 *      (libnut-win32 / libnut-darwin / libnut-linux). Each ships an
 *      identical `index.d.ts`.
 *   2. Loading must happen at runtime — Rollup can't bundle .node files,
 *      and a static `import` in TypeScript would force one platform.
 *   3. Tests need a single mockable seam. Mocking
 *      `@nut-tree-fork/libnut-win32` directly works on Windows but fails
 *      on macOS test runners; mocking THIS module works everywhere.
 *   4. Linux Wayland: libnut loads but every call silently no-ops because
 *      XTest doesn't work on a Wayland-only session. We detect this once
 *      and surface a clear error rather than the agent looking dead.
 */

export interface LibnutAPI {
  setKeyboardDelay(ms: number): void
  keyTap(key: string, modifier?: string | string[]): void
  keyToggle(key: string, down: 'down' | 'up', modifier?: string | string[]): void
  typeString(s: string): void
  typeStringDelayed(s: string, cpm: number): void
  setMouseDelay(delay: number): void
  moveMouse(x: number, y: number): void
  moveMouseSmooth(x: number, y: number): void
  mouseClick(button?: 'left' | 'right' | 'middle', double?: boolean): void
  mouseToggle(down?: 'down' | 'up', button?: 'left' | 'right' | 'middle'): void
  dragMouse(x: number, y: number): void
  scrollMouse(x: number, y: number): void
  getMousePos(): { x: number; y: number }
  getScreenSize(): { width: number; height: number }
}

let cached: LibnutAPI | null = null
let loadError: Error | null = null

/** True if the running session is Wayland-only — XTest input events don't
 *  work there. Detected via XDG_SESSION_TYPE; default false on win32/darwin. */
function isWaylandSession(): boolean {
  if (process.platform !== 'linux') return false
  return (process.env.XDG_SESSION_TYPE ?? '').toLowerCase() === 'wayland'
}

/**
 * Lazily load the platform-appropriate libnut binding. Throws a typed Error
 * on first failure and caches the failure so subsequent callers don't
 * re-try a doomed dlopen on every action. Reset behaviour is intentionally
 * absent — once loading fails, the whole session falls back.
 */
export function loadLibnut(): LibnutAPI {
  if (cached) return cached
  if (loadError) throw loadError

  if (isWaylandSession()) {
    loadError = new Error(
      'libnut requires X11; this session is Wayland (XDG_SESSION_TYPE=wayland). ' +
      'Switch to an X11/Xorg session, or run the app under XWayland with ' +
      '`GDK_BACKEND=x11` if your distro permits it.'
    )
    throw loadError
  }

  const platform = process.platform
  let pkg: string
  if (platform === 'win32') pkg = '@nut-tree-fork/libnut-win32'
  else if (platform === 'linux') pkg = '@nut-tree-fork/libnut-linux'
  else if (platform === 'darwin') pkg = '@nut-tree-fork/libnut-darwin'
  else {
    loadError = new Error(`libnut: unsupported platform "${platform}"`)
    throw loadError
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require(pkg) as LibnutAPI
    return cached
  } catch (e: any) {
    loadError = new Error(
      `Failed to load ${pkg}: ${e?.message || e}. ` +
      `The native .node binary may be missing — run "npm install" or rebuild ` +
      `with "@electron/rebuild" if Electron's Node ABI changed.`
    )
    throw loadError
  }
}

/** Test-only: forcefully reset the loader so tests can rebind the mock. */
export function _resetLoader(): void {
  cached = null
  loadError = null
}
