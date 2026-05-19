/**
 * Cross-platform desktop automation via @nut-tree-fork/libnut.
 *
 * This file used to be a 850-line tower of PowerShell `Add-Type @"..."@`
 * blocks importing user32.dll P/Invoke (mouse_event, keybd_event), Swift
 * scripts piped to `swift -`, and xdotool shell-outs. That stack worked but
 * tripped Windows AMSI / Defender / EDR products as a Cobalt-Strike /
 * Mimikatz fingerprint — runtime C# compilation + SendInput is the literal
 * keylogger pattern, and unsigned binaries doing it get flagged on first
 * run. Migrating to libnut (a signed N-API native module) gives us:
 *
 *   - Identical public API — every exported function keeps its signature,
 *     return shape, and platform-conditional behaviours (e.g. macOS
 *     ctrl-as-cmd remapping, multi-monitor coords).
 *   - Sub-millisecond startup per call instead of spawning a PowerShell
 *     interpreter (200-500ms cold).
 *   - One signed dependency for AV/Defender/EDR to scan ONCE, instead of
 *     synthesising new attack-surface strings on every action.
 *
 * Two libnut quirks the wrappers below paper over:
 *   1. Windows multi-monitor — libnut's moveMouse normalizes coords against
 *      SM_CXSCREEN (primary only), so off-primary clicks land wrong. We
 *      use a single signed-assembly PowerShell call to position the cursor
 *      via System.Windows.Forms.Cursor (Microsoft-signed, no inline C#,
 *      no AMSI heuristic match) and let libnut emit the click at the
 *      already-positioned cursor.
 *   2. Windows dragMouse is broken (no actual button-down). We do down →
 *      move → up manually on every platform for cross-platform parity.
 */

import { execFile } from 'child_process'
import { isAccessibilityGranted, requestAccessibility } from './permissions'
import { getActiveDisplay } from './display-manager'
import { loadLibnut, type LibnutAPI } from './libnut-loader'
import { reportInfo } from './error-reporter'

// ─── macOS Accessibility gate ─────────────────────────────────────────────

let _hasPromptedAccessibility = false
function requireAccessibility(): { success: false; error: string; permissionDenied: true; permissionType: 'accessibility' } | null {
  if (process.platform !== 'darwin') return null
  if (isAccessibilityGranted()) return null

  if (!_hasPromptedAccessibility) {
    _hasPromptedAccessibility = true
    requestAccessibility()
  }

  return {
    success: false,
    error: 'macOS Accessibility permission is required for desktop automation (clicks, typing, scrolling). '
      + 'A permission prompt should have appeared — grant access to Coasty, then restart the app. '
      + 'You can also enable it manually: System Settings > Privacy & Security > Accessibility > enable Coasty.',
    permissionDenied: true,
    permissionType: 'accessibility',
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function validateInt(v: unknown, name: string): number {
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`Invalid ${name}: expected a number`)
  return Math.round(n)
}

/** Lazy libnut handle — throws once at first call if loading fails so the
 *  caller's try/catch surfaces a clear message instead of a silent no-op. */
let _libnut: LibnutAPI | null = null
function lib(): LibnutAPI {
  if (_libnut) return _libnut
  _libnut = loadLibnut()
  return _libnut
}

// ─── Multi-monitor cursor positioning (Windows-only fallback) ────────────

/**
 * Move the cursor to absolute (x, y). Two Windows quirks the wrapper handles:
 *
 *  1. **Multi-monitor**: libnut's `moveMouse` normalises against the PRIMARY
 *     monitor's pixel size, so coords that fall outside the primary display
 *     land wrong. Detect off-primary and fall back to a signed-assembly
 *     PowerShell call (System.Windows.Forms.Cursor uses virtual-desktop
 *     coords, no AMSI heuristic match).
 *
 *  2. **DPI scaling**: libnut on Windows calls
 *     `SetThreadDPIAwarenessContext(PER_MONITOR_AWARE_V2)` and operates in
 *     PHYSICAL pixels. The agent's pipeline runs in LOGICAL pixels — the
 *     screenshot is captured at `display.size` (logical), the agent reasons
 *     in that space, and emits clicks back in that same logical space.
 *     Pass logical coords directly to libnut and on a 4K@150% display every
 *     click lands at ~67% of intended position. Multiply by scaleFactor to
 *     bridge the two coordinate systems.
 *
 *     The old PowerShell path didn't have this bug because PowerShell is
 *     not DPI-aware, so Windows auto-scaled logical→physical for it. The
 *     libnut migration broke high-DPI Windows users until this scaling was
 *     restored — that's the "clicking in wrong places" symptom.
 *
 * On macOS / Linux libnut already uses logical coords correctly:
 *   - macOS: CGWarpMouseCursorPosition takes Cocoa points (logical pixels)
 *   - Linux: X11 has no DPI abstraction; scaleFactor is 1.0 in practice
 * So scaling is Windows-only.
 */
async function moveMouseAbsolute(x: number, y: number): Promise<void> {
  if (process.platform === 'win32') {
    const display = getActiveDisplay()
    const isPrimary = display.bounds.x === 0 && display.bounds.y === 0
    if (!isPrimary) {
      // Coordinates already include the active-display offset (LocalExecutor
      // applies it before this is called). For non-primary monitors libnut
      // can't reach them, so use System.Windows.Forms.Cursor instead.
      // PowerShell is non-DPI-aware so Windows handles the logical→physical
      // conversion automatically — pass logical coords through unchanged.
      await runPowershellCursor(x, y)
      return
    }
    // Primary monitor with libnut: scale logical → physical for DPI awareness.
    // scaleFactor of 1.0 makes this a no-op on standard 100% displays.
    const scale = display.scaleFactor || 1
    lib().moveMouse(Math.round(x * scale), Math.round(y * scale))
    return
  }
  lib().moveMouse(x, y)
}

/** Single signed-assembly PowerShell call to set cursor position on
 *  multi-monitor Windows. No `Add-Type @"...inline C#..."@`, just a
 *  `-AssemblyName` reference to a Microsoft-signed assembly. AMSI is fine
 *  with this; it's the inline C# + DllImport pattern that triggers
 *  "RAT-like" heuristics. */
function runPowershellCursor(x: number, y: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const script =
      `Add-Type -AssemblyName System.Windows.Forms; ` +
      `[System.Windows.Forms.Cursor]::Position = ` +
      `New-Object System.Drawing.Point(${x}, ${y})`
    // maxBuffer raised to 10 MB across the codebase on 2026-05-17 after
    // ERR_CHILD_PROCESS_STDIO_MAXBUFFER events from PowerShell scripts;
    // see terminal.ts MAX_OUTPUT_BUFFER_BYTES for the rationale. Cursor
    // moves are silent so we'll never approach this, but consistency
    // across every PowerShell spawn is worth more than the few bytes.
    execFile('powershell.exe', ['-NoProfile', '-Command', script], {
      timeout: 5000,
      maxBuffer: 10 * 1024 * 1024,
    }, (err) => {
      if (err) reject(err); else resolve()
    })
  })
}

/**
 * Yield the Coasty overlay's focus before a synthetic wheel event so the
 * window UNDER the cursor receives it.
 *
 * ─── Why this exists (Windows synthetic-scroll bug) ──────────────────────
 * Per MSDN — https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-mousewheel:
 *   "Sent to the focus window when the mouse wheel is rotated."
 *
 * `MOUSEEVENTF_WHEEL` (which libnut.scrollMouse uses internally) generates
 * `WM_MOUSEWHEEL` — delivered to the **FOCUS window**, NOT the window under
 * the cursor. Windows' "Scroll inactive windows when hovering"
 * (registry: HKCU\Control Panel\Desktop\MouseWheelRouting=2) only reroutes
 * the message via DefWindowProc when the focus window itself is wheel-aware
 * and chooses to forward.
 *
 * The Coasty overlay is a frameless transparent always-on-top window.
 * `hideForDesktopAction()` (window-manager.ts) sets opacity=0 and
 * `setIgnoreMouseEvents(true)` — but it does NOT release focus. So the
 * overlay still owns focus from the OS's perspective; synthetic wheels go
 * to a hidden click-through window and Chrome never sees them.
 *
 * Real left-clicks don't have this problem: `WM_LBUTTONDOWN` triggers
 * Win32 input activation — the under-cursor window becomes
 * foreground/focus as a side effect. Wheel events do NOT activate. That's
 * why the agent's "click first, then scroll" workaround works in CloudWatch
 * traces, and why bumping inter-notch sleep to 50ms / cursor-settle to
 * 100ms didn't help: those address coalescing, not the focus-routing bug.
 *
 * Fix: call `win.blur()` on the overlay before scrolling. Electron's blur
 * gives up keyboard focus AND foreground status; Windows then routes the
 * next synthetic wheel via WindowFromPoint at GetCursorPos, which is
 * exactly where we positioned the cursor at the start of desktopScroll.
 * No native deps, no inline C# (avoids AMSI keylogger heuristics — see
 * file-header comment), no destructive side effects (blur doesn't dismiss
 * popovers; SetForegroundWindow on a click would).
 *
 * After scrolling, `showAfterDesktopAction()` already calls
 * `setAlwaysOnTop(true, 'screen-saver', 1) + moveTop()` so the overlay
 * comes back on top normally.
 */
async function blurOverlayForScroll(): Promise<void> {
  if (process.platform !== 'win32') return
  try {
    const { BrowserWindow } = await import('electron')
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && win.isFocused()) win.blur()
    }
  } catch { /* fall through — best-effort */ }
}

// ─── Key vocabulary translation ──────────────────────────────────────────

/** Coasty key name → libnut key name. libnut's vocabulary is strict: any
 *  unknown name throws "Invalid key code specified" at runtime. */
const KEY_TO_LIBNUT: Record<string, string> = {
  // Editing
  enter: 'enter', return: 'enter', kp_enter: 'enter',
  tab: 'tab',
  escape: 'escape', esc: 'escape',
  backspace: 'backspace', back_space: 'backspace',
  delete: 'delete', del: 'delete', forwarddelete: 'delete', kp_delete: 'delete',
  space: 'space',
  insert: 'insert',
  // Navigation
  up: 'up', down: 'down', left: 'left', right: 'right',
  home: 'home', end: 'end',
  pageup: 'pageup', page_up: 'pageup',
  pagedown: 'pagedown', page_down: 'pagedown',
  // Locks / sysreq
  capslock: 'caps_lock', caps_lock: 'caps_lock',
  numlock: 'num_lock', num_lock: 'num_lock',
  scrolllock: 'scroll_lock', scroll_lock: 'scroll_lock',
  printscreen: 'printscreen', print: 'printscreen', sys_req: 'printscreen',
  pause: 'pause', break: 'pause',
  menu: 'menu',
  // Numpad
  kp_0: 'numpad_0', numpad_0: 'numpad_0',
  kp_1: 'numpad_1', numpad_1: 'numpad_1',
  kp_2: 'numpad_2', numpad_2: 'numpad_2',
  kp_3: 'numpad_3', numpad_3: 'numpad_3',
  kp_4: 'numpad_4', numpad_4: 'numpad_4',
  kp_5: 'numpad_5', numpad_5: 'numpad_5',
  kp_6: 'numpad_6', numpad_6: 'numpad_6',
  kp_7: 'numpad_7', numpad_7: 'numpad_7',
  kp_8: 'numpad_8', numpad_8: 'numpad_8',
  kp_9: 'numpad_9', numpad_9: 'numpad_9',
  kp_decimal: 'numpad_decimal', numpad_decimal: 'numpad_decimal',
  kp_add: 'add', kp_subtract: 'subtract',
  kp_multiply: 'multiply', kp_divide: 'divide',
  // Modifier-as-key (when pressed standalone, not as a modifier on another key)
  ctrl: 'control', control: 'control',
  alt: 'alt', option: 'alt',
  shift: 'shift',
  cmd: 'cmd', command: 'cmd',
  win: 'win', super: 'win', meta: 'win',
  fn: 'fn', function: 'fn',
}

// F-keys f1-f24 pass through verbatim
for (let i = 1; i <= 24; i++) KEY_TO_LIBNUT[`f${i}`] = `f${i}`

// Additional darwin-friendly aliases the agent commonly emits. These are
// already accepted via fall-through (e.g. `q`, `w`, `,` match the alphanumeric
// or punctuation regex below) — listing them here serves as documentation of
// the macOS chord set we explicitly support and gives `expandChordKeys` a
// guaranteed match on synonyms like `return_key` or `space_bar`.
KEY_TO_LIBNUT.spacebar = 'space'
KEY_TO_LIBNUT.space_bar = 'space'
KEY_TO_LIBNUT.return_key = 'enter'
KEY_TO_LIBNUT.kp_return = 'enter'
// Left/right modifier variants — some agents emit these explicitly. libnut
// treats both halves as the same modifier so we collapse them here.
KEY_TO_LIBNUT.command_l = 'cmd'; KEY_TO_LIBNUT.command_r = 'cmd'
KEY_TO_LIBNUT.cmd_l = 'cmd'; KEY_TO_LIBNUT.cmd_r = 'cmd'
KEY_TO_LIBNUT.option_l = 'alt'; KEY_TO_LIBNUT.option_r = 'alt'
KEY_TO_LIBNUT.alt_l = 'alt'; KEY_TO_LIBNUT.alt_r = 'alt'
KEY_TO_LIBNUT.shift_l = 'shift'; KEY_TO_LIBNUT.shift_r = 'shift'
KEY_TO_LIBNUT.control_l = 'control'; KEY_TO_LIBNUT.control_r = 'control'
KEY_TO_LIBNUT.ctrl_l = 'control'; KEY_TO_LIBNUT.ctrl_r = 'control'
// Arrow-key synonyms
KEY_TO_LIBNUT.arrowup = 'up'; KEY_TO_LIBNUT.arrow_up = 'up'
KEY_TO_LIBNUT.arrowdown = 'down'; KEY_TO_LIBNUT.arrow_down = 'down'
KEY_TO_LIBNUT.arrowleft = 'left'; KEY_TO_LIBNUT.arrow_left = 'left'
KEY_TO_LIBNUT.arrowright = 'right'; KEY_TO_LIBNUT.arrow_right = 'right'

/** Translate a Coasty key name to libnut's vocabulary. Single ASCII chars
 *  pass through (libnut accepts lowercase a-z / 0-9 / common punctuation
 *  literally). Throws on unknown names. */
function toLibnutKey(key: string): string {
  if (!key) throw new Error('Empty key name')
  const lower = key.toLowerCase()
  const mapped = KEY_TO_LIBNUT[lower]
  if (mapped) return mapped
  if (/^[a-z0-9]$/.test(lower)) return lower
  if (/^[,./;'\[\]\\\-=`]$/.test(lower)) return lower
  throw new Error(`Unsupported key for automation: "${key}"`)
}

/**
 * Normalize a chord input into a flat list of single-token keys.
 *
 * ─── Why this exists (the 2026-05-14 macOS Spotlight bug) ────────────────
 * The backend agent's system prompt (cua_remote_env.py) literally instructs
 * the model to emit `agent.hotkey("ctrl+c")` — a SINGLE +-separated string.
 * The action-bridge regex in cua_action_bridge.py (`pyautogui.hotkey(...)`)
 * passes that through unsplit, so the WS command arrives as:
 *
 *     { command: 'key_combo', parameters: { keys: ["command+space"] } }
 *
 * Without normalization, `toLibnutKey("command+space")` throws
 * `Unsupported key for automation: "command+space"` and the agent gets
 * the production error from the 2026-05-14 incident. By splitting on `+`
 * here we accept both forms equivalently:
 *
 *     ["command", "space"]   ← already split
 *     ["command+space"]      ← single combined token (the bug form)
 *     ["command + space"]    ← combined with whitespace around the +
 *     "command+space"        ← bare string (not even an array)
 *     ["cmd+shift+a"]        ← multi-modifier chord
 *     [["cmd","shift"], "a"] ← nested arrays (defensive)
 *
 * ─── Safety: why splitting on `+` is safe ────────────────────────────────
 * libnut's vocabulary has NO key literally named `+` — to emit the `+`
 * character you actually press `shift+=`, and `=` IS in the punctuation
 * pass-through set. A standalone `"+"` token (length 1) is preserved as-is
 * because the length-1 short-circuit below skips splitting; only multi-char
 * strings containing a `+` get split. So no legitimate key name is lost.
 *
 * Single-char punctuation like `"+"`, `"="`, `","` is also preserved because
 * a single char can't be a chord. This matters for shortcuts like cmd+, —
 * the model could plausibly emit `["cmd", ","]` or `["cmd+,"]`; both work.
 */
export function expandChordKeys(input: unknown): string[] {
  const out: string[] = []
  const visit = (val: unknown): void => {
    if (val == null) return
    if (Array.isArray(val)) { for (const v of val) visit(v); return }
    if (typeof val !== 'string') return
    if (val.length === 0) return
    // Length-1 strings are atomic: even "+" survives as a key token rather
    // than being treated as a chord separator.
    if (val.length === 1) { out.push(val); return }
    // Multi-char: split on '+' (with optional surrounding whitespace) only.
    // Bare whitespace is NOT a delimiter because some agents emit multi-word
    // key names like "page up" verbatim — splitting those would produce
    // unknown tokens (`page`, `up`) where `pageup` / `page_up` would have
    // resolved correctly. The agents most commonly pass `+` chords; that's
    // what we split.
    const parts = val.split(/\s*\+\s*/).map(s => s.trim()).filter(s => s.length > 0)
    if (parts.length === 0) {
      // Input was nothing but separators — pass through; downstream
      // toLibnutKey() will produce a more descriptive "Unsupported key"
      // error including the original token.
      out.push(val)
      return
    }
    for (const p of parts) out.push(p)
  }
  visit(input)
  return out
}

const MODIFIER_NAMES = new Set([
  'ctrl', 'control', 'control_l', 'control_r', 'ctrl_l', 'ctrl_r',
  'alt', 'option', 'alt_l', 'alt_r', 'option_l', 'option_r',
  'shift', 'shift_l', 'shift_r',
  'cmd', 'command', 'cmd_l', 'cmd_r', 'command_l', 'command_r',
  'meta', 'win', 'super', 'fn',
])

function isModifier(key: string): boolean {
  return MODIFIER_NAMES.has(key.toLowerCase())
}

/**
 * Translate a Coasty modifier name to libnut's modifier vocabulary.
 *
 * macOS convention preserved from the previous PowerShell stack: ctrl/
 * control map to cmd because most agents emit "ctrl+c" meaning "the
 * platform copy shortcut," and that has to be Cmd-C on macOS to actually
 * copy. (See MAC_KEY_NORMALIZATION in the legacy code for the same rule.)
 */
function toLibnutModifier(key: string): string {
  const lower = key.toLowerCase()
  if (process.platform === 'darwin') {
    switch (lower) {
      case 'ctrl': case 'control':
      case 'cmd': case 'command': case 'meta':
      case 'win': case 'super':
        return 'cmd'
      case 'alt': case 'option': return 'alt'
      case 'shift': return 'shift'
      case 'fn': return 'fn'
    }
  }
  switch (lower) {
    case 'ctrl': case 'control': return 'control'
    case 'alt': case 'option': return 'alt'
    case 'shift': return 'shift'
    case 'cmd': case 'command': case 'meta':
    case 'win': case 'super':
      return 'win'
    case 'fn': return 'fn'
  }
  return lower
}

// libnut button vocabulary: 'left' | 'right' | 'middle' (NOT 'center').
function toLibnutButton(button?: string): 'left' | 'right' | 'middle' {
  switch ((button || '').toLowerCase()) {
    case 'right': return 'right'
    case 'middle': case 'center': return 'middle'
    default: return 'left'
  }
}

// ─── Public API ──────────────────────────────────────────────────────────

export async function desktopClick(params: { x: number; y: number; button?: string }): Promise<any> {
  try {
    const denied = requireAccessibility()
    if (denied) return denied

    const x = validateInt(params.x, 'x')
    const y = validateInt(params.y, 'y')
    const button = toLibnutButton(params.button)

    await moveMouseAbsolute(x, y)
    lib().mouseClick(button)

    return { success: true, message: `Clicked at (${x}, ${y})` }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function desktopDoubleClick(params: { x: number; y: number }): Promise<any> {
  try {
    const denied = requireAccessibility()
    if (denied) return denied

    const x = validateInt(params.x, 'x')
    const y = validateInt(params.y, 'y')

    await moveMouseAbsolute(x, y)
    // libnut's mouseClick(button, double=true) emits a real OS double-click
    // — registers as one event with clickCount=2, not two single clicks.
    // That's the platform-correct behaviour (apps differentiate them).
    lib().mouseClick('left', true)

    return { success: true, message: `Double-clicked at (${x}, ${y})` }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function desktopClickWithModifiers(params: {
  x: number
  y: number
  button?: string
  hold_keys?: string[]
  clicks?: number
}): Promise<any> {
  try {
    const denied = requireAccessibility()
    if (denied) return denied

    const x = validateInt(params.x, 'x')
    const y = validateInt(params.y, 'y')
    const button = toLibnutButton(params.button)
    const clicks = params.clicks !== undefined ? validateInt(params.clicks, 'clicks') : 1
    const holdKeys = (params.hold_keys ?? []).map(toLibnutModifier)

    const libnut = lib()

    // Press modifiers, then position, then click N times, then release.
    for (const mod of holdKeys) libnut.keyToggle(mod, 'down')
    if (holdKeys.length) await sleep(50)

    await moveMouseAbsolute(x, y)
    await sleep(30)

    if (clicks >= 2) {
      // True double-click semantics for clicks=2 (preferred over two singles
      // because OS dispatchers latch click count for app behaviours like
      // "select word" vs "select line").
      libnut.mouseClick(button, true)
      // For clicks > 2, fire singles after to reach the count.
      for (let i = 2; i < clicks; i++) {
        await sleep(50)
        libnut.mouseClick(button)
      }
    } else {
      libnut.mouseClick(button)
    }

    if (holdKeys.length) await sleep(30)
    for (const mod of [...holdKeys].reverse()) libnut.keyToggle(mod, 'up')

    return {
      success: true,
      message: `Clicked at (${x}, ${y}) with modifiers [${holdKeys.join(', ')}]`,
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function desktopType(params: { text: string }): Promise<any> {
  try {
    const denied = requireAccessibility()
    if (denied) return denied

    const text = String(params.text ?? '')

    // libnut.typeString handles UTF-8 directly via OS-level Unicode input —
    // no clipboard, no shell escaping. SMP characters (some emoji) may
    // fall back to scancode injection on Windows; for those a paste-style
    // workaround would be needed, but the previous SendKeys path had the
    // same limitation so we preserve behaviour.
    lib().typeString(text)

    const truncated = text.length > 50 ? `${text.slice(0, 50)}...` : text
    return { success: true, message: `Typed "${truncated}"` }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function desktopKeyPress(params: { keys: string[] | string }): Promise<any> {
  try {
    const denied = requireAccessibility()
    if (denied) return denied

    // Normalize: accept either an array, a single +-separated string, or a
    // mix. See expandChordKeys() docstring for the input shapes we tolerate.
    const keys = expandChordKeys(params?.keys)
    if (keys.length === 0) return { success: false, error: 'No keys specified' }

    // Semantic note: for desktopKeyPress, the historical contract is
    // "press each key SEQUENTIALLY" (typing word-by-word). If the input
    // looked like a chord (single multi-key token with `+`), the user
    // almost certainly meant a chord, not a sequence — auto-detect and
    // re-route to desktopKeyCombo for that case so an agent that mistakenly
    // sends "ctrl+c" to key_press still copies, instead of typing
    // "ctrl" then "c" as discrete presses.
    const looksLikeChord =
      (typeof params?.keys === 'string' && /\+/.test(params.keys)) ||
      (Array.isArray(params?.keys) &&
        params.keys.some((k) => typeof k === 'string' && /\+/.test(k)))
    if (looksLikeChord && keys.length >= 2) {
      return desktopKeyCombo({ keys })
    }

    const libnut = lib()
    for (const k of keys) {
      // keyTap = press+release. For sequential keys (typing "h-e-l-l-o"
      // word-by-word) this matches the old SendKeys / xdotool behaviour.
      libnut.keyTap(toLibnutKey(k))
    }

    return { success: true, message: `Pressed keys: ${keys.join(', ')}` }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function desktopKeyCombo(params: { keys: string[] | string }): Promise<any> {
  try {
    const denied = requireAccessibility()
    if (denied) return denied

    // Normalize: accept either an array of separate keys (['ctrl', 'c']),
    // a single +-separated string ('ctrl+c'), or an array with combined
    // tokens (['ctrl+c'], ['cmd+shift+a']). See expandChordKeys() docstring.
    //
    // This is the fix for the 2026-05-14 macOS production incident where
    // the backend agent emitted `agent.hotkey("command+space")` for
    // Spotlight, the action-bridge passed it through as
    // `keys: ["command+space"]`, and toLibnutKey threw
    // `Unsupported key: "command+space"`.
    const keys = expandChordKeys(params?.keys)
    if (keys.length === 0) return { success: false, error: 'No keys specified' }
    if (keys.length === 1) return desktopKeyPress({ keys })

    // Last key triggers; everything before it acts as held modifiers.
    // Non-modifier "leading" keys (e.g. agent emits ['shift', 'a', 'b'])
    // are passed verbatim — libnut's keyTap modifier list is permissive.
    const finalKey = keys[keys.length - 1]
    const modifiers = keys.slice(0, -1).map(toLibnutModifier)

    // libnut accepts string | string[] for the modifier param.
    lib().keyTap(toLibnutKey(finalKey), modifiers.length === 1 ? modifiers[0] : modifiers)

    return { success: true, message: `Key combo: ${keys.join('+')}` }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

// Capped so the worst-case scroll completes inside the agent's command
// timeout window. With per-notch event splitting + the inter-notch sleep
// below, 100 notches takes ~5s on Windows and ~1.6s elsewhere — enough
// for any realistic agent scroll, and a hard ceiling against runaway
// requests like `vscroll(99999)`.
const MAX_SCROLL_CLICKS = 100

export async function desktopScroll(params: {
  clicks: number
  direction?: 'vertical' | 'horizontal'
  x?: number
  y?: number
}): Promise<any> {
  try {
    const denied = requireAccessibility()
    if (denied) return denied

    const rawClicks = validateInt(params.clicks, 'clicks')
    const amount = Math.min(Math.abs(rawClicks), MAX_SCROLL_CLICKS)
    const direction = params.direction || 'vertical'
    const scrollUp = rawClicks > 0
    const sign = scrollUp ? 1 : -1

    // Cursor must be positioned BEFORE libnut.scrollMouse fires — libnut
    // never moves the cursor itself; the OS routes the wheel event to the
    // window under the current cursor on every platform:
    //   Windows: MOUSEEVENTF_WHEEL fires at GetCursorPos
    //   macOS:   CGEventCreateScrollWheelEvent(NULL, ...) uses HID location
    //   Linux:   XTestFakeButtonEvent goes to pointer-focus window
    if (params.x !== undefined && params.y !== undefined) {
      const x = validateInt(params.x, 'x')
      const y = validateInt(params.y, 'y')
      await moveMouseAbsolute(x, y)
      // 100ms (was 50ms): some apps require the cursor to fully settle
      // before they accept wheel events on a newly-hovered element. The
      // longer pause empirically improves Steam / Chromium scroll
      // reliability without adding noticeable latency to the agent loop.
      await sleep(100)
    }

    // ─── CRITICAL: yield focus on Windows ─────────────────────────────────
    // WM_MOUSEWHEEL is routed to the FOCUS window per MSDN, not under-cursor.
    // The Coasty overlay keeps focus during opacity-based hiding so wheel
    // events go nowhere productive. Blur the overlay so Windows' inactive-
    // window-scroll routing kicks in and the wheel reaches Chrome/Edge/etc.
    // See blurOverlayForScroll() docstring above for full explanation.
    await blurOverlayForScroll()

    // Per-platform unit normalisation — libnut's `scrollMouse(x, y)` passes
    // its arguments STRAIGHT to the OS, and each OS uses a fundamentally
    // different scale (verified by reading libnut-core/src/{win32,macos,
    // linux}/mouse.c):
    //
    //   Windows: `mouseData = y` for MOUSEEVENTF_WHEEL, where the OS expects
    //            WHEEL_DELTA units (120 per notch).
    //   macOS:   `CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitPixel,
    //            2, y, x)` — `y` is in PIXELS. ~100 px ≈ one real wheel notch.
    //   Linux:   `XTestFakeButtonEvent` loop over abs(y) iterations. 1 unit
    //            = 1 wheel notch already.
    //
    // ─── Per-notch event splitting ───────────────────────────────────────
    // Sending ONE big wheel event (e.g. mouseData=-600 for 5 notches) is
    // semantically different from a physical mouse wheel which emits 5
    // separate events. Some apps (Steam's Chromium-embedded UI, certain
    // legacy Win32 controls, scroll-snap CSS sites) only animate or commit
    // ONE notch per discrete event regardless of magnitude — so a single
    // big event scrolls one notch and then ignores the rest of the
    // amplitude. Splitting into per-notch events at small intervals
    // matches a real wheel and works on every app we've tested.
    const perClick =
      process.platform === 'win32' ? 120 :
      process.platform === 'darwin' ? 100 : 1
    const perNotchDelta = sign * perClick

    // Horizontal sign is NOT consistent across platforms (verified against
    // libnut-core source):
    //   - Windows: libnut internally negates x in `mouseData = -x`,
    //     combined with MOUSEEVENTF_HWHEEL's "positive = right" convention
    //     means caller-positive = LEFT.
    //   - macOS: kCGScrollEventUnitPixel x-axis: positive = RIGHT.
    //   - Linux: button 6 = positive x = LEFT, button 7 = negative = RIGHT.
    // Normalise to caller-positive = RIGHT on every platform.
    const horizSignFlip = process.platform === 'darwin' ? 1 : -1

    const libnut = lib()
    // Inter-event sleep is critical and platform-specific:
    //
    //   Windows: Chromium's MouseWheelEventQueue (content/browser/
    //   renderer_host/input/mouse_wheel_event_queue.cc) only allows ONE
    //   wheel event in flight to the renderer. New events arriving while
    //   one is pending are COALESCED into the pending event by SUMMING
    //   deltas — they are NOT enqueued as separate events. The queue
    //   drains on the next renderer ack (~one frame ≈ 16ms) but the
    //   active wheel "phase" stays open for ~100ms (MouseWheelPhaseHandler
    //   timeout). Sub-frame intervals therefore collapse N notches into
    //   ~1 commit of progress — which is exactly what we saw in CloudWatch
    //   ("page scrolled a bit" but subsequent notches didn't progress).
    //   50ms exceeds the renderer ack window so each notch lands as a
    //   discrete kPhaseChanged wheel event the compositor actually
    //   animates.
    //
    //   macOS / Linux: 16ms ≈ one frame at 60fps. Pixel-unit scrolls on
    //   macOS and XTest button events on Linux don't go through the
    //   same coalescer, so 16ms is fine and keeps latency low.
    //
    // We sleep on EVERY notch transition (no threshold short-circuit) —
    // the MAX_SCROLL_CLICKS cap above bounds the total time.
    const interNotchMs = process.platform === 'win32' ? 50 : 16
    for (let i = 0; i < amount; i++) {
      if (direction === 'vertical') {
        libnut.scrollMouse(0, perNotchDelta)
      } else {
        libnut.scrollMouse(horizSignFlip * perNotchDelta, 0)
      }
      if (i + 1 < amount) {
        await sleep(interNotchMs)
      }
    }

    // Diagnostic log — surfaces in CloudWatch so a future "scroll isn't
    // working" report has the actual platform + cursor + delta + scale
    // information. Sampled (info-severity) so we don't flood logs under
    // heavy load.
    try {
      const display = getActiveDisplay()
      reportInfo('desktop_automation', {
        message: `scroll: ${amount} ${direction} ${scrollUp ? 'UP' : 'DOWN'} clicks`,
        command: 'scroll',
        context: {
          platform: process.platform,
          rawClicks,
          direction,
          x: params.x,
          y: params.y,
          scaleFactor: display.scaleFactor,
          perNotchDelta,
          notchesEmitted: amount,
          interNotchMs,
        },
      })
    } catch { /* logging failure must never break the action */ }

    return { success: true, message: `Scrolled ${scrollUp ? 'up' : 'down'} ${amount} clicks` }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function desktopDrag(params: {
  x1: number
  y1: number
  x2: number
  y2: number
  hold_keys?: string[]
}): Promise<any> {
  try {
    const denied = requireAccessibility()
    if (denied) return denied

    const x1 = validateInt(params.x1, 'x1')
    const y1 = validateInt(params.y1, 'y1')
    const x2 = validateInt(params.x2, 'x2')
    const y2 = validateInt(params.y2, 'y2')
    const holdKeys = (params.hold_keys ?? []).map(toLibnutModifier)

    const libnut = lib()

    // Modifiers down first (e.g. shift-drag for text-selection extension).
    for (const mod of holdKeys) libnut.keyToggle(mod, 'down')
    if (holdKeys.length) await sleep(50)

    // libnut.dragMouse on Windows is broken (no actual button-down — see
    // libnut-core src/win32/mouse.c). We compose down → move → up by hand
    // so the same code path runs identically on every platform.
    await moveMouseAbsolute(x1, y1)
    await sleep(100)
    libnut.mouseToggle('down', 'left')
    await sleep(50)

    // Smooth drag through the midpoint — many UIs (tile resize handles,
    // text-selection drag-to-select) only register a drag if intermediate
    // mousemove events fire between down and up.
    const xm = Math.round((x1 + x2) / 2)
    const ym = Math.round((y1 + y2) / 2)
    await moveMouseAbsolute(xm, ym)
    await sleep(50)
    await moveMouseAbsolute(x2, y2)
    await sleep(100)

    libnut.mouseToggle('up', 'left')

    if (holdKeys.length) await sleep(30)
    for (const mod of [...holdKeys].reverse()) libnut.keyToggle(mod, 'up')

    return {
      success: true,
      message: `Dragged from (${x1}, ${y1}) to (${x2}, ${y2})`,
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}
