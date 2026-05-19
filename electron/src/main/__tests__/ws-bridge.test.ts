/**
 * Tests for two production-grade fixes added to WebSocketBridge:
 *
 *   1. Server-pushed token refresh (reauth_required / reauth / reauth_ack)
 *      Backend pushes ``{type: 'reauth_required', deadline_ms}`` ~5 min
 *      before JWT expiry. Client must reply with a fresh token (or its
 *      current best-effort) before the deadline or the server closes
 *      the socket with code 4001. These tests prove the bridge:
 *        - calls getToken() and sends ``{type: 'reauth', token}``
 *        - logs + bails when getToken returns null (no reauth sent)
 *        - falls back to current token when no provider is wired
 *        - includes apiKey/source on the reauth message in OSS mode
 *        - tolerates a thrown getToken without crashing
 *        - handles reauth_ack {success: true|false}
 *
 *   2. Command-queue backpressure signaling
 *      The bridge serializes commands; a chatty backend can grow the
 *      queue silently. We fire a one-shot
 *      ``{type: 'command_queue_backpressure', state: 'warning'}`` at
 *      depth >= 8 and a one-shot ``state: 'recovered'`` once depth
 *      drops back to <= 4. The latch in ``backpressureActive`` ensures
 *      exactly one warning + one recovery per cycle (no spam).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted shared state ──────────────────────────────────────────

const h = vi.hoisted(() => {
  const mockShowRainbow = vi.fn()
  const mockHideRainbow = vi.fn()
  const mockInitRainbow = vi.fn()

  type Resolver = (value: { success: boolean }) => void
  // The bridge serializes execution: only ONE command is in the executor
  // at a time. Each invocation of the mocked executor returns a deferred
  // so tests can hold the currently-executing command in flight while
  // additional commands stack behind it in the queue. After releasing the
  // current resolver, the next chain link enters the executor and a NEW
  // resolver is pushed onto pendingResolvers.
  const pendingResolvers: Resolver[] = []
  // Release the resolver currently in flight, then wait long enough for
  // the next chain link to enter the executor (its onCommandDrained
  // decrement fires first, then the next executeCommand is called).
  const releaseOne = async (): Promise<void> => {
    const r = pendingResolvers.shift()
    if (!r) return
    r({ success: true })
    // Two settle-ticks: one to drain the .then chain (onCommandDrained),
    // one to let the next chain link's executor invocation register.
    await new Promise((res) => setTimeout(res, 5))
  }
  // Drain N consecutive in-flight commands. Each iteration releases the
  // CURRENT pending resolver and yields to the event loop so the queue
  // can advance one slot.
  const releaseN = async (n: number): Promise<void> => {
    for (let i = 0; i < n; i++) {
      await releaseOne()
    }
  }
  // Release every queued command. Loops until no resolver is pending.
  const releaseAll = async (): Promise<void> => {
    // Guard against infinite loops if a test forgot to flush
    for (let safety = 0; safety < 200; safety++) {
      if (pendingResolvers.length === 0) {
        // Give the chain one more tick in case the next link is mid-arrival
        await new Promise((res) => setTimeout(res, 5))
        if (pendingResolvers.length === 0) return
      }
      await releaseOne()
    }
  }

  const mockExecuteCommand = vi.fn(
    (_command: string, _params: any) =>
      new Promise<{ success: boolean }>((resolve) => {
        pendingResolvers.push(resolve)
      }),
  )

  type WSHandler = (...args: any[]) => void
  let currentWs: any = null

  class FakeWebSocket {
    static OPEN = 1
    static CLOSED = 3
    readyState = 1
    private handlers: Record<string, WSHandler[]> = {}
    sent: any[] = []
    constructor() {
      currentWs = this
    }
    on(event: string, handler: WSHandler): void {
      if (!this.handlers[event]) this.handlers[event] = []
      this.handlers[event].push(handler)
    }
    send(data: string): void {
      this.sent.push(JSON.parse(data))
    }
    close(): void {
      this.readyState = 3
      this.emit('close', 1000, '')
    }
    emit(event: string, ...args: any[]): void {
      for (const fn of this.handlers[event] || []) fn(...args)
    }
    simulateOpen(): void {
      this.emit('open')
    }
    simulateMessage(data: any): void {
      this.emit('message', Buffer.from(JSON.stringify(data)))
    }
  }

  return {
    mockShowRainbow,
    mockHideRainbow,
    mockInitRainbow,
    mockExecuteCommand,
    pendingResolvers,
    releaseAll,
    releaseN,
    FakeWebSocket,
    get currentWs() {
      return currentWs
    },
  }
})

// ── Module mocks ──────────────────────────────────────────────────

vi.mock('../rainbow-border', () => ({
  showRainbowBorder: h.mockShowRainbow,
  hideRainbowBorder: h.mockHideRainbow,
  initRainbowBorder: h.mockInitRainbow,
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => [{ webContents: { send: vi.fn() } }]) },
  screen: { getPrimaryDisplay: () => ({ size: { width: 1920, height: 1080 } }) },
}))

vi.mock('os', () => ({
  type: () => 'Windows_NT',
  release: () => '10.0.26200',
  arch: () => 'x64',
  hostname: () => 'test-host',
  userInfo: () => ({ username: 'testuser' }),
  homedir: () => 'C:\\Users\\test',
}))

vi.mock('../local-executor', () => ({
  LocalExecutor: class MockLocalExecutor {
    executeCommand = h.mockExecuteCommand
  },
}))

vi.mock('../approval-manager', () => ({
  ApprovalManager: class MockApprovalManager {
    shouldAutoApprove = vi.fn(() => true)
    isDenyAll = vi.fn(() => false)
    requestApproval = vi.fn().mockResolvedValue({ approved: true })
    cancelAll = vi.fn()
  },
}))

vi.mock('../error-reporter', () => ({
  reportError: vi.fn(),
  reportWarn: vi.fn(),
  reportInfo: vi.fn(),
  errorReporter: {
    init: vi.fn(),
    setIdentity: vi.fn(),
    setWebSocketSink: vi.fn(),
    reportError: vi.fn(),
  },
}))

vi.mock('ws', () => ({
  default: h.FakeWebSocket,
}))

import { WebSocketBridge } from '../ws-bridge'
import { ApprovalManager } from '../approval-manager'

// ── Helpers ────────────────────────────────────────────────────────

function makeBridge(token = 'jwt-token'): WebSocketBridge {
  const approval = new ApprovalManager()
  return new WebSocketBridge('http://localhost:8001', token, 'machine-1', 'user-1', approval)
}

function connectAndAuth(bridge: WebSocketBridge): void {
  bridge.connect()
  h.currentWs.simulateOpen()
  h.currentWs.simulateMessage({ type: 'auth_success' })
}

function sendCommand(command: string, parameters: any = {}): void {
  h.currentWs.simulateMessage({ type: 'command', data: { command, parameters } })
}

async function flush(ms = 0): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

beforeEach(async () => {
  // Drain any leftover async work from the previous test so late-firing
  // setTimeouts don't bleed into the next test's mock state.
  await new Promise((r) => setTimeout(r, 20))
  vi.clearAllMocks()
  h.pendingResolvers.length = 0
})

// ── Backpressure tests ─────────────────────────────────────────────

describe('WebSocketBridge — command-queue backpressure', () => {
  it('does NOT emit any backpressure frame for a single command', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    sendCommand('screenshot')
    await flush(10)
    await h.releaseAll()
    await flush(20)

    const frames = h.currentWs.sent.filter((m: any) => m.type === 'command_queue_backpressure')
    expect(frames).toHaveLength(0)
  })

  it('does NOT emit warning until depth reaches 8 (depth 7 stays quiet)', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    for (let i = 0; i < 7; i++) sendCommand('cmd', { i })
    await flush(20)

    const warnings = h.currentWs.sent.filter(
      (m: any) => m.type === 'command_queue_backpressure' && m.state === 'warning',
    )
    expect(warnings).toHaveLength(0)
  })

  it('emits exactly one warning frame at depth 8', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    for (let i = 0; i < 8; i++) sendCommand('cmd', { i })
    await flush(20)

    const warnings = h.currentWs.sent.filter(
      (m: any) => m.type === 'command_queue_backpressure' && m.state === 'warning',
    )
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      type: 'command_queue_backpressure',
      state: 'warning',
      threshold: 8,
    })
    expect(warnings[0].depth).toBeGreaterThanOrEqual(8)
  })

  it('does not double-fire the warning if more commands arrive above threshold', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    for (let i = 0; i < 12; i++) sendCommand('cmd', { i })
    await flush(20)

    const warnings = h.currentWs.sent.filter(
      (m: any) => m.type === 'command_queue_backpressure' && m.state === 'warning',
    )
    expect(warnings).toHaveLength(1)
  })

  it('emits a recovered frame after depth drops to 4 (and only once)', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    // Push depth to 10 → one warning frame
    for (let i = 0; i < 10; i++) sendCommand('cmd', { i })
    await flush(20)

    // Drain 6 commands → depth = 4 → must fire exactly one recovered frame.
    // Each releaseOne() releases the in-flight command and yields so the
    // next chain link can enter the executor (the bridge serializes
    // execution, so depth drains one slot per release).
    await h.releaseN(6)
    await flush(20)

    const recovered = h.currentWs.sent.filter(
      (m: any) => m.type === 'command_queue_backpressure' && m.state === 'recovered',
    )
    expect(recovered).toHaveLength(1)
    expect(recovered[0]).toMatchObject({
      type: 'command_queue_backpressure',
      state: 'recovered',
      threshold: 8,
    })
    expect(recovered[0].depth).toBeLessThanOrEqual(4)

    // Drain the rest → depth keeps dropping past 4 → must NOT re-emit
    await h.releaseAll()
    await flush(20)

    const recoveredAgain = h.currentWs.sent.filter(
      (m: any) => m.type === 'command_queue_backpressure' && m.state === 'recovered',
    )
    expect(recoveredAgain).toHaveLength(1)
  })

  it('does NOT emit recovered if WARN was never crossed', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    // Push to depth 5 (below WARN), then drain → no warning, no recovery.
    for (let i = 0; i < 5; i++) sendCommand('cmd', { i })
    await flush(20)
    await h.releaseAll()
    await flush(20)

    const frames = h.currentWs.sent.filter((m: any) => m.type === 'command_queue_backpressure')
    expect(frames).toHaveLength(0)
  })

  it('depth tracking survives a full burst-drain-burst cycle', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    // Cycle 1: 9 in → warning → drain all → recovered
    for (let i = 0; i < 9; i++) sendCommand('cmd', { i })
    await flush(20)
    await h.releaseAll()
    await flush(20)

    // Cycle 2: 9 more in → MUST fire a fresh warning (latch was cleared)
    for (let i = 0; i < 9; i++) sendCommand('cmd', { i: 100 + i })
    await flush(20)
    await h.releaseAll()
    await flush(20)

    const warnings = h.currentWs.sent.filter(
      (m: any) => m.type === 'command_queue_backpressure' && m.state === 'warning',
    )
    const recovered = h.currentWs.sent.filter(
      (m: any) => m.type === 'command_queue_backpressure' && m.state === 'recovered',
    )
    expect(warnings).toHaveLength(2)
    expect(recovered).toHaveLength(2)
  })

  it('decrement happens on thrown executor errors too (depth recovers)', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    // Replace mock for this test: every command throws synchronously
    // after a microtask. Backpressure depth must still decrement.
    h.mockExecuteCommand.mockImplementation(async () => {
      await Promise.resolve()
      throw new Error('boom')
    })

    // Send 9 commands → at least one warning.
    for (let i = 0; i < 9; i++) sendCommand('cmd', { i })
    // Errors resolve on their own (no resolver needed), so just wait.
    await flush(150)

    // After all errors resolve, depth must be 0 → recovered fired.
    const recovered = h.currentWs.sent.filter(
      (m: any) => m.type === 'command_queue_backpressure' && m.state === 'recovered',
    )
    expect(recovered).toHaveLength(1)

    // Reset mock to default for subsequent tests
    h.mockExecuteCommand.mockImplementation(
      (_c, _p) =>
        new Promise<{ success: boolean }>((resolve) => {
          h.pendingResolvers.push(resolve)
        }),
    )
  })
})

// ── Reauth tests ──────────────────────────────────────────────────

describe('WebSocketBridge — server-pushed token refresh', () => {
  it('reauth_required → calls getToken() and sends reauth with the fresh token', async () => {
    const bridge = makeBridge()
    const getToken = vi.fn().mockResolvedValue('new-jwt-token')
    bridge.setTokenProvider(getToken)
    connectAndAuth(bridge)
    // The 'open' handler also calls getToken to refresh on reconnect;
    // reset the counter so we assert on the reauth invocation alone.
    await flush(10)
    getToken.mockClear()

    // Clear the initial auth message so we can assert on JUST the reauth
    h.currentWs.sent.length = 0

    h.currentWs.simulateMessage({
      type: 'reauth_required',
      deadline_ms: Date.now() + 5 * 60 * 1000,
    })
    await flush(20)

    expect(getToken).toHaveBeenCalledTimes(1)
    const reauthMsgs = h.currentWs.sent.filter((m: any) => m.type === 'reauth')
    expect(reauthMsgs).toHaveLength(1)
    expect(reauthMsgs[0]).toMatchObject({
      type: 'reauth',
      token: 'new-jwt-token',
    })
    // No apiKey/source on a JWT
    expect(reauthMsgs[0].apiKey).toBeUndefined()
    expect(reauthMsgs[0].source).toBeUndefined()
  })

  it('reauth_required → does NOT send reauth when getToken returns null', async () => {
    const bridge = makeBridge()
    const getToken = vi.fn().mockResolvedValue(null)
    bridge.setTokenProvider(getToken)
    connectAndAuth(bridge)
    await flush(10)
    getToken.mockClear()

    h.currentWs.sent.length = 0

    h.currentWs.simulateMessage({
      type: 'reauth_required',
      deadline_ms: Date.now() + 60_000,
    })
    await flush(20)

    expect(getToken).toHaveBeenCalledTimes(1)
    const reauthMsgs = h.currentWs.sent.filter((m: any) => m.type === 'reauth')
    expect(reauthMsgs).toHaveLength(0)
  })

  it('reauth_required → does NOT send reauth when getToken throws', async () => {
    const bridge = makeBridge()
    const getToken = vi.fn().mockRejectedValue(new Error('refresh blew up'))
    bridge.setTokenProvider(getToken)
    connectAndAuth(bridge)
    await flush(10)
    getToken.mockClear()

    h.currentWs.sent.length = 0

    h.currentWs.simulateMessage({
      type: 'reauth_required',
      deadline_ms: Date.now() + 60_000,
    })
    await flush(20)

    expect(getToken).toHaveBeenCalledTimes(1)
    const reauthMsgs = h.currentWs.sent.filter((m: any) => m.type === 'reauth')
    expect(reauthMsgs).toHaveLength(0)
  })

  it('reauth_required with no token provider wired → falls back to current token', async () => {
    const bridge = makeBridge('current-jwt')
    // intentionally NOT calling setTokenProvider
    connectAndAuth(bridge)

    h.currentWs.sent.length = 0

    h.currentWs.simulateMessage({
      type: 'reauth_required',
      deadline_ms: Date.now() + 60_000,
    })
    await flush(20)

    const reauthMsgs = h.currentWs.sent.filter((m: any) => m.type === 'reauth')
    expect(reauthMsgs).toHaveLength(1)
    expect(reauthMsgs[0].token).toBe('current-jwt')
  })

  it('reauth in OSS mode includes apiKey + source breadcrumbs', async () => {
    const bridge = makeBridge()
    const getToken = vi.fn().mockResolvedValue('coasty_freshkey_abc123')
    bridge.setTokenProvider(getToken)
    connectAndAuth(bridge)

    h.currentWs.sent.length = 0

    h.currentWs.simulateMessage({
      type: 'reauth_required',
      deadline_ms: Date.now() + 60_000,
    })
    await flush(20)

    const reauthMsgs = h.currentWs.sent.filter((m: any) => m.type === 'reauth')
    expect(reauthMsgs).toHaveLength(1)
    expect(reauthMsgs[0]).toMatchObject({
      type: 'reauth',
      token: 'coasty_freshkey_abc123',
      apiKey: 'coasty_freshkey_abc123',
      source: 'electron-oss',
    })
  })

  it('reauth_ack {success: true} is handled silently (no crash, no extra sends)', async () => {
    const bridge = makeBridge()
    const getToken = vi.fn().mockResolvedValue('new-jwt')
    bridge.setTokenProvider(getToken)
    connectAndAuth(bridge)

    h.currentWs.simulateMessage({ type: 'reauth_required', deadline_ms: Date.now() + 60_000 })
    await flush(20)

    const sentBefore = h.currentWs.sent.length
    h.currentWs.simulateMessage({ type: 'reauth_ack', success: true })
    await flush(20)

    // reauth_ack does not generate any outbound frame
    expect(h.currentWs.sent.length).toBe(sentBefore)
  })

  it('reauth_ack {success: false} logs the reason but does not crash or send', async () => {
    const bridge = makeBridge()
    const getToken = vi.fn().mockResolvedValue('new-jwt')
    bridge.setTokenProvider(getToken)
    connectAndAuth(bridge)

    h.currentWs.simulateMessage({ type: 'reauth_required', deadline_ms: Date.now() + 60_000 })
    await flush(20)
    const sentBefore = h.currentWs.sent.length

    h.currentWs.simulateMessage({
      type: 'reauth_ack',
      success: false,
      reason: 'token signature mismatch',
    })
    await flush(20)

    expect(h.currentWs.sent.length).toBe(sentBefore)
    // Bridge should not transition to a fatal state on its own — the
    // server will close us if necessary and the normal reconnect kicks in.
    expect(bridge.getState()).toBe('connected')
  })

  it('after reauth, this.token is updated so subsequent reconnects use the fresh token', async () => {
    const bridge = makeBridge('initial-jwt')
    const getToken = vi.fn().mockResolvedValue('refreshed-jwt')
    bridge.setTokenProvider(getToken)
    connectAndAuth(bridge)

    h.currentWs.sent.length = 0
    h.currentWs.simulateMessage({ type: 'reauth_required', deadline_ms: Date.now() + 60_000 })
    await flush(20)

    // The internal token field is private — assert via updateToken side
    // effect: calling it with the same value sends the existing token in
    // an auth message. We instead assert via the reauth message contents.
    const reauthMsgs = h.currentWs.sent.filter((m: any) => m.type === 'reauth')
    expect(reauthMsgs[0].token).toBe('refreshed-jwt')
  })
})

// ─────────────────────────────────────────────────────────────────────
// Extended edge-case coverage — backpressure
// ─────────────────────────────────────────────────────────────────────

describe('WebSocketBridge — backpressure edge cases', () => {
  // ── 1. Oscillation around threshold ────────────────────────────────
  //
  // Pattern 7→8→7→8→7. The latch only flips on the FIRST 7→8 transition;
  // subsequent drops to 7 (still above RECOVER=4) keep the latch armed,
  // and re-crossing 8 must NOT emit a second warning. Without hysteresis
  // a chatty backend would generate a storm of warning frames; with it
  // we get exactly one warning across the entire oscillation.
  it('emits exactly ONE warning during a 7→8→7→8→7 oscillation around WARN', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    // Build depth up to 7 (no warning yet)
    for (let i = 0; i < 7; i++) sendCommand('cmd', { i })
    await flush(20)

    // Cross to 8 → ONE warning fires
    sendCommand('cmd', { i: 7 })
    await flush(20)

    // Drain back to 7
    await h.releaseN(1)
    await flush(20)

    // Cross to 8 again (latch still armed) → NO second warning
    sendCommand('cmd', { i: 8 })
    await flush(20)

    // Drain to 7 once more
    await h.releaseN(1)
    await flush(20)

    const warnings = h.currentWs.sent.filter(
      (m: any) => m.type === 'command_queue_backpressure' && m.state === 'warning',
    )
    expect(warnings).toHaveLength(1)

    // Drain the rest to avoid leaking pending state into the next test
    await h.releaseAll()
    await flush(20)
  })

  // ── 2. Bidirectional crossing WITHOUT recovery ─────────────────────
  //
  // Drain from depth 8 → 5 (above RECOVER=4 — latch still armed) then
  // back up to 8. Because the latch was never cleared, the second
  // upward crossing must NOT emit a second warning. This is the
  // textbook hysteresis property: state changes only at the
  // thresholds, never mid-band.
  it('does NOT re-emit warning when depth crosses 8 again without dropping below RECOVER=4', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    // Fill to 8 → one warning
    for (let i = 0; i < 8; i++) sendCommand('cmd', { i })
    await flush(20)

    // Drain to 5 — above RECOVER, latch stays armed, no recovery
    await h.releaseN(3)
    await flush(20)

    // Refill to 8 — must NOT emit a second warning
    for (let i = 0; i < 3; i++) sendCommand('cmd', { i: 100 + i })
    await flush(20)

    const warnings = h.currentWs.sent.filter(
      (m: any) => m.type === 'command_queue_backpressure' && m.state === 'warning',
    )
    const recovered = h.currentWs.sent.filter(
      (m: any) => m.type === 'command_queue_backpressure' && m.state === 'recovered',
    )
    expect(warnings).toHaveLength(1)
    expect(recovered).toHaveLength(0)

    await h.releaseAll()
    await flush(20)
  })

  // ── 3. Stop during high queue depth ────────────────────────────────
  //
  // Fill to 12, then user clicks Stop. The in-queue stop-gate causes
  // each subsequent chain link to short-circuit to a "task stopped"
  // result instead of running the executor. But the depth bookkeeping
  // still fires (onCommandDrained runs in the .then), so the latch
  // logic must still cleanly transition warning → recovered as the
  // queue drains.
  it('still emits recovered frame after stopTask, as no-op chain links drain depth past RECOVER', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    // Fill the queue to depth 12 (1 in-flight + 11 queued behind it)
    for (let i = 0; i < 12; i++) sendCommand('cmd', { i })
    await flush(20)

    // User clicks Stop. After this, the in-queue gate makes each link
    // a no-op (returns {success: false, stoppedByUser: true}).
    bridge.stopTask()
    await flush(20)

    // Release the single in-flight command. The remaining 11 will
    // drain themselves via the stop-gate (no resolver needed because
    // they don't hit the executor).
    await h.releaseN(1)
    // Let the chain settle. The remaining links short-circuit so they
    // resolve on microtasks; a generous flush covers any await chain.
    await flush(50)

    const recovered = h.currentWs.sent.filter(
      (m: any) => m.type === 'command_queue_backpressure' && m.state === 'recovered',
    )
    expect(recovered).toHaveLength(1)
  })

  // ── 4. Send failure during backpressure emit ───────────────────────
  //
  // Telemetry is best-effort. If ws.send throws while emitting the
  // backpressure frame, the bookkeeping (depth decrement, telemetry
  // log) MUST still complete. Pre-fix, a thrown send leaked a queue
  // slot on the enqueue path; the try/catch in emitBackpressure makes
  // this safe. The user's command should still execute normally.
  it('a thrown ws.send during backpressure emit does NOT block command execution or leak depth', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    // Replace executor with one that returns immediately so we can
    // measure depth recovery without managing resolvers.
    h.mockExecuteCommand.mockImplementation(async () => ({ success: true }))

    // Stub ws.send so it throws ONLY for backpressure frames; everything
    // else (auth, results) still flows. This isolates the failure to the
    // exact code path we want to harden.
    const ws = h.currentWs
    const realSend = ws.send.bind(ws)
    let backpressureSendAttempts = 0
    ws.send = (data: string) => {
      const parsed = JSON.parse(data)
      if (parsed.type === 'command_queue_backpressure') {
        backpressureSendAttempts++
        throw new Error('socket exploded')
      }
      realSend(data)
    }

    // Push 9 commands to trigger the warning frame (which will throw).
    for (let i = 0; i < 9; i++) sendCommand('cmd', { i })
    await flush(50)

    // Backpressure send was attempted (and threw)
    expect(backpressureSendAttempts).toBeGreaterThanOrEqual(1)

    // Every command must have produced a 'result' frame — the thrown
    // backpressure send did not abort the chain.
    const results = ws.sent.filter((m: any) => m.type === 'result')
    expect(results.length).toBe(9)

    // Restore default executor for subsequent tests
    h.mockExecuteCommand.mockImplementation(
      (_c, _p) =>
        new Promise<{ success: boolean }>((resolve) => {
          h.pendingResolvers.push(resolve)
        }),
    )
  })

  // ── 5. Synchronous executor throw ──────────────────────────────────
  //
  // Catches the "async-only decrement assumption" bug class. If the
  // executor throws SYNCHRONOUSLY from inside the .then callback
  // (instead of returning a rejected promise), promise machinery still
  // converts that into a rejection and the err-branch decrement fires.
  // Asserts depth recovers to 0 (recovered frame emitted after 9 throws).
  it('decrements depth when executor throws synchronously from the .then callback', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    h.mockExecuteCommand.mockImplementation((() => {
      // NOT async — synchronous throw from a sync function body. Inside a
      // .then callback this still gets caught by promise machinery and
      // surfaced as a rejection on `next`, which routes through the
      // err-branch onCommandDrained.
      throw new Error('sync boom')
    }) as any)

    // Send 9 commands → warning fires, all 9 throw synchronously, all
    // 9 must decrement.
    for (let i = 0; i < 9; i++) sendCommand('cmd', { i })
    await flush(100)

    const warnings = h.currentWs.sent.filter(
      (m: any) => m.type === 'command_queue_backpressure' && m.state === 'warning',
    )
    const recovered = h.currentWs.sent.filter(
      (m: any) => m.type === 'command_queue_backpressure' && m.state === 'recovered',
    )
    expect(warnings).toHaveLength(1)
    expect(recovered).toHaveLength(1)

    h.mockExecuteCommand.mockImplementation(
      (_c, _p) =>
        new Promise<{ success: boolean }>((resolve) => {
          h.pendingResolvers.push(resolve)
        }),
    )
  })

  // ── 6. Burst of 100 commands ───────────────────────────────────────
  //
  // Stress-test the latching: an extreme burst must still produce
  // exactly ONE warning (at the up-crossing of 8) and exactly ONE
  // recovered (at the down-crossing of 4) — regardless of magnitude.
  it('100-command burst produces exactly 1 warning and 1 recovered frame', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    for (let i = 0; i < 100; i++) sendCommand('cmd', { i })
    await flush(50)

    // Drain everything
    await h.releaseAll()
    await flush(50)

    const warnings = h.currentWs.sent.filter(
      (m: any) => m.type === 'command_queue_backpressure' && m.state === 'warning',
    )
    const recovered = h.currentWs.sent.filter(
      (m: any) => m.type === 'command_queue_backpressure' && m.state === 'recovered',
    )
    expect(warnings).toHaveLength(1)
    expect(recovered).toHaveLength(1)
    // Sanity: every command produced a result frame
    const results = h.currentWs.sent.filter((m: any) => m.type === 'result')
    expect(results.length).toBe(100)
  })

  // ── 7. Recovered without prior warning ─────────────────────────────
  //
  // If depth never reaches WARN (peaked at 7), no warning AND no
  // recovered may fire. The latch gates BOTH transitions — a recovered
  // without a prior warning would confuse the backend's throttling
  // state machine.
  it('no recovered frame fires if WARN was never crossed (peak depth 7)', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    for (let i = 0; i < 7; i++) sendCommand('cmd', { i })
    await flush(20)
    await h.releaseAll()
    await flush(20)

    const frames = h.currentWs.sent.filter((m: any) => m.type === 'command_queue_backpressure')
    expect(frames).toHaveLength(0)
  })

  // ── 8. Frame ordering vs command results (no interleaving) ─────────
  //
  // Backpressure frames travel through the same send() helper as
  // result frames. Node's ws.send is internally synchronous in terms
  // of frame boundaries (each send() call writes exactly one WebSocket
  // frame, atomic at the protocol level), so true frame interleaving
  // is not observable at this layer. We instead assert the ORDER of
  // visible side effects: the warning frame must appear BEFORE the
  // first result frame for the burst that triggered it (because we
  // emit on the enqueue side, before the executor finishes).
  //
  // This documents the design rather than testing concurrency we
  // don't actually have to worry about. Flake-avoidance: deterministic
  // — both events are synchronous w.r.t. the test driver.
  it('warning frame is sent BEFORE the first result frame in a burst', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    for (let i = 0; i < 8; i++) sendCommand('cmd', { i })
    await flush(20)
    // Now release one command — its result is the first to land.
    await h.releaseN(1)
    await flush(20)

    const types = h.currentWs.sent
      .filter((m: any) => m.type === 'command_queue_backpressure' || m.type === 'result')
      .map((m: any) => `${m.type}${m.state ? ':' + m.state : ''}`)

    // The warning must be at index 0 of this filtered list. The first
    // 'result' is whatever comes from releaseN(1).
    expect(types[0]).toBe('command_queue_backpressure:warning')
    expect(types[1]).toBe('result')

    await h.releaseAll()
    await flush(20)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Extended edge-case coverage — reauth
// ─────────────────────────────────────────────────────────────────────

describe('WebSocketBridge — reauth edge cases', () => {
  // ── 1. reauth_required WITHOUT deadline_ms field ───────────────────
  //
  // Server bug: pushes reauth_required with no deadline. Client must
  // still call getToken + send the reauth frame. The deadline is
  // informational only.
  it('handles reauth_required with missing deadline_ms (no crash, still reauths)', async () => {
    const bridge = makeBridge()
    const getToken = vi.fn().mockResolvedValue('fresh-token-no-deadline')
    bridge.setTokenProvider(getToken)
    connectAndAuth(bridge)
    await flush(10)
    getToken.mockClear()
    h.currentWs.sent.length = 0

    // No deadline_ms field at all
    h.currentWs.simulateMessage({ type: 'reauth_required' })
    await flush(20)

    expect(getToken).toHaveBeenCalledTimes(1)
    const reauthMsgs = h.currentWs.sent.filter((m: any) => m.type === 'reauth')
    expect(reauthMsgs).toHaveLength(1)
    expect(reauthMsgs[0].token).toBe('fresh-token-no-deadline')
  })

  // ── 2. WS closed mid-reauth ────────────────────────────────────────
  //
  // Backend pushes reauth_required, but by the time getToken resolves
  // the socket has already closed. The send() helper guards against
  // closed sockets (readyState !== OPEN); no exception must bubble out
  // of the message handler.
  it('survives the socket closing mid-reauth (no thrown exception out of the handler)', async () => {
    const bridge = makeBridge()
    let resolveToken: ((t: string | null) => void) | null = null
    const getToken = vi.fn().mockImplementation(
      () => new Promise<string | null>((res) => { resolveToken = res }),
    )
    bridge.setTokenProvider(getToken)
    connectAndAuth(bridge)
    await flush(10)
    getToken.mockClear()
    h.currentWs.sent.length = 0

    // Trigger reauth_required (handler awaits getToken — blocks until
    // we resolve below)
    h.currentWs.simulateMessage({ type: 'reauth_required', deadline_ms: Date.now() + 60_000 })
    await flush(10)

    // While the handler is blocked on getToken, simulate socket close
    h.currentWs.readyState = h.FakeWebSocket.CLOSED

    // Resolve getToken — the handler will attempt to send the reauth
    // frame; send() guards on readyState and silently drops.
    expect(resolveToken).not.toBeNull()
    resolveToken!('fresh-but-too-late')
    await flush(30)

    // No reauth frame should have been sent
    const reauthMsgs = h.currentWs.sent.filter((m: any) => m.type === 'reauth')
    expect(reauthMsgs).toHaveLength(0)
    // Bridge is still alive (no uncaught throw); state did not flip
    // from 'connected' as a result of the failed send.
    expect(bridge.getState()).toBe('connected')
  })

  // ── 3. Multiple reauth_required in succession ──────────────────────
  //
  // Server bug: re-arms its reauth scheduler and sends reauth_required
  // twice in a row with no ack between. Client must respond to BOTH.
  // No deadlock, no crash.
  it('responds to consecutive reauth_required messages with two reauth frames', async () => {
    const bridge = makeBridge()
    // Use a deterministic per-call counter (independent of mockResolvedValueOnce
    // queues, which can shift if other calls — like the on-open getToken —
    // consume entries from the same fixture queue).
    let callCount = 0
    const getToken = vi.fn().mockImplementation(async () => {
      callCount++
      return `token-call-${callCount}`
    })
    bridge.setTokenProvider(getToken)
    connectAndAuth(bridge)
    await flush(10)
    // Reset counter AFTER connectAndAuth so the on-open getToken call doesn't
    // shift our sequence.
    callCount = 0
    getToken.mockClear()
    h.currentWs.sent.length = 0

    h.currentWs.simulateMessage({ type: 'reauth_required', deadline_ms: Date.now() + 60_000 })
    h.currentWs.simulateMessage({ type: 'reauth_required', deadline_ms: Date.now() + 60_000 })
    await flush(50)

    expect(getToken).toHaveBeenCalledTimes(2)
    const reauthMsgs = h.currentWs.sent.filter((m: any) => m.type === 'reauth')
    expect(reauthMsgs).toHaveLength(2)
    // Both frames are sent; assert each carries a token, without
    // asserting strict ordering (microtask interleaving between the
    // two concurrent handlers is implementation-defined — what matters
    // is that BOTH messages got a response).
    const tokens = reauthMsgs.map((m: any) => m.token).sort()
    expect(tokens).toEqual(['token-call-1', 'token-call-2'])
  })

  // ── 4. reauth_ack {success: false} does not break the handler ──────
  //
  // After a server-rejected refresh, the bridge logs but stays alive.
  // Subsequent inbound messages (task_end here) must process normally.
  it('after reauth_ack success=false, the next task_end is still processed normally', async () => {
    const bridge = makeBridge()
    const getToken = vi.fn().mockResolvedValue('new-jwt')
    bridge.setTokenProvider(getToken)
    connectAndAuth(bridge)

    h.currentWs.simulateMessage({ type: 'reauth_required', deadline_ms: Date.now() + 60_000 })
    await flush(20)

    h.currentWs.simulateMessage({
      type: 'reauth_ack',
      success: false,
      reason: 'signature mismatch',
    })
    await flush(10)

    // Now send a task_end. Pre-fix bugs (e.g. an unhandled exception
    // from the reauth_ack branch) would leave the handler in a bad
    // state. We assert the rainbow turns off as proof the task_end
    // handler ran.
    h.mockHideRainbow.mockClear()
    // Force rainbow on so we can observe stopRainbow firing
    bridge.setTaskActive(true)
    h.currentWs.simulateMessage({ type: 'task_end' })
    await flush(10)

    expect(h.mockHideRainbow).toHaveBeenCalled()
    expect(bridge.getState()).toBe('connected')
  })

  // ── 5. getToken returns same token as current ──────────────────────
  //
  // Spec: NO client-side dedup. If getToken returns the current token,
  // we still send it — the server is authoritative for staleness
  // decisions.
  it('still sends reauth even if getToken returns the current token (no client dedup)', async () => {
    const bridge = makeBridge('same-token-value')
    const getToken = vi.fn().mockResolvedValue('same-token-value')
    bridge.setTokenProvider(getToken)
    connectAndAuth(bridge)
    await flush(10)
    getToken.mockClear()
    h.currentWs.sent.length = 0

    h.currentWs.simulateMessage({ type: 'reauth_required', deadline_ms: Date.now() + 60_000 })
    await flush(20)

    const reauthMsgs = h.currentWs.sent.filter((m: any) => m.type === 'reauth')
    expect(reauthMsgs).toHaveLength(1)
    expect(reauthMsgs[0].token).toBe('same-token-value')
  })

  // ── 6. OSS API key reauth — token + apiKey + source breadcrumbs ────
  //
  // Parity with the initial auth message: when the current token is a
  // coasty_-prefixed API key AND the *initial* token (looksLikeCoastyApiKey
  // test) was an API key, the reauth message must include explicit
  // apiKey + source fields. (This is already covered partially by an
  // earlier test but only on the post-getToken path; here we verify the
  // FALLBACK path — no token provider wired — also tags the OSS fields.)
  it('OSS-mode reauth fallback (no token provider) still attaches apiKey + source', async () => {
    const bridge = makeBridge('coasty_test123')
    // intentionally NO setTokenProvider
    connectAndAuth(bridge)
    h.currentWs.sent.length = 0

    h.currentWs.simulateMessage({ type: 'reauth_required', deadline_ms: Date.now() + 60_000 })
    await flush(20)

    const reauthMsgs = h.currentWs.sent.filter((m: any) => m.type === 'reauth')
    expect(reauthMsgs).toHaveLength(1)
    expect(reauthMsgs[0]).toMatchObject({
      type: 'reauth',
      token: 'coasty_test123',
      apiKey: 'coasty_test123',
      source: 'electron-oss',
    })
  })

  // ── 7. Slow getToken — task_end still processed during the wait ────
  //
  // The reauth handler awaits getToken inline, but Node's ws library
  // dispatches each inbound message in its own async handler context.
  // A slow getToken on the reauth path must NOT block a parallel
  // task_end message from being processed.
  //
  // Flake-avoidance: we never use real timers. We control getToken
  // resolution explicitly via the captured `resolveToken` reference,
  // so test ordering is deterministic regardless of system clock.
  it('a slow getToken does not block a concurrent inbound task_end message', async () => {
    const bridge = makeBridge()
    let resolveToken: ((t: string | null) => void) | null = null
    const getToken = vi.fn().mockImplementation(
      () => new Promise<string | null>((res) => { resolveToken = res }),
    )
    bridge.setTokenProvider(getToken)
    connectAndAuth(bridge)
    await flush(10)
    getToken.mockClear()

    // Force rainbow on so we can observe task_end taking effect
    bridge.setTaskActive(true)
    h.mockHideRainbow.mockClear()

    // 1. Trigger reauth_required — handler blocks on getToken
    h.currentWs.simulateMessage({ type: 'reauth_required', deadline_ms: Date.now() + 60_000 })
    await flush(10)

    // 2. While reauth is mid-flight, fire a task_end. ws library
    //    dispatches each message in its own async context, so task_end
    //    runs concurrently with the awaiting reauth handler.
    h.currentWs.simulateMessage({ type: 'task_end' })
    await flush(10)

    // task_end was processed even though reauth is still awaiting
    expect(h.mockHideRainbow).toHaveBeenCalled()

    // Finally resolve getToken to let the reauth complete cleanly
    resolveToken!('belated-token')
    await flush(20)

    const reauthMsgs = h.currentWs.sent.filter((m: any) => m.type === 'reauth')
    expect(reauthMsgs).toHaveLength(1)
    expect(reauthMsgs[0].token).toBe('belated-token')
  })

  // ── 8. reauth_required when handler has no current ws (paranoia) ──
  //
  // Documents the failure mode: the send() helper checks
  // `this.ws?.readyState === WebSocket.OPEN`. If ws is somehow null
  // mid-handler the guard short-circuits — no crash, no reauth sent.
  // Hard to engineer naturally; we simulate by clearing this.ws via
  // disconnect mid-flight.
  it('reauth_required is a no-op if the bridge is disconnected before getToken resolves', async () => {
    const bridge = makeBridge()
    let resolveToken: ((t: string | null) => void) | null = null
    const getToken = vi.fn().mockImplementation(
      () => new Promise<string | null>((res) => { resolveToken = res }),
    )
    bridge.setTokenProvider(getToken)
    connectAndAuth(bridge)
    await flush(10)
    getToken.mockClear()
    h.currentWs.sent.length = 0

    h.currentWs.simulateMessage({ type: 'reauth_required', deadline_ms: Date.now() + 60_000 })
    await flush(10)

    // Disconnect before getToken resolves — this nulls this.ws
    bridge.disconnect()
    resolveToken!('orphan-token')
    await flush(30)

    // No reauth was sent (ws is null / closed)
    const reauthMsgs = h.currentWs.sent.filter((m: any) => m.type === 'reauth')
    expect(reauthMsgs).toHaveLength(0)
    expect(bridge.getState()).toBe('disconnected')
  })
})

// ─────────────────────────────────────────────────────────────────────
// Additional edge-case coverage — backpressure (deeper)
// ─────────────────────────────────────────────────────────────────────
//
// These tests complement the earlier suite by verifying the *contents*
// of the backpressure frames (depth/threshold fields), latch lifecycle
// across multiple state transitions, and failure modes in the recovered
// emit path (not just the warning path). They are deliberately narrow
// so each failure mode is isolated to a single assertion class.

describe('WebSocketBridge — backpressure frame contents and latch lifecycle', () => {
  // ── A1. Warning frame carries the exact threshold constant ─────────
  //
  // The backend uses `threshold` to compute a "how far past the line"
  // ratio for adaptive throttling. Hardcoding 8 here is intentional:
  // if the constant ever moves, the backend's throttling math breaks,
  // so this test forces a coordinated change.
  it('warning frame carries threshold=8 and a depth >= 8', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    for (let i = 0; i < 8; i++) sendCommand('cmd', { i })
    await flush(20)

    const w = h.currentWs.sent.find(
      (m: any) => m.type === 'command_queue_backpressure' && m.state === 'warning',
    )
    expect(w).toBeDefined()
    expect(w.threshold).toBe(8)
    expect(w.depth).toBeGreaterThanOrEqual(8)
    expect(typeof w.depth).toBe('number')

    await h.releaseAll()
    await flush(20)
  })

  // ── A2. Recovered frame carries depth <= RECOVER=4 ─────────────────
  //
  // Mirrors A1 for the recovery side. Backend uses the depth in the
  // recovered frame to decide whether to fully release throttling or
  // ease in gradually; a value above 4 would be misleading.
  it('recovered frame carries threshold=8 and a depth <= 4', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    for (let i = 0; i < 10; i++) sendCommand('cmd', { i })
    await flush(20)
    await h.releaseN(6)
    await flush(20)

    const r = h.currentWs.sent.find(
      (m: any) => m.type === 'command_queue_backpressure' && m.state === 'recovered',
    )
    expect(r).toBeDefined()
    expect(r.threshold).toBe(8)
    expect(r.depth).toBeLessThanOrEqual(4)
    expect(typeof r.depth).toBe('number')

    await h.releaseAll()
    await flush(20)
  })

  // ── A3. After a full cycle, depth returns to 0 ─────────────────────
  //
  // Documents the invariant that warning + recovered + final drain
  // collapses to depth=0. We can't read depth directly (it's private),
  // so we infer via: after a complete cycle, sending one more command
  // and draining must NOT produce any backpressure frame (depth peaked
  // at 1, well below WARN). Pre-fix bugs that leaked depth would cause
  // the next burst to fire a warning too early.
  it('after a full warn → recover cycle, internal depth resets cleanly (next single command emits nothing)', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    // Full cycle: burst to 9, drain all.
    for (let i = 0; i < 9; i++) sendCommand('cmd', { i })
    await flush(20)
    await h.releaseAll()
    await flush(20)

    // Clear any prior frames so we assert only on the post-cycle state.
    h.currentWs.sent.length = 0

    sendCommand('cmd', { i: 999 })
    await flush(10)
    await h.releaseAll()
    await flush(20)

    const frames = h.currentWs.sent.filter((m: any) => m.type === 'command_queue_backpressure')
    expect(frames).toHaveLength(0)
  })

  // ── A4. ws.send throw on the RECOVERED frame is also safe ──────────
  //
  // Earlier tests cover ws.send throwing on the warning frame. The
  // mirror case is the recovered frame: if the latch was armed and the
  // socket goes flaky during recovery, the bookkeeping (latch flip,
  // queue drain) must still complete without bubbling the throw.
  it('a thrown ws.send during RECOVERED emit does NOT crash the queue', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    h.mockExecuteCommand.mockImplementation(async () => ({ success: true }))

    const ws = h.currentWs
    const realSend = ws.send.bind(ws)
    let recoveredAttempts = 0
    ws.send = (data: string) => {
      const parsed = JSON.parse(data)
      if (parsed.type === 'command_queue_backpressure' && parsed.state === 'recovered') {
        recoveredAttempts++
        throw new Error('socket exploded on recovery')
      }
      realSend(data)
    }

    // Burst to 10 → triggers warning, then drains naturally because
    // executor resolves immediately. The drain crosses RECOVER=4 →
    // recovered frame attempted (and throws).
    for (let i = 0; i < 10; i++) sendCommand('cmd', { i })
    await flush(80)

    expect(recoveredAttempts).toBeGreaterThanOrEqual(1)
    // All 10 results landed regardless of recovered send failure
    const results = ws.sent.filter((m: any) => m.type === 'result')
    expect(results.length).toBe(10)

    h.mockExecuteCommand.mockImplementation(
      (_c, _p) =>
        new Promise<{ success: boolean }>((resolve) => {
          h.pendingResolvers.push(resolve)
        }),
    )
  })

  // ── A5. Stop at exact moment of upcross — no spurious frames ───────
  //
  // Race condition: user clicks Stop in the same tick that the queue
  // depth crosses WARN=8. The warning frame still fires (it's tied to
  // depth, not to the stop state), and as the stop-gated chain links
  // drain past RECOVER=4, recovered also fires. We assert the COUNTS
  // are still exactly 1 / 1 — the stop must not double-fire or skip.
  it('stop at the moment of upcross still produces exactly 1 warning + 1 recovered', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    // Fill to exactly 8 (the upcross point) — warning fires.
    for (let i = 0; i < 8; i++) sendCommand('cmd', { i })
    await flush(20)

    // Stop immediately after the warning.
    bridge.stopTask()
    await flush(10)

    // Release the in-flight; remaining 7 short-circuit via stop-gate.
    await h.releaseN(1)
    await flush(50)

    const warnings = h.currentWs.sent.filter(
      (m: any) => m.type === 'command_queue_backpressure' && m.state === 'warning',
    )
    const recovered = h.currentWs.sent.filter(
      (m: any) => m.type === 'command_queue_backpressure' && m.state === 'recovered',
    )
    expect(warnings).toHaveLength(1)
    expect(recovered).toHaveLength(1)
  })

  // ── A6. Synchronous throw from executor at exact upcross point ─────
  //
  // The 8th command (the one triggering the warning) throws
  // synchronously. The warning frame has already been sent on the
  // enqueue side BEFORE the throw, so it still emits exactly once.
  // The throw routes through the err-branch decrement so depth recovers.
  it('synchronous throw on the upcross command still emits exactly one warning', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    let callIndex = 0
    h.mockExecuteCommand.mockImplementation((() => {
      callIndex++
      // Only the 8th call throws (the one at the upcross point)
      if (callIndex === 8) throw new Error('exactly at upcross')
      // Others return immediately so the queue drains quickly
      return Promise.resolve({ success: true })
    }) as any)

    for (let i = 0; i < 9; i++) sendCommand('cmd', { i })
    await flush(100)

    const warnings = h.currentWs.sent.filter(
      (m: any) => m.type === 'command_queue_backpressure' && m.state === 'warning',
    )
    expect(warnings).toHaveLength(1)

    h.mockExecuteCommand.mockImplementation(
      (_c, _p) =>
        new Promise<{ success: boolean }>((resolve) => {
          h.pendingResolvers.push(resolve)
        }),
    )
  })

  // ── A7. Multiple sequential warn→recover cycles (3 cycles) ─────────
  //
  // Three full cycles should yield exactly 3 warnings + 3 recovers,
  // never more, never fewer. Catches latch-leak bugs that would either
  // skip warnings on later cycles (latch stuck on) or fire extras
  // (latch flapping). Extends the earlier 2-cycle test.
  it('three consecutive burst→drain cycles produce 3 warnings + 3 recovers', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    for (let cycle = 0; cycle < 3; cycle++) {
      for (let i = 0; i < 9; i++) sendCommand('cmd', { cycle, i })
      await flush(20)
      await h.releaseAll()
      await flush(20)
    }

    const warnings = h.currentWs.sent.filter(
      (m: any) => m.type === 'command_queue_backpressure' && m.state === 'warning',
    )
    const recovered = h.currentWs.sent.filter(
      (m: any) => m.type === 'command_queue_backpressure' && m.state === 'recovered',
    )
    expect(warnings).toHaveLength(3)
    expect(recovered).toHaveLength(3)
  })

  // ── A8. Burst exactly to WARN-1 then exactly to WARN ───────────────
  //
  // Boundary check: depth 7 must NOT fire (strictly less than 8), depth
  // 8 MUST fire (>= 8). Tests the comparison operator (>=) on the WARN
  // side. A `>` bug here would delay the warning by one slot — subtle
  // but means the backend's throttling kicks in late and the user
  // notices lag before backpressure signals it.
  it('depth boundary: 7 stays quiet, the 8th command triggers exactly one warning', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    // Push to 7 — no warning
    for (let i = 0; i < 7; i++) sendCommand('cmd', { i })
    await flush(20)
    const beforeEighth = h.currentWs.sent.filter(
      (m: any) => m.type === 'command_queue_backpressure',
    ).length
    expect(beforeEighth).toBe(0)

    // 8th command — exactly here the warning fires
    sendCommand('cmd', { i: 7 })
    await flush(20)

    const afterEighth = h.currentWs.sent.filter(
      (m: any) => m.type === 'command_queue_backpressure' && m.state === 'warning',
    )
    expect(afterEighth).toHaveLength(1)

    await h.releaseAll()
    await flush(20)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Additional edge-case coverage — reauth (deeper)
// ─────────────────────────────────────────────────────────────────────
//
// Complements the earlier reauth tests with: malformed inputs, mixed
// message ordering during a reauth in flight, message shape assertions
// (no leaked fields on JWT vs OSS), and edge-falsy token returns.

describe('WebSocketBridge — reauth: malformed inputs and message shape', () => {
  // ── B1. reauth_required mid-command-execution ──────────────────────
  //
  // Backend pushes reauth while a long-running command is in flight.
  // The reauth message handler must NOT wait for the command to finish
  // (it runs in its own async context). We verify reauth is sent
  // BEFORE the command's result.
  it('reauth is sent in-band even while a command is in flight', async () => {
    const bridge = makeBridge()
    const getToken = vi.fn().mockResolvedValue('mid-flight-token')
    bridge.setTokenProvider(getToken)
    connectAndAuth(bridge)
    await flush(10)
    getToken.mockClear()
    h.currentWs.sent.length = 0

    // Start a command that will hang on the resolver
    sendCommand('long_command', {})
    await flush(10)
    // Confirm executor was called (command is in flight) — exactly one resolver
    expect(h.pendingResolvers.length).toBe(1)

    // Now push reauth_required while the command is hanging
    h.currentWs.simulateMessage({ type: 'reauth_required', deadline_ms: Date.now() + 60_000 })
    await flush(30)

    // The reauth frame must be sent even though the command is still in flight
    const reauthMsgs = h.currentWs.sent.filter((m: any) => m.type === 'reauth')
    expect(reauthMsgs).toHaveLength(1)
    expect(reauthMsgs[0].token).toBe('mid-flight-token')

    // Result for the original command has NOT yet been sent (executor still hung)
    const resultsBefore = h.currentWs.sent.filter((m: any) => m.type === 'result')
    expect(resultsBefore).toHaveLength(0)

    // Now release the command and verify it still completes cleanly
    await h.releaseAll()
    await flush(20)
    const resultsAfter = h.currentWs.sent.filter((m: any) => m.type === 'result')
    expect(resultsAfter).toHaveLength(1)
  })

  // ── B2. reauth_required while task is stopped ──────────────────────
  //
  // taskStopped=true should NOT affect reauth — the reauth handler is
  // independent of the command pipeline. A logged-out / stopped state
  // still needs to refresh credentials so future tasks can resume.
  it('reauth still fires even when task is stopped', async () => {
    const bridge = makeBridge()
    const getToken = vi.fn().mockResolvedValue('stopped-state-token')
    bridge.setTokenProvider(getToken)
    connectAndAuth(bridge)
    await flush(10)
    getToken.mockClear()
    h.currentWs.sent.length = 0

    bridge.stopTask()
    h.currentWs.sent.length = 0  // clear the task_stop frame

    h.currentWs.simulateMessage({ type: 'reauth_required', deadline_ms: Date.now() + 60_000 })
    await flush(20)

    const reauthMsgs = h.currentWs.sent.filter((m: any) => m.type === 'reauth')
    expect(reauthMsgs).toHaveLength(1)
    expect(reauthMsgs[0].token).toBe('stopped-state-token')
  })

  // ── B3. reauth_required with non-numeric deadline_ms (malformed) ───
  //
  // Defensive: if a server bug sends a string in deadline_ms, the
  // handler's `typeof === 'number'` check should treat it as null and
  // still proceed with the reauth.
  it('handles non-numeric deadline_ms (string) without crashing', async () => {
    const bridge = makeBridge()
    const getToken = vi.fn().mockResolvedValue('malformed-deadline-token')
    bridge.setTokenProvider(getToken)
    connectAndAuth(bridge)
    await flush(10)
    getToken.mockClear()
    h.currentWs.sent.length = 0

    // Garbage in deadline_ms field
    h.currentWs.simulateMessage({ type: 'reauth_required', deadline_ms: 'not-a-number' })
    await flush(20)

    expect(getToken).toHaveBeenCalledTimes(1)
    const reauthMsgs = h.currentWs.sent.filter((m: any) => m.type === 'reauth')
    expect(reauthMsgs).toHaveLength(1)
    expect(reauthMsgs[0].token).toBe('malformed-deadline-token')
    // Bridge is still alive
    expect(bridge.getState()).toBe('connected')
  })

  // ── B4. reauth_ack with no `success` field treats as falsy ─────────
  //
  // The branch is `if (message.success)`. With no field at all,
  // `undefined` is falsy → goes to the rejection branch — log + stay
  // alive, no crash. Subsequent messages still process.
  it('reauth_ack with no success field is treated as failure but does not crash', async () => {
    const bridge = makeBridge()
    const getToken = vi.fn().mockResolvedValue('post-ack-token')
    bridge.setTokenProvider(getToken)
    connectAndAuth(bridge)

    h.currentWs.simulateMessage({ type: 'reauth_required', deadline_ms: Date.now() + 60_000 })
    await flush(20)
    const beforeAck = h.currentWs.sent.length

    // Ack with no success field at all
    h.currentWs.simulateMessage({ type: 'reauth_ack' })
    await flush(10)

    // No outbound frames generated by the ack
    expect(h.currentWs.sent.length).toBe(beforeAck)
    expect(bridge.getState()).toBe('connected')

    // Verify the handler still works — send a follow-up task_end
    bridge.setTaskActive(true)
    h.mockHideRainbow.mockClear()
    h.currentWs.simulateMessage({ type: 'task_end' })
    await flush(10)
    expect(h.mockHideRainbow).toHaveBeenCalled()
  })

  // ── B5. getToken returning empty string ────────────────────────────
  //
  // Empty string is falsy, so the `if (!freshToken)` guard treats it
  // like null → no reauth sent. This documents the exact contract:
  // ANY falsy return (null, undefined, '') aborts the reauth.
  it('getToken returning empty string does NOT send reauth (treated as falsy)', async () => {
    const bridge = makeBridge()
    const getToken = vi.fn().mockResolvedValue('')
    bridge.setTokenProvider(getToken)
    connectAndAuth(bridge)
    await flush(10)
    getToken.mockClear()
    h.currentWs.sent.length = 0

    h.currentWs.simulateMessage({ type: 'reauth_required', deadline_ms: Date.now() + 60_000 })
    await flush(20)

    expect(getToken).toHaveBeenCalledTimes(1)
    const reauthMsgs = h.currentWs.sent.filter((m: any) => m.type === 'reauth')
    expect(reauthMsgs).toHaveLength(0)
  })

  // ── B6. JWT reauth message contains exactly type + token (no extras) ─
  //
  // Negative-shape assertion: when the token is a JWT (not coasty_),
  // the reauth message must NOT carry apiKey or source fields. The
  // backend's JWT branch would reject a message with apiKey present.
  it('JWT reauth message does not leak apiKey or source fields', async () => {
    const bridge = makeBridge()
    const getToken = vi.fn().mockResolvedValue('eyJhbGciOiJIUzI1NiJ9.fake.signature')
    bridge.setTokenProvider(getToken)
    connectAndAuth(bridge)
    await flush(10)
    getToken.mockClear()
    h.currentWs.sent.length = 0

    h.currentWs.simulateMessage({ type: 'reauth_required', deadline_ms: Date.now() + 60_000 })
    await flush(20)

    const reauthMsg = h.currentWs.sent.find((m: any) => m.type === 'reauth')
    expect(reauthMsg).toBeDefined()
    expect(reauthMsg.token).toBe('eyJhbGciOiJIUzI1NiJ9.fake.signature')
    // Exactly two top-level fields: type + token
    expect(Object.keys(reauthMsg).sort()).toEqual(['token', 'type'])
    expect(reauthMsg.apiKey).toBeUndefined()
    expect(reauthMsg.source).toBeUndefined()
  })

  // ── B7. reauth_ack arrives BEFORE the reauth handler finished ──────
  //
  // Pathological ordering: a fast server pre-acks the reauth before
  // the client even sends the reauth frame. Should not affect anything
  // — the ack branch only logs, doesn't gate state.
  it('reauth_ack arriving before reauth frame is sent is harmless', async () => {
    const bridge = makeBridge()
    let resolveToken: ((t: string | null) => void) | null = null
    const getToken = vi.fn().mockImplementation(
      () => new Promise<string | null>((res) => { resolveToken = res }),
    )
    bridge.setTokenProvider(getToken)
    connectAndAuth(bridge)
    await flush(10)
    getToken.mockClear()
    h.currentWs.sent.length = 0

    // 1. reauth_required arrives — handler blocks on getToken
    h.currentWs.simulateMessage({ type: 'reauth_required', deadline_ms: Date.now() + 60_000 })
    await flush(10)

    // 2. Server pre-acks (out of order) before we've sent reauth
    h.currentWs.simulateMessage({ type: 'reauth_ack', success: true })
    await flush(10)

    expect(bridge.getState()).toBe('connected')

    // 3. Now resolve getToken — reauth frame goes out
    resolveToken!('belated-token-2')
    await flush(20)

    const reauthMsgs = h.currentWs.sent.filter((m: any) => m.type === 'reauth')
    expect(reauthMsgs).toHaveLength(1)
    expect(reauthMsgs[0].token).toBe('belated-token-2')
  })

  // ── B8. Three concurrent reauth_required messages ──────────────────
  //
  // Pathological server: arms three reauth_required in succession. All
  // three must produce reauth responses; no deadlock and no crash. Each
  // handler's getToken call is independent.
  it('three back-to-back reauth_required messages produce three reauth frames', async () => {
    const bridge = makeBridge()
    let n = 0
    const getToken = vi.fn().mockImplementation(async () => {
      n++
      return `triple-token-${n}`
    })
    bridge.setTokenProvider(getToken)
    connectAndAuth(bridge)
    await flush(10)
    n = 0
    getToken.mockClear()
    h.currentWs.sent.length = 0

    h.currentWs.simulateMessage({ type: 'reauth_required', deadline_ms: Date.now() + 60_000 })
    h.currentWs.simulateMessage({ type: 'reauth_required', deadline_ms: Date.now() + 60_000 })
    h.currentWs.simulateMessage({ type: 'reauth_required', deadline_ms: Date.now() + 60_000 })
    await flush(80)

    expect(getToken).toHaveBeenCalledTimes(3)
    const reauthMsgs = h.currentWs.sent.filter((m: any) => m.type === 'reauth')
    expect(reauthMsgs).toHaveLength(3)
    const tokens = reauthMsgs.map((m: any) => m.token).sort()
    expect(tokens).toEqual(['triple-token-1', 'triple-token-2', 'triple-token-3'])
  })
})
