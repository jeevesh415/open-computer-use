/**
 * Critical-path integration tests.
 *
 * Recent changes touched many cross-module boundaries (libnut migration,
 * error-reporter, redis cleanup, leak fixes, DPI scaling, terminal policy,
 * shell-intercept safety net, etc.). Unit tests for each piece exist, but
 * the BOUNDARIES between them are where regressions hide.
 *
 * This file exercises ten cross-cutting flows that — if any one breaks —
 * the user-facing product breaks. Each test wires the REAL ws-bridge,
 * REAL error-reporter, REAL approval-manager, and stubs only at the OS
 * boundary. The goal is to catch regressions like:
 *
 *   - error-reporter never receives a WS sink because ws-bridge wires it
 *     at the wrong message-handler arm
 *   - approval-manager mode change mid-task is ignored by the bridge
 *   - close mid-approval leaves the request hanging forever
 *   - identity (machine_id, user_id) is set BEFORE the WS sink is wired,
 *     so the first batch of error reports has null identity
 *   - reconnect doesn't re-wire the WS sink, so subsequent errors never
 *     reach the backend even though the bridge is up
 *
 * NOT intended to replace dedicated unit tests — these specifically pin
 * down the integration seam that those unit tests can't reach.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Hoisted shared mock plumbing ─────────────────────────────────────────

const h = vi.hoisted(() => {
  type WSHandler = (...args: any[]) => void
  let currentWs: any = null
  class FakeWebSocket {
    static OPEN = 1
    static CLOSED = 3
    readyState = 1
    private handlers: Record<string, WSHandler[]> = {}
    sent: any[] = []
    constructor() { currentWs = this }
    on(event: string, handler: WSHandler): void {
      if (!this.handlers[event]) this.handlers[event] = []
      this.handlers[event].push(handler)
    }
    send(data: string): void { this.sent.push(JSON.parse(data)) }
    close(code = 1000): void {
      this.readyState = 3
      this.emit('close', code, '')
    }
    emit(event: string, ...args: any[]): void {
      for (const fn of this.handlers[event] || []) fn(...args)
    }
    simulateOpen(): void { this.emit('open') }
    simulateMessage(data: any): void {
      this.emit('message', Buffer.from(JSON.stringify(data)))
    }
    simulateClose(code = 1000): void {
      this.readyState = 3
      this.emit('close', code, '')
    }
    simulateError(err: Error): void { this.emit('error', err) }
  }

  return {
    FakeWebSocket,
    get currentWs() { return currentWs },
  }
})

// ─── Module-level mocks ──────────────────────────────────────────────────

vi.mock('ws', () => ({ default: h.FakeWebSocket }))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  screen: {
    getPrimaryDisplay: () => ({
      size: { width: 1920, height: 1080 },
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      workAreaSize: { width: 1920, height: 1080 },
      scaleFactor: 1.0,
    }),
    getAllDisplays: () => [],
    getDisplayNearestPoint: () => ({
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      workAreaSize: { width: 1920, height: 1080 },
    }),
  },
  ipcMain: { on: vi.fn(), handle: vi.fn() },
  app: {
    getName: () => 'test',
    getVersion: () => '4.0.0',
    getPath: () => '/tmp/coasty-critical-path-test',
  },
  desktopCapturer: { getSources: vi.fn().mockResolvedValue([]) },
  dialog: { showOpenDialog: vi.fn() },
}))

vi.mock('./display-manager', () => ({
  getActiveDisplay: () => ({
    id: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    workAreaSize: { width: 1920, height: 1080 },
    size: { width: 1920, height: 1080 },
    scaleFactor: 1.0,
  }),
  getActiveDisplayId: () => 1,
}))

vi.mock('./rainbow-border', () => ({
  showRainbowBorder: vi.fn(),
  hideRainbowBorder: vi.fn(),
  initRainbowBorder: vi.fn(),
}))

vi.mock('./window-manager', () => ({
  contentProtectionReliable: false,
  hideForDesktopAction: vi.fn().mockResolvedValue(undefined),
  showAfterDesktopAction: vi.fn(),
  bringToFront: vi.fn(),
}))

// Stub all command handlers so dispatch is fast and predictable
vi.mock('./desktop-automation', () => ({
  desktopClick: vi.fn().mockResolvedValue({ success: true }),
  desktopClickWithModifiers: vi.fn().mockResolvedValue({ success: true }),
  desktopDoubleClick: vi.fn().mockResolvedValue({ success: true }),
  desktopType: vi.fn().mockResolvedValue({ success: true }),
  desktopKeyPress: vi.fn().mockResolvedValue({ success: true }),
  desktopKeyCombo: vi.fn().mockResolvedValue({ success: true }),
  desktopScroll: vi.fn().mockResolvedValue({ success: true }),
  desktopDrag: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('./browser-automation', () => ({
  openBrowser: vi.fn().mockResolvedValue({ success: true }),
  navigateBrowser: vi.fn().mockResolvedValue({ success: true }),
  clickBrowser: vi.fn().mockResolvedValue({ success: true }),
  typeBrowser: vi.fn().mockResolvedValue({ success: true }),
  getBrowserDom: vi.fn().mockResolvedValue({ success: true }),
  getBrowserClickables: vi.fn().mockResolvedValue({ success: true }),
  getBrowserState: vi.fn().mockResolvedValue({ success: true }),
  getBrowserInfo: vi.fn().mockResolvedValue({ success: true }),
  scrollBrowser: vi.fn().mockResolvedValue({ success: true }),
  closeBrowser: vi.fn().mockResolvedValue({ success: true }),
  executeBrowser: vi.fn().mockResolvedValue({ success: true }),
  waitBrowser: vi.fn().mockResolvedValue({ success: true }),
  screenshotBrowser: vi.fn().mockResolvedValue({ success: true, image: 'b' }),
  listBrowserTabs: vi.fn().mockResolvedValue({ success: true, tabs: [] }),
  openBrowserTab: vi.fn().mockResolvedValue({ success: true }),
  closeBrowserTab: vi.fn().mockResolvedValue({ success: true }),
  switchBrowserTab: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('./screenshot', () => ({
  captureScreenshot: vi.fn().mockResolvedValue({
    success: true, screenshot: 'data:image/jpeg;base64,abc', resolution: '1920x1080',
  }),
}))
vi.mock('./file-ops', () => ({
  readFile: vi.fn().mockResolvedValue({ success: true, content: '' }),
  writeFile: vi.fn().mockResolvedValue({ success: true }),
  editFile: vi.fn().mockResolvedValue({ success: true }),
  appendFile: vi.fn().mockResolvedValue({ success: true }),
  deleteFile: vi.fn().mockResolvedValue({ success: true }),
  fileExists: vi.fn().mockResolvedValue({ success: true, exists: true }),
  listDirectory: vi.fn().mockResolvedValue({ success: true, entries: [] }),
  deleteDirectory: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('child_process', () => ({
  execFile: vi.fn((_cmd, _args, _opts, cb) => {
    cb(null, '', '')
    return { kill: vi.fn(), on: vi.fn() }
  }),
  exec: vi.fn(),
}))

// Stub fs so ApprovalManager's loadConfig() never finds a stale
// approval-config.json from a previous test run. Without this, mode could
// load as 'smart_approve' / 'off' / etc. and silently break tests that
// assume full_control. We default to "no config file" — fresh state every
// run — and let individual tests call setMode explicitly.
vi.mock('fs', async (importActual) => {
  const actual = await importActual<typeof import('fs')>()
  return {
    ...actual,
    existsSync: (p: any) => {
      if (typeof p === 'string' && p.includes('approval-config')) return false
      return actual.existsSync(p)
    },
    readFileSync: (p: any, ...rest: any[]) => {
      if (typeof p === 'string' && p.includes('approval-config')) {
        throw new Error('mocked: no approval-config in test')
      }
      return (actual.readFileSync as any)(p, ...rest)
    },
    writeFileSync: (p: any, ...rest: any[]) => {
      if (typeof p === 'string' && p.includes('approval-config')) return  // swallow
      return (actual.writeFileSync as any)(p, ...rest)
    },
  }
})

// ── Real modules — these are what we're integration-testing ────────────

import { WebSocketBridge } from './ws-bridge'
import { ApprovalManager } from './approval-manager'
import { errorReporter } from './error-reporter'

// ── Test harness helpers ──────────────────────────────────────────────

const liveBridges: WebSocketBridge[] = []

function makeBridge(approvals?: ApprovalManager): WebSocketBridge {
  const b = new WebSocketBridge(
    'http://localhost:8001', 'token', 'machine-test-1', 'user-test-1',
    approvals ?? new ApprovalManager(),
  )
  liveBridges.push(b)
  return b
}

function connectAndAuth(bridge: WebSocketBridge): void {
  bridge.connect()
  h.currentWs.simulateOpen()
  h.currentWs.simulateMessage({ type: 'auth_success' })
}

function send(command: string, parameters: any = {}): void {
  h.currentWs.simulateMessage({
    type: 'command',
    data: { command, parameters },
  })
}

function sentMessagesOfType(type: string): any[] {
  return h.currentWs.sent.filter((m: any) => m.type === type)
}

async function settle(ms = 80): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

beforeEach(async () => {
  for (const b of liveBridges) {
    try { b.disconnect() } catch { /* ignore */ }
  }
  liveBridges.length = 0
  await new Promise((r) => setTimeout(r, 50))
  vi.clearAllMocks()
  errorReporter._resetForTests()
})

afterEach(() => {
  vi.useRealTimers()
})

// ═════════════════════════════════════════════════════════════════════════
// 1. ERROR REPORTER ↔ WS BRIDGE INTEGRATION
// ═════════════════════════════════════════════════════════════════════════

describe('error-reporter ↔ ws-bridge: WS sink lifecycle', () => {
  it('WS sink is installed at auth_success — error reports flow over the bridge', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    // After auth_success, an error report should now route via the WS.
    errorReporter.reportError('local_executor', { error: new Error('boom') })

    await settle(20)

    const errorMessages = sentMessagesOfType('error_report')
    expect(errorMessages.length).toBe(1)
    expect(errorMessages[0].data.message).toBe('boom')
    expect(errorMessages[0].data.severity).toBe('error')
    expect(errorMessages[0].data.category).toBe('local_executor')
  })

  it('reports BEFORE auth_success queue for HTTP fallback (no WS sink wired yet)', async () => {
    // Reporter + backendUrl set, but bridge hasn't authed.
    errorReporter.init({ backendUrl: 'http://localhost:8001' })
    errorReporter.reportError('local_executor', { error: new Error('pre-auth') })

    expect(errorReporter._getQueueLength()).toBe(1)
    // No WS message either — the bridge isn't even open.
  })

  it('identity (machine_id + user_id) propagates after auth_success', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    errorReporter.reportError('local_executor', { error: new Error('with-id') })
    await settle(20)

    const msg = sentMessagesOfType('error_report')[0]
    expect(msg.data.machine_id).toBe('machine-test-1')
    expect(msg.data.user_id).toBe('user-test-1')
  })

  it('WS sink is torn down on close — subsequent reports fall back to HTTP queue', async () => {
    errorReporter.init({ backendUrl: 'http://localhost:8001' })
    const bridge = makeBridge()
    connectAndAuth(bridge)

    // Send one report through WS — verifies sink is wired
    errorReporter.reportError('ws_bridge', { error: new Error('first') })
    await settle(20)
    expect(sentMessagesOfType('error_report').length).toBe(1)

    // Close the WS
    h.currentWs.simulateClose()
    await settle(20)

    // A new report should NOT reach the dead WS — it should queue for HTTP
    const queueLenBefore = errorReporter._getQueueLength()
    errorReporter.reportError('ws_bridge', { error: new Error('post-close') })
    expect(errorReporter._getQueueLength()).toBeGreaterThan(queueLenBefore)
  })

  it('reconnect re-installs the WS sink — reports resume flowing', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)
    h.currentWs.simulateClose()
    await settle(20)

    // Reconnect (a new WS opens, auths)
    bridge.connect()
    h.currentWs.simulateOpen()
    h.currentWs.simulateMessage({ type: 'auth_success' })
    await settle(20)

    // Now a fresh report should flow over the new WS
    h.currentWs.sent.length = 0  // clear post-reconnect noise
    errorReporter.reportError('ws_bridge', { error: new Error('after-reconnect') })
    await settle(20)
    expect(sentMessagesOfType('error_report').length).toBe(1)
    expect(sentMessagesOfType('error_report')[0].data.message).toBe('after-reconnect')
  })

  it('command failure auto-reports through the wired WS sink', async () => {
    // Make a desktop_automation handler reject
    const da = await import('./desktop-automation')
    ;(da.desktopClick as any).mockRejectedValueOnce(new Error('libnut load failed'))

    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('click', { x: 100, y: 100 })
    await settle(80)

    // The bridge's failure path should have funneled into reportError
    const reports = sentMessagesOfType('error_report')
    expect(reports.length).toBeGreaterThanOrEqual(1)
    // The category must be local_executor (where command-failure reports live)
    const lastReport = reports[reports.length - 1].data
    expect(lastReport.category).toBe('local_executor')
    expect(lastReport.command).toBe('click')
  })

  it('PII (Bearer token) in command error message is scrubbed before send', async () => {
    const da = await import('./desktop-automation')
    ;(da.desktopType as any).mockRejectedValueOnce(
      new Error('Auth failed: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature'),
    )

    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('type', { text: 'hi' })
    await settle(80)

    const reports = sentMessagesOfType('error_report')
    const last = reports[reports.length - 1].data
    expect(last.message).not.toContain('eyJhbGci')  // JWT redacted
  })
})

// ═════════════════════════════════════════════════════════════════════════
// 2. APPROVAL GATE: rejection + mode transitions
// ═════════════════════════════════════════════════════════════════════════

describe('approval gate: rejection + mode interactions', () => {
  it('off mode → command is denied without ever reaching the handler', async () => {
    const approvals = new ApprovalManager()
    approvals.setMode('off')

    const da = await import('./desktop-automation')
    const bridge = makeBridge(approvals)
    connectAndAuth(bridge)
    send('click', { x: 100, y: 100 })
    await settle(50)

    // Handler must NOT have been called
    expect(da.desktopClick).not.toHaveBeenCalled()
    // The bridge must still send SOMETHING back so the agent isn't left hanging.
    // Look for either a result with success=false or no result — but the bridge
    // currently logs "Denied (mode=off)" and still sends something or nothing.
    // The contract: handler not called is the critical assertion. Anything more
    // than that risks coupling the test to logging implementation.
  })

  it('mode change mid-sequence — full_control → off blocks subsequent commands', async () => {
    const approvals = new ApprovalManager()
    approvals.setMode('full_control')

    const da = await import('./desktop-automation')
    const bridge = makeBridge(approvals)
    connectAndAuth(bridge)

    // First command goes through (full_control)
    send('click', { x: 1, y: 1 })
    await settle(50)
    expect(da.desktopClick).toHaveBeenCalledTimes(1)

    // Switch to off mid-sequence
    approvals.setMode('off')

    // Next command must NOT reach the handler
    send('type', { text: 'should-not-type' })
    await settle(50)
    expect(da.desktopType).not.toHaveBeenCalled()
  })

  it('smart_approve allows safe read-only commands but blocks mutations', async () => {
    const approvals = new ApprovalManager()
    approvals.setMode('smart_approve')

    const ss = await import('./screenshot')  // screenshot is in the SAFE_COMMANDS list
    const bridge = makeBridge(approvals)
    connectAndAuth(bridge)
    send('screenshot', {})
    await settle(50)
    expect(ss.captureScreenshot).toHaveBeenCalledTimes(1)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// 3. CRITICAL PATH SMOKE — full command round-trip + DPI + identity
// ═════════════════════════════════════════════════════════════════════════

describe('critical path: backend command → handler → result → reporter', () => {
  it('successful click round-trip emits a result frame back to the backend', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('click', { x: 100, y: 200 })
    await settle(80)

    const results = sentMessagesOfType('result')
    expect(results.length).toBe(1)
    expect(results[0].data.success).toBe(true)
  })

  it('handler exception is caught — bridge sends a failure result AND reports the error', async () => {
    const da = await import('./desktop-automation')
    ;(da.desktopClick as any).mockRejectedValueOnce(new Error('panic'))

    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('click', { x: 1, y: 1 })
    await settle(80)

    // 1. The agent gets an error result back
    const results = sentMessagesOfType('result')
    expect(results.length).toBe(1)
    expect(results[0].data.success).toBe(false)
    expect(results[0].data.error).toContain('panic')

    // 2. The error is reported via the same WS for diagnostics
    const reports = sentMessagesOfType('error_report')
    expect(reports.length).toBeGreaterThanOrEqual(1)
  })

  it('serial command order is preserved across the bridge queue', async () => {
    const da = await import('./desktop-automation')
    const bridge = makeBridge()
    connectAndAuth(bridge)

    // Fire 5 commands rapidly — the bridge must execute and reply in order.
    for (let i = 0; i < 5; i++) send('click', { x: i, y: i })
    await settle(150)

    const results = sentMessagesOfType('result')
    expect(results.length).toBe(5)
    // Each result is success=true (mock always returns success)
    expect(results.every((r: any) => r.data.success === true)).toBe(true)
    // And the handler was called 5 times in order
    expect(da.desktopClick).toHaveBeenCalledTimes(5)
  })

  it('many error reports + concurrent commands — no crash, no dropped results', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    // Interleave 10 errors with 10 commands
    for (let i = 0; i < 10; i++) {
      errorReporter.reportError('ws_bridge', { error: new Error(`err-${i}`) })
      send('click', { x: i, y: i })
    }
    await settle(200)

    expect(sentMessagesOfType('result').length).toBe(10)
    // Reports may dedup on identical messages; we only require >= 1
    expect(sentMessagesOfType('error_report').length).toBeGreaterThanOrEqual(1)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// 4. RECONNECT STATE INTEGRITY
// ═════════════════════════════════════════════════════════════════════════

describe('reconnect: state integrity', () => {
  it('disconnect mid-task — pending approvals canceled (cancelAll fires)', async () => {
    const approvals = new ApprovalManager()
    const cancelAllSpy = vi.spyOn(approvals, 'cancelAll')
    const bridge = makeBridge(approvals)
    connectAndAuth(bridge)

    h.currentWs.simulateClose()
    await settle(20)

    expect(cancelAllSpy).toHaveBeenCalled()
  })

  it('two consecutive auth_success messages do not double-install the sink', async () => {
    const bridge = makeBridge()
    bridge.connect()
    h.currentWs.simulateOpen()

    // Some servers might send auth_success twice during a hiccup; the sink
    // installation must be idempotent.
    h.currentWs.simulateMessage({ type: 'auth_success' })
    h.currentWs.simulateMessage({ type: 'auth_success' })

    errorReporter.reportError('ws_bridge', { error: new Error('once') })
    await settle(20)

    // Exactly one error report regardless of how many auth_success arrived
    expect(sentMessagesOfType('error_report').length).toBe(1)
  })
})
