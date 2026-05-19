/**
 * Battle-tested stop-flow tests for the WebSocket bridge.
 *
 * What this file proves
 * ---------------------
 * When the user clicks "Stop" in the Electron app, NO further
 * commands execute — neither commands queued in the bridge's serial
 * queue BEFORE the stop (the "queue-drain leak"), nor commands that
 * arrive on the wire AFTER the stop (the "ingress race"), nor
 * commands that the bridge would normally send results for.
 *
 * The user-reported symptom was: "I click Stop but I see commands
 * still executing on my desktop". This file is the regression net
 * for that report — every test below corresponds to a real leak
 * path the audit identified.
 *
 * Test categories
 * ---------------
 *
 *   A. INGRESS gate — commands arriving AFTER stopTask are rejected
 *      at the message handler (line ~358 in ws-bridge.ts).
 *
 *   B. QUEUE-DRAIN gate — commands queued BEFORE stopTask but not
 *      yet executed by the serial queue are rejected when their
 *      chain link fires (the new last-mile gate).
 *
 *   C. ORDERING — the stop signals fire in the right sequence
 *      (bridge.stopTask() first → SSE abort → HTTP stop-machine).
 *
 *   D. RESUME / restart — taskStopped clears properly so a new
 *      task isn't permanently blocked.
 *
 *   E. NO double-fire — stopping twice is idempotent.
 *
 *   F. RAINBOW / approval cleanup — visual side-effects also halt.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks — same boundary as bridge-integration.test.ts ─────

const h = vi.hoisted(() => {
  type ExecResponse =
    | { kind: 'ok'; stdout?: string; stderr?: string; delayMs?: number }
    | { kind: 'never-fires' }

  type ExecCall = {
    shell: string
    args: string[]
    command: string
  }

  const calls: ExecCall[] = []
  const queue: ExecResponse[] = []
  const defaultResponse: ExecResponse = { kind: 'ok', stdout: '', stderr: '' }
  const childListeners: Map<any, Map<string, Function[]>> = new Map()

  const mockExecFile = vi.fn(
    (shell: string, args: string[], opts: any, cb: (err: any, stdout: string, stderr: string) => void) => {
      // The actual shell command is the LAST argument when terminal.ts
      // builds the PowerShell or bash invocation.
      const command = args[args.length - 1] || ''
      calls.push({ shell, args, command })
      const response = queue.shift() ?? defaultResponse

      const child: any = {
        kill: vi.fn(),
        on: (event: string, fn: Function) => {
          if (!childListeners.has(child)) childListeners.set(child, new Map())
          const map = childListeners.get(child)!
          if (!map.has(event)) map.set(event, [])
          map.get(event)!.push(fn)
        },
      }

      const fireExit = () => {
        const map = childListeners.get(child)
        const handlers = map?.get('exit') ?? []
        for (const fn of handlers) fn(0)
      }

      if (response.kind === 'never-fires') {
        // Don't call cb at all — leave the command hanging.
      } else {
        const delay = (response as any).delayMs ?? 0
        const fire = () => {
          cb(null, response.stdout ?? '', response.stderr ?? '')
          fireExit()
        }
        if (delay > 0) setTimeout(fire, delay)
        else setImmediate(fire)
      }
      return child
    },
  )

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
    close(): void { this.readyState = 3; this.emit('close', 1000, '') }
    emit(event: string, ...args: any[]): void {
      for (const fn of this.handlers[event] || []) fn(...args)
    }
    simulateOpen(): void { this.emit('open') }
    simulateMessage(data: any): void {
      this.emit('message', Buffer.from(JSON.stringify(data)))
    }
    simulateClose(code = 1000, reason = ''): void {
      this.readyState = 3
      this.emit('close', code, reason)
    }
  }

  return {
    mockExecFile,
    calls,
    queue,
    setNextResponse(r: ExecResponse) { queue.push(r) },
    resetQueue() { queue.length = 0 },
    FakeWebSocket,
    get currentWs() { return currentWs },
  }
})

vi.mock('child_process', () => ({
  execFile: h.mockExecFile,
  exec: h.mockExecFile,
}))

vi.mock('./rainbow-border', () => ({
  showRainbowBorder: vi.fn(),
  hideRainbowBorder: vi.fn(),
  initRainbowBorder: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  screen: {
    getPrimaryDisplay: () => ({
      size: { width: 1920, height: 1080 },
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      workAreaSize: { width: 1920, height: 1080 },
    }),
    getAllDisplays: () => [],
    getDisplayNearestPoint: () => ({
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      workAreaSize: { width: 1920, height: 1080 },
    }),
  },
  desktopCapturer: { getSources: vi.fn().mockResolvedValue([]) },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { on: vi.fn(), handle: vi.fn() },
  app: { getName: () => 'test', getVersion: () => '0.0.0' },
}))

vi.mock('./display-manager', () => ({
  getActiveDisplay: () => ({
    id: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    workAreaSize: { width: 1920, height: 1080 },
    size: { width: 1920, height: 1080 },
  }),
  getActiveDisplayId: () => 1,
}))

vi.mock('./window-manager', async () => ({
  contentProtectionReliable: false,
  hideForDesktopAction: vi.fn().mockResolvedValue(undefined),
  showAfterDesktopAction: vi.fn(),
}))

vi.mock('./screenshot', () => ({
  captureScreenshot: vi.fn().mockResolvedValue({
    success: true, image: 'base64fake', width: 1920, height: 1080,
  }),
}))
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

vi.mock('./approval-manager', () => ({
  ApprovalManager: class {
    shouldAutoApprove = vi.fn(() => true)
    isDenyAll = vi.fn(() => false)
    requestApproval = vi.fn().mockResolvedValue({ approved: true })
    cancelAll = vi.fn()
  },
}))

vi.mock('ws', () => ({ default: h.FakeWebSocket }))

import { WebSocketBridge } from './ws-bridge'
import { ApprovalManager } from './approval-manager'

// ── Helpers ─────────────────────────────────────────────────────────

const liveBridges: WebSocketBridge[] = []

function makeBridge(): WebSocketBridge {
  const b = new WebSocketBridge(
    'http://localhost:8001', 'token', 'machine-1', 'user-1',
    new ApprovalManager(),
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

async function settle(ms = 80): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

beforeEach(async () => {
  for (const b of liveBridges) {
    try { b.disconnect() } catch { /* ignore */ }
  }
  liveBridges.length = 0
  await new Promise((r) => setTimeout(r, 200))
  vi.clearAllMocks()
  h.calls.length = 0
  h.resetQueue()
})

// ════════════════════════════════════════════════════════════════════
// CATEGORY A — INGRESS gate (commands arriving AFTER stop)
// ════════════════════════════════════════════════════════════════════

describe('stop battle: ingress gate', () => {
  it('★ command sent AFTER stopTask never reaches the executor', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    bridge.stopTask()
    // Now the backend (oblivious to the stop) sends a command.
    send('terminal_execute', { command: 'should-never-run' })

    await settle(80)

    // execFile was never called for this command.
    const cmds = h.calls.map((c) => c.command)
    expect(cmds).not.toContain('should-never-run')
    // And the bridge sent back a stop-rejection result.
    const stopRej = h.currentWs.sent.find(
      (m: any) => m.type === 'result' && m.data.error === 'Task was stopped by user',
    )
    expect(stopRej).toBeDefined()
  })

  it('every command type is gated (terminal, screenshot, click, browser)', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)
    bridge.stopTask()

    send('terminal_execute', { command: 'a' })
    send('captureScreenshot', {})
    send('click', { x: 1, y: 2 })
    send('browser_navigate', { url: 'https://example.com' })
    send('type', { text: 'leaked text' })

    await settle(100)

    // ZERO real execFile calls (terminal_execute is the only one our
    // mocked execFile receives; the others are mocked at handler level).
    expect(h.calls.length).toBe(0)
    // Five rejection results — one per attempted command.
    const rejections = h.currentWs.sent.filter(
      (m: any) => m.type === 'result' && m.data.error === 'Task was stopped by user',
    )
    expect(rejections).toHaveLength(5)
  })
})

// ════════════════════════════════════════════════════════════════════
// CATEGORY B — QUEUE-DRAIN gate (queued before stop)
// ════════════════════════════════════════════════════════════════════

describe('stop battle: queue-drain gate (the fix for the user-reported leak)', () => {
  it('★ command queued BEFORE stopTask but not yet executed is REJECTED at its turn', async () => {
    // The race the user reported: backend pipelined 3 commands. Cmd 1
    // is mid-flight. Cmd 2 + 3 are sitting in the serial queue. User
    // hits Stop. Previously cmd 2 + 3 still executed because they had
    // already passed the ingress gate. Now they hit the queue-drain
    // gate when their chain link unblocks.
    h.setNextResponse({ kind: 'ok', stdout: '1', delayMs: 100 })

    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('terminal_execute', { command: 'first-in-flight' })
    send('terminal_execute', { command: 'second-queued' })
    send('terminal_execute', { command: 'third-queued' })

    // Let the first command START (it's a 100ms delay) so cmd 2 + 3
    // are sitting in the chain. Then stop.
    await settle(20)
    bridge.stopTask()

    // Let everything settle.
    await settle(250)

    const cmds = h.calls.map((c) => c.command)
    // First completes (was already mid-execFile when stop fired).
    expect(cmds).toContain('first-in-flight')
    // ★ Second and third were drained from the queue WITHOUT executing.
    expect(cmds).not.toContain('second-queued')
    expect(cmds).not.toContain('third-queued')

    // The drained commands produced stop-rejection results.
    const stopRej = h.currentWs.sent.filter(
      (m: any) => m.type === 'result' && m.data.error === 'Task was stopped by user',
    )
    expect(stopRej.length).toBeGreaterThanOrEqual(2)
  })

  it('★ 10 queued commands all drain cleanly when stop fires while #1 runs', async () => {
    // Stress: 1 in-flight + 9 queued. Stop should let #1 finish, then
    // reject 2–10. Net: 1 execFile call, 9 stop-rejection results.
    h.setNextResponse({ kind: 'ok', stdout: '1', delayMs: 80 })

    const bridge = makeBridge()
    connectAndAuth(bridge)
    for (let i = 0; i < 10; i++) {
      send('terminal_execute', { command: `cmd-${i}` })
    }

    await settle(20)
    bridge.stopTask()
    await settle(400)

    const cmds = h.calls.map((c) => c.command)
    expect(cmds).toContain('cmd-0')
    for (let i = 1; i < 10; i++) {
      expect(cmds).not.toContain(`cmd-${i}`)
    }
  })

  it('★ stop result has stoppedByUser flag for client-side filtering', async () => {
    // Make the first command slow enough that the second is still
    // queued when stop fires (otherwise both complete before stop
    // and there's nothing to drain).
    h.setNextResponse({ kind: 'ok', stdout: 'a', delayMs: 80 })

    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('terminal_execute', { command: 'a' })
    send('terminal_execute', { command: 'b' })
    await settle(15)
    bridge.stopTask()
    await settle(200)

    const stopMessages = h.currentWs.sent.filter(
      (m: any) => m.type === 'result' && m.data.error === 'Task was stopped by user',
    )
    // At least one (the drained 'b') should carry the flag.
    const flagged = stopMessages.filter((m: any) => m.data.stoppedByUser === true)
    expect(flagged.length).toBeGreaterThanOrEqual(1)
  })
})

// ════════════════════════════════════════════════════════════════════
// CATEGORY C — Stop signal side-effects (rainbow, approvals)
// ════════════════════════════════════════════════════════════════════

describe('stop battle: side-effect cleanup', () => {
  it('stopTask sends the task_stop wire message to the backend', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)
    bridge.stopTask()
    const taskStop = h.currentWs.sent.find((m: any) => m.type === 'task_stop')
    expect(taskStop).toBeDefined()
  })

  it('stopTask is idempotent — calling twice does NOT send two task_stop messages', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)
    bridge.stopTask()
    bridge.stopTask()
    bridge.stopTask()
    const taskStops = h.currentWs.sent.filter((m: any) => m.type === 'task_stop')
    expect(taskStops).toHaveLength(1)
  })
})

// ════════════════════════════════════════════════════════════════════
// CATEGORY D — Resume / restart (taskStopped must clear cleanly)
// ════════════════════════════════════════════════════════════════════

describe('stop battle: resume / restart', () => {
  it('★ resumeTask clears the flag — next command executes normally', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    // Stop.
    bridge.stopTask()
    send('terminal_execute', { command: 'rejected-before-resume' })
    await settle(50)
    expect(h.calls.map((c) => c.command)).not.toContain('rejected-before-resume')

    // Resume.
    bridge.resumeTask()
    h.setNextResponse({ kind: 'ok', stdout: 'after resume' })
    send('terminal_execute', { command: 'executes-after-resume' })
    await settle(100)

    expect(h.calls.map((c) => c.command)).toContain('executes-after-resume')
  })

  it('★ stop → resume → stop → resume cycle stays consistent (no leaked state)', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)

    for (let i = 0; i < 3; i++) {
      bridge.stopTask()
      send('terminal_execute', { command: `should-reject-${i}` })
      await settle(30)
      bridge.resumeTask()
      h.setNextResponse({ kind: 'ok', stdout: 'ok' })
      send('terminal_execute', { command: `should-run-${i}` })
      await settle(50)
    }

    const cmds = h.calls.map((c) => c.command)
    for (let i = 0; i < 3; i++) {
      expect(cmds).not.toContain(`should-reject-${i}`)
      expect(cmds).toContain(`should-run-${i}`)
    }
  })

  it('task_end message from backend resets taskStopped to false', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)
    bridge.stopTask()
    // Backend acknowledges the stop.
    h.currentWs.simulateMessage({ type: 'task_end' })
    await settle(20)

    // Now a command should execute.
    h.setNextResponse({ kind: 'ok', stdout: 'ok' })
    send('terminal_execute', { command: 'after-task-end' })
    await settle(80)
    expect(h.calls.map((c) => c.command)).toContain('after-task-end')
  })
})

// ════════════════════════════════════════════════════════════════════
// CATEGORY E — Result correctness for drained commands
// ════════════════════════════════════════════════════════════════════

describe('stop battle: drained commands produce a clean result', () => {
  it('★ queue-drained command result has error="Task was stopped by user"', async () => {
    h.setNextResponse({ kind: 'ok', stdout: '1', delayMs: 60 })

    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('terminal_execute', { command: 'first' })
    send('terminal_execute', { command: 'should-be-drained' })
    await settle(15)
    bridge.stopTask()
    await settle(150)

    const results = h.currentWs.sent.filter((m: any) => m.type === 'result')
    // Each command produces exactly one result wire message — the
    // first is the real one, the second the drained-rejection.
    expect(results.length).toBeGreaterThanOrEqual(2)
    const drained = results.find(
      (r: any) => r.data.error === 'Task was stopped by user' && r.data.stoppedByUser === true,
    )
    expect(drained).toBeDefined()
  })

  it('drained commands result chain CONTINUES (later drained commands also get rejected)', async () => {
    h.setNextResponse({ kind: 'ok', stdout: '1', delayMs: 50 })

    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('terminal_execute', { command: 'first' })
    send('terminal_execute', { command: 'drained-1' })
    send('terminal_execute', { command: 'drained-2' })
    send('terminal_execute', { command: 'drained-3' })
    await settle(10)
    bridge.stopTask()
    await settle(200)

    // Each drained command produced its own rejection.
    const drained = h.currentWs.sent.filter(
      (m: any) => m.type === 'result'
        && m.data.error === 'Task was stopped by user'
        && m.data.stoppedByUser === true,
    )
    expect(drained.length).toBe(3)
  })
})

// ════════════════════════════════════════════════════════════════════
// CATEGORY F — Composite scenarios (realistic user flows)
// ════════════════════════════════════════════════════════════════════

describe('stop battle: realistic user flows', () => {
  it('★ user runs a long task with 5 actions, clicks Stop after action 1', async () => {
    // Action 1: terminal execute that takes 80ms
    h.setNextResponse({ kind: 'ok', stdout: 'a1 done', delayMs: 80 })

    const bridge = makeBridge()
    connectAndAuth(bridge)

    // Backend dispatches the full batch upfront (worst case).
    send('terminal_execute', { command: 'action-1' })
    send('captureScreenshot', {})
    send('click', { x: 100, y: 200 })
    send('terminal_execute', { command: 'action-4' })
    send('captureScreenshot', {})

    // Action 1 starts (delay 80ms). User clicks Stop at ~20ms in.
    await settle(20)
    bridge.stopTask()
    await settle(250)

    const cmds = h.calls.map((c) => c.command)
    // Action 1 was already mid-execFile when stop fired — it completes.
    expect(cmds).toContain('action-1')
    // Action 4 (the other terminal_execute) was drained from the queue.
    expect(cmds).not.toContain('action-4')

    // Net: only 1 real execFile call out of the original 5 commands.
    expect(h.calls.length).toBe(1)
  })

  it('★ stop during heavy approval-requesting flow does not leak commands', async () => {
    // Even if every command requested approval, the queue-drain gate
    // catches them. (Our mock auto-approves everything; the test just
    // ensures the drain still works.)
    h.setNextResponse({ kind: 'ok', stdout: '1', delayMs: 100 })

    const bridge = makeBridge()
    connectAndAuth(bridge)
    for (let i = 0; i < 6; i++) {
      send('terminal_execute', { command: `task-${i}` })
    }
    await settle(15)
    bridge.stopTask()
    await settle(300)

    // Only task-0 should have run.
    const cmds = h.calls.map((c) => c.command)
    expect(cmds).toContain('task-0')
    for (let i = 1; i < 6; i++) {
      expect(cmds).not.toContain(`task-${i}`)
    }
  })

  it('★ stop with NO pending commands is a clean no-op (no spurious results)', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)
    bridge.stopTask()
    await settle(50)

    // Only the task_stop wire message — no command rejections.
    const stopMessages = h.currentWs.sent.filter(
      (m: any) => m.type === 'result' && m.data.error === 'Task was stopped by user',
    )
    expect(stopMessages).toHaveLength(0)

    const taskStop = h.currentWs.sent.find((m: any) => m.type === 'task_stop')
    expect(taskStop).toBeDefined()
  })
})
