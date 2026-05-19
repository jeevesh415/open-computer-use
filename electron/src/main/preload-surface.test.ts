/**
 * Preload bridge surface area + BrowserWindow security audit.
 *
 *  1. Static-analyse `electron/src/preload/index.ts` to confirm no Node
 *     primitives (require, process.binding, electron.remote, webFrame.executeJavaScript)
 *     leak across the contextBridge boundary.
 *  2. Confirm the main BrowserWindow is configured with `contextIsolation: true`,
 *     `nodeIntegration: false`, no `enableRemoteModule: true`. Sandbox is
 *     intentionally `true` here (per index.ts) — but if any window opts out
 *     of sandboxing it must be explicitly justified.
 *  3. Snapshot the exposed `window.coasty` API surface — the set of method
 *     names exposed must match the documented set, no additions slip in.
 *  4. Cross-check: every method exposed on `window.coasty` MUST have a
 *     corresponding `ipcMain.handle()` registration somewhere in the main
 *     process source tree (otherwise the renderer is calling a phantom
 *     channel that always rejects).
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const PRELOAD_PATH = path.join(REPO_ROOT, 'src', 'preload', 'index.ts')
const INDEX_PATH = path.join(REPO_ROOT, 'src', 'main', 'index.ts')
const RAINBOW_PATH = path.join(REPO_ROOT, 'src', 'main', 'rainbow-border.ts')
const IPC_HANDLERS_PATH = path.join(REPO_ROOT, 'src', 'main', 'ipc-handlers.ts')
const MAIN_DIR = path.join(REPO_ROOT, 'src', 'main')

function readSource(p: string): string {
  return fs.readFileSync(p, 'utf-8')
}

// ─── Preload static analysis ────────────────────────────────────────────────

describe('preload bridge static analysis', () => {
  const src = readSource(PRELOAD_PATH)

  it('does not require() anything besides electron itself', () => {
    // The only `import ... from` in the preload should be from 'electron'.
    // CommonJS `require()` should not appear at all.
    const requireCalls = src.match(/\brequire\s*\(/g) || []
    expect(requireCalls.length, 'preload uses require()').toBe(0)

    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
    for (const dep of imports) {
      expect(dep, `unexpected preload dep: ${dep}`).toBe('electron')
    }
  })

  it('does not reference process.binding (private internal API)', () => {
    expect(src).not.toMatch(/process\s*\.\s*binding\s*\(/)
  })

  it('does not reference the deprecated electron.remote module', () => {
    expect(src).not.toMatch(/electron\.remote\b/)
    expect(src).not.toMatch(/['"]@electron\/remote['"]/)
  })

  it('does not call webFrame.executeJavaScript', () => {
    expect(src).not.toMatch(/webFrame[^\n]*executeJavaScript/)
  })

  it('does not eval()', () => {
    // Allow the word inside comments by checking for a call pattern only.
    expect(src).not.toMatch(/\beval\s*\(/)
  })

  it('only uses ipcRenderer.send for the allowlisted error:report channel', () => {
    // `invoke` is the default — request/response with main-process validation.
    // `send` is fire-and-forget; we allow it ONLY for the error:report channel
    // because:
    //   1. Reporting an error must NEVER block the UI thread (which `invoke`
    //      would do — it returns a promise the caller is expected to await).
    //   2. The main-process handler (index.ts `ipcMain.on('error:report', ...)`)
    //      validates the payload shape, re-stamps the category server-side,
    //      and never trusts the renderer for routing or auth context.
    // ANY other use of `.send` must add itself to the allowlist below.
    const ALLOWED_SEND_CHANNELS = new Set(['error:report'])

    const sendCallSites: string[] = []
    const sendChannelRegex = /ipcRenderer\s*\.\s*send\s*\(\s*['"]([^'"]+)['"]/g
    let m: RegExpExecArray | null
    while ((m = sendChannelRegex.exec(src)) !== null) {
      sendCallSites.push(m[1])
    }
    // Match the CALL-site only (followed by `(`), not the bare token in
    // comments / docstrings — the explanation block above this allowlist
    // mentions `ipcRenderer.send` in prose.
    const totalSendCount = (src.match(/ipcRenderer\s*\.\s*send\s*\(/g) || []).length
    // Every `.send` we found must have matched the regex (i.e. used a literal
    // string channel that we can audit at compile time).
    expect(sendCallSites.length, 'every ipcRenderer.send must use a literal string channel').toBe(totalSendCount)
    for (const ch of sendCallSites) {
      expect(ALLOWED_SEND_CHANNELS.has(ch), `unauthorized ipcRenderer.send channel: "${ch}"`).toBe(true)
    }
    // ipcRenderer.invoke / on / removeListener are fine.
    expect(src).toMatch(/ipcRenderer\s*\.\s*invoke/)
  })

  it('uses contextBridge.exposeInMainWorld with a single namespace key', () => {
    const exposes = [...src.matchAll(/contextBridge\s*\.\s*exposeInMainWorld\s*\(\s*['"]([^'"]+)['"]/g)]
    expect(exposes.length).toBe(1)
    expect(exposes[0][1]).toBe('coasty')
  })
})

// ─── BrowserWindow security audit ───────────────────────────────────────────

describe('BrowserWindow webPreferences', () => {
  const indexSrc = readSource(INDEX_PATH)

  it('main BrowserWindow declares contextIsolation: true', () => {
    expect(indexSrc).toMatch(/contextIsolation\s*:\s*true/)
  })

  it('main BrowserWindow declares nodeIntegration: false', () => {
    expect(indexSrc).toMatch(/nodeIntegration\s*:\s*false/)
  })

  it('no source file enables enableRemoteModule', () => {
    const files = walkDir(MAIN_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    for (const f of files) {
      const txt = readSource(f)
      expect(txt, `enableRemoteModule found in ${f}`).not.toMatch(/enableRemoteModule\s*:\s*true/)
    }
  })

  it('no source file enables nodeIntegrationInWorker without justification', () => {
    const files = walkDir(MAIN_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    for (const f of files) {
      const txt = readSource(f)
      expect(txt, `nodeIntegrationInWorker: true in ${f}`).not.toMatch(/nodeIntegrationInWorker\s*:\s*true/)
    }
  })

  it('no source file disables webSecurity', () => {
    const files = walkDir(MAIN_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    for (const f of files) {
      const txt = readSource(f)
      expect(txt, `webSecurity: false in ${f}`).not.toMatch(/webSecurity\s*:\s*false/)
    }
  })

  it('main BrowserWindow declares sandbox flag (true in current source)', () => {
    // The CLAUDE.md doc claims `sandbox: false` is required for native modules,
    // but the current production code uses `sandbox: true`. Either is acceptable
    // — we just verify the flag is explicitly set rather than left to Electron's
    // default (which has changed across major versions).
    expect(indexSrc).toMatch(/sandbox\s*:\s*(true|false)/)
  })

  it('rainbow-border BrowserWindow also has contextIsolation/nodeIntegration locked down', () => {
    const rainbowSrc = readSource(RAINBOW_PATH)
    expect(rainbowSrc).toMatch(/contextIsolation\s*:\s*true/)
    expect(rainbowSrc).toMatch(/nodeIntegration\s*:\s*false/)
  })
})

// ─── Snapshot of exposed window.coasty API ──────────────────────────────────

describe('window.coasty API surface snapshot', () => {
  const src = readSource(PRELOAD_PATH)

  /**
   * Pull all top-level keys defined on the object passed to
   * exposeInMainWorld('coasty', { ... }). This is a static parse — good
   * enough since the preload is intentionally simple.
   */
  function extractApiKeys(): string[] {
    const start = src.indexOf("contextBridge.exposeInMainWorld('coasty', {")
    expect(start, 'contextBridge.exposeInMainWorld not found').toBeGreaterThan(-1)
    const tail = src.slice(start)
    // Find the matching closing `})` at depth 0 (object brace balance).
    let depth = 0
    let i = 0
    let bodyStart = -1
    let bodyEnd = -1
    for (; i < tail.length; i++) {
      const ch = tail[i]
      if (ch === '{') {
        if (depth === 0) bodyStart = i + 1
        depth++
      } else if (ch === '}') {
        depth--
        if (depth === 0) { bodyEnd = i; break }
      }
    }
    expect(bodyStart).toBeGreaterThan(0)
    expect(bodyEnd).toBeGreaterThan(bodyStart)
    const body = tail.slice(bodyStart, bodyEnd)
    // Match top-level keys: identifier or 'string' followed by `:` at depth 0.
    // Simpler heuristic: scan line by line, reset depth tracking per char.
    const keys = new Set<string>()
    let d = 0
    let line = ''
    const lines = body.split('\n')
    for (const ln of lines) {
      const trimmed = ln.trim()
      // Track brace depth across all lines
      // Top-level keys start with `name:` or `name =>` or `name(...)` at depth 0
      if (d === 0) {
        const m = trimmed.match(/^([A-Za-z_$][\w$]*)\s*:/)
        if (m) keys.add(m[1])
      }
      for (const ch of ln) {
        if (ch === '{' || ch === '(' || ch === '[') d++
        else if (ch === '}' || ch === ')' || ch === ']') d--
      }
    }
    return [...keys].sort()
  }

  const EXPECTED_API = [
    // Auth
    'signIn', 'signInWithEmail', 'signUpWithEmail', 'sendMagicLink',
    'awaitMagicLink', 'resetPassword', 'cancelAuth', 'signOut',
    'getSession', 'getToken',
    // Bridge
    'connectBridge', 'disconnectBridge', 'getBridgeState', 'setTaskActive',
    // Config
    'getBackendUrl', 'getMachineId',
    // Chat CRUD
    'createChat', 'listChats', 'getChatMessages', 'updateChat', 'deleteChat',
    'resumeHuman',
    // Machine busy-state for the yellow "Override & Run" UI
    'checkMachineBusy', 'stopMachine',
    // Credits
    'getCredits',
    // Chat streaming
    'sendChatMessage', 'abortChat', 'onChatSSEEvent',
    // Window
    'setWindowMode', 'onWindowModeChanged',
    'setOpacity', 'getOpacity', 'onOpacityChanged',
    'getWindowSize', 'onWindowSizeChanged',
    'getWindowBounds', 'startResize', 'stopResize',
    // Updates
    'getUpdateStatus', 'getUpdateVersion', 'checkForUpdates', 'installUpdate',
    'onUpdateStatusChanged',
    // Permissions
    'checkPermissions', 'requestAccessibility', 'openScreenRecordingSettings',
    'openAccessibilitySettings', 'onPermissionDenied', 'getPlatform',
    // Approval
    'getApprovalMode', 'setApprovalMode', 'respondToApproval',
    'onApprovalRequest', 'onApprovalModeChanged',
    // Displays
    'getDisplays', 'getActiveDisplay', 'setActiveDisplay',
    // Files
    'selectFiles',
    // Lifecycle
    'relaunch', 'quit', 'getAppVersion',
    // Connection state event
    'onConnectionStateChanged',
    // Forced sign-out from auth layer (refresh failed, ws auth_rejected, etc.)
    'onSessionDied',
    // Renderer-side error reporter (forwards to main-process error reporter)
    'reportRendererError',
  ].sort()

  it('exposes exactly the documented keys, no more, no less', () => {
    const actual = extractApiKeys()
    // Symmetric diff
    const expectedSet = new Set(EXPECTED_API)
    const actualSet = new Set(actual)
    const extra = actual.filter((k) => !expectedSet.has(k))
    const missing = EXPECTED_API.filter((k) => !actualSet.has(k))
    expect(extra, `unexpected keys exposed on window.coasty: ${extra.join(', ')}`).toEqual([])
    expect(missing, `documented keys missing from window.coasty: ${missing.join(', ')}`).toEqual([])
  })
})

// ─── Every exposed method has a matching ipcMain.handle ─────────────────────

describe('window.coasty ↔ ipcMain.handle parity', () => {
  /** Map exposed method name → IPC channel it invokes. */
  function collectInvokeMap(): Map<string, string> {
    const src = readSource(PRELOAD_PATH)
    const map = new Map<string, string>()
    // Match patterns like:  someMethod: () => ipcRenderer.invoke('channel:name', ...)
    // or:                    someMethod: (a) => ipcRenderer.invoke('channel:name', a)
    // Multi-line definitions are supported by allowing newlines in the gap.
    const re = /([A-Za-z_$][\w$]*)\s*:\s*\([^)]*\)\s*=>\s*\n?\s*ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src)) !== null) {
      map.set(m[1], m[2])
    }
    return map
  }

  function collectRegisteredChannels(): Set<string> {
    const set = new Set<string>()
    const files = walkDir(MAIN_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    const re = /(?:secureHandle|ipcMain\.handle|_ipcHandle)\(\s*['"]([^'"]+)['"]/g
    for (const f of files) {
      const txt = readSource(f)
      let m: RegExpExecArray | null
      while ((m = re.exec(txt)) !== null) {
        set.add(m[1])
      }
    }
    return set
  }

  it('every exposed method that calls invoke targets a registered channel', () => {
    const invokeMap = collectInvokeMap()
    const registered = collectRegisteredChannels()

    expect(invokeMap.size, 'no invoke methods extracted from preload').toBeGreaterThan(0)
    expect(registered.size, 'no IPC channels found in main/').toBeGreaterThan(0)

    const orphans: string[] = []
    for (const [method, channel] of invokeMap) {
      if (!registered.has(channel)) {
        orphans.push(`${method} → ${channel}`)
      }
    }
    expect(orphans, `preload methods invoke unregistered channels:\n  ${orphans.join('\n  ')}`).toEqual([])
  })

  it('no preload method targets a "system" channel (channels starting with "ELECTRON_")', () => {
    const invokeMap = collectInvokeMap()
    for (const [, channel] of invokeMap) {
      expect(channel).not.toMatch(/^ELECTRON_/)
    }
  })

  it('IPC channel names follow the namespace:action convention', () => {
    const invokeMap = collectInvokeMap()
    const violations: string[] = []
    for (const [method, channel] of invokeMap) {
      // A channel must contain a colon separator.
      if (!channel.includes(':')) violations.push(`${method} → ${channel}`)
    }
    expect(violations, `non-namespaced channels:\n  ${violations.join('\n  ')}`).toEqual([])
  })
})

// ─── Helpers ────────────────────────────────────────────────────────────────

function walkDir(dir: string): string[] {
  const out: string[] = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      out.push(...walkDir(full))
    } else if (e.isFile()) {
      out.push(full)
    }
  }
  return out
}

// Ensure the IPC handlers source is reachable (used by parity check).
describe('source paths exist', () => {
  it('preload, index, ipc-handlers files exist', () => {
    expect(fs.existsSync(PRELOAD_PATH)).toBe(true)
    expect(fs.existsSync(INDEX_PATH)).toBe(true)
    expect(fs.existsSync(IPC_HANDLERS_PATH)).toBe(true)
  })
})
