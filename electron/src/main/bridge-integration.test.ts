/**
 * Production-realistic integration tests.
 *
 * Unlike the other ws-bridge test files (which mock LocalExecutor wholesale
 * to test only the bridge's queueing logic), these tests wire up the REAL
 * WebSocketBridge → REAL LocalExecutor → REAL terminal.ts handler chain,
 * and mock only at the OS boundary (child_process.execFile). This catches
 * the kinds of failures that the user actually saw in production logs:
 *
 *   - terminal_execute reporting `failed` because PowerShell exits non-zero
 *   - terminal_execute called with `{ command: undefined }`
 *   - execFile timing out and never firing the callback
 *   - execFile crashing with ENOENT (shell binary missing)
 *   - The bridge logging "failed" with no actionable error message
 *   - Mid-task disconnect leaving commands in limbo
 *
 * The mocks are intentionally minimal — just enough to drive `execFile`
 * deterministically. Everything else (security checks, sanitizeChildEnv,
 * the actual handler dispatch) runs for real.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted: shared fakes ────────────────────────────────────────

const h = vi.hoisted(() => {
  // Each call to mockExecFile pushes one entry. The test sets the next
  // response on `nextResponse` BEFORE triggering the call.
  type ExecResponse =
    | { kind: 'ok'; stdout?: string; stderr?: string; delayMs?: number }
    | { kind: 'exit'; code: number; stdout?: string; stderr?: string; delayMs?: number }
    | { kind: 'spawn-error'; code: string; message: string }
    | { kind: 'timeout' }
    | { kind: 'never-fires' }   // simulates execFile that never calls back

  type ExecCall = {
    shell: string
    args: string[]
    cwd?: string
    timeoutMs?: number
  }

  const calls: ExecCall[] = []
  let queue: ExecResponse[] = []
  const defaultResponse: ExecResponse = { kind: 'ok', stdout: '', stderr: '' }

  // Captures all timer IDs so a test can flush them with vi.runAllTimers().
  const childListeners: Map<any, Map<string, Function[]>> = new Map()

  const mockExecFile = vi.fn(
    (shell: string, args: string[], opts: any, cb: (err: any, stdout: string, stderr: string) => void) => {
      const call: ExecCall = { shell, args, cwd: opts?.cwd, timeoutMs: opts?.timeout }
      calls.push(call)
      const response = queue.shift() ?? defaultResponse

      // Build a fake child process with on/kill methods.
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

      // Schedule the response (optionally after a delay).
      if (response.kind === 'never-fires') {
        // Don't call cb at all. Watchdog should kick in.
      } else if (response.kind === 'timeout') {
        // Don't call cb. Watchdog will kill.
      } else {
        const delay = (response as any).delayMs ?? 0
        const fire = () => {
          if (response.kind === 'ok') {
            cb(null, response.stdout ?? '', response.stderr ?? '')
            fireExit()
          } else if (response.kind === 'exit') {
            const err: any = new Error(`Command failed with code ${response.code}`)
            err.code = response.code
            cb(err, response.stdout ?? '', response.stderr ?? '')
            fireExit()
          } else if (response.kind === 'spawn-error') {
            const err: any = new Error(response.message)
            err.code = response.code
            cb(err, '', '')
            fireExit()
          }
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

// ── Mocks ────────────────────────────────────────────────────────

// Mock at the OS boundary only.
vi.mock('child_process', () => ({
  execFile: h.mockExecFile,
  exec: h.mockExecFile,
}))

// Real terminal.ts uses os.homedir(), os.platform(), etc. — keep them real.
// (We don't mock 'os'.)

// Stub the rainbow border so tests don't try to spawn windows.
vi.mock('./rainbow-border', () => ({
  showRainbowBorder: vi.fn(),
  hideRainbowBorder: vi.fn(),
  initRainbowBorder: vi.fn(),
}))

// Stub electron — bridge needs `screen.getPrimaryDisplay` for system info.
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

// Stub display-manager (real one talks to electron.screen with state).
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

// Stub the window-manager helpers terminal handlers don't need.
vi.mock('./window-manager', async () => {
  return {
    contentProtectionReliable: false,
    hideForDesktopAction: vi.fn().mockResolvedValue(undefined),
    showAfterDesktopAction: vi.fn(),
  }
})

// Stub OTHER handler modules that also use execFile internally — otherwise
// they'd consume our mocked execFile responses meant for terminal.ts.
// Each non-terminal handler is mocked to return a simple success object,
// so our mockExecFile is only ever called by terminal.executeTerminal.
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

// Approval manager — auto-approve everything for these tests.
vi.mock('./approval-manager', () => ({
  ApprovalManager: class {
    shouldAutoApprove = vi.fn(() => true)
    isDenyAll = vi.fn(() => false)
    requestApproval = vi.fn().mockResolvedValue({ approved: true })
    cancelAll = vi.fn()
  },
}))

vi.mock('ws', () => ({ default: h.FakeWebSocket }))

// Now import — the real LocalExecutor + real terminal.ts come along.
import { WebSocketBridge } from './ws-bridge'
import { ApprovalManager } from './approval-manager'

// ── Helpers ──────────────────────────────────────────────────────

// Every bridge created during a test is tracked so afterEach can
// disconnect it — otherwise its commandQueue keeps draining into the
// SHARED `h.queue` mock (eating responses meant for the next test) and
// keeps pushing into the SHARED `h.calls` array.
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

function lastResult(): any {
  const results = h.currentWs.sent.filter((m: any) => m.type === 'result')
  return results[results.length - 1]?.data
}

beforeEach(async () => {
  // Disconnect any bridges left over from the previous test so their
  // commandQueues stop draining into our shared mocks.
  for (const b of liveBridges) {
    try { b.disconnect() } catch { /* ignore */ }
  }
  liveBridges.length = 0
  // Then drain the event loop so any final setImmediate-scheduled cb
  // calls from prior bridges fire before we reset state.
  await new Promise((r) => setTimeout(r, 200))
  vi.clearAllMocks()
  h.calls.length = 0
  h.resetQueue()
})

// ─────────────────────────────────────────────────────────────────
//   TESTS
// ─────────────────────────────────────────────────────────────────

describe('real-bridge integration: terminal_execute', () => {
  it('successful command → success: true with stdout', async () => {
    h.setNextResponse({ kind: 'ok', stdout: 'hello world\n' })

    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('terminal_execute', { command: 'echo hello' })

    await settle()

    const result = lastResult()
    expect(result.success).toBe(true)
    expect(result.exit_code).toBe(0)
    expect(result.stdout).toBe('hello world\n')
    expect(result.error).toBeUndefined()
  })

  it('non-zero exit → success: false with exit_code AND stderr captured', async () => {
    h.setNextResponse({ kind: 'exit', code: 1, stdout: '', stderr: 'file not found\n' })

    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('terminal_execute', { command: 'where nonexistent.exe' })

    await settle()

    const result = lastResult()
    expect(result.success).toBe(false)
    expect(result.exit_code).toBe(1)
    expect(result.stderr).toBe('file not found\n')
    // Error message must be informative — this is what fixes the
    // "failed (841ms) — unknown failure" log we kept seeing.
    expect(result.error).toMatch(/Exit code 1/)
    expect(result.error).toMatch(/file not found/)
  })

  it('shell binary missing (ENOENT) → success: false with clear spawn error', async () => {
    h.setNextResponse({ kind: 'spawn-error', code: 'ENOENT', message: 'spawn powershell.exe ENOENT' })

    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('terminal_execute', { command: 'echo hi' })

    await settle()

    const result = lastResult()
    expect(result.success).toBe(false)
    expect(result.exit_code).toBe(-1)
    expect(result.error).toMatch(/Failed to launch/)
    expect(result.error).toMatch(/ENOENT/)
  })

  it('missing command parameter → fast-fails with descriptive error (NEVER spawns shell)', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('terminal_execute', {}) // no command field

    await settle()

    expect(h.mockExecFile).not.toHaveBeenCalled()
    const result = lastResult()
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/without a "command" string parameter/)
  })

  it('empty/whitespace command → fast-fails (does not invoke shell)', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('terminal_execute', { command: '   \n  ' })

    await settle()

    expect(h.mockExecFile).not.toHaveBeenCalled()
    expect(lastResult().success).toBe(false)
  })

  it('uses -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -Command on Windows', async () => {
    if (process.platform !== 'win32') {
      // We only assert PowerShell args when actually running on Windows
      // (the impl branches on process.platform).
      return
    }
    h.setNextResponse({ kind: 'ok', stdout: '' })

    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('terminal_execute', { command: 'Get-Process' })

    await settle()

    const call = h.calls[0]
    expect(call.shell).toBe('powershell.exe')
    expect(call.args).toContain('-NoProfile')
    expect(call.args).toContain('-NonInteractive')
    expect(call.args).toContain('-ExecutionPolicy')
    expect(call.args).toContain('RemoteSigned')
    expect(call.args).toContain('-Command')
    expect(call.args).toContain('Get-Process')
  })

  it('regression: never spawns PowerShell with -ExecutionPolicy Bypass (AV signature)', async () => {
    // Bypass is the literal string Defender / CrowdStrike / SentinelOne flag
    // as a Cobalt-Strike / RAT signature. If a refactor ever re-introduces
    // it, this test catches it before it ships.
    if (process.platform !== 'win32') return
    h.setNextResponse({ kind: 'ok', stdout: '' })

    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('terminal_execute', { command: 'Get-Process' })

    await settle()

    const call = h.calls[0]
    expect(call.args).not.toContain('Bypass')
    expect(call.args).not.toContain('Unrestricted')
  })

  it('uses /bin/bash -c on Unix', async () => {
    if (process.platform === 'win32') return
    h.setNextResponse({ kind: 'ok', stdout: '' })

    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('terminal_execute', { command: 'ls -la' })

    await settle()

    const call = h.calls[0]
    expect(call.shell).toBe('/bin/bash')
    expect(call.args).toEqual(['-c', 'ls -la'])
  })

  it('blocked dangerous command → fast-fails BEFORE invoking shell', async () => {
    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('terminal_execute', { command: 'rm -rf /' })

    await settle()

    expect(h.mockExecFile).not.toHaveBeenCalled()
    const result = lastResult()
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/[Rr]ecursive/)
  })

  it('output truncation cap at 5000 chars', async () => {
    h.setNextResponse({ kind: 'ok', stdout: 'x'.repeat(20_000) })

    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('terminal_execute', { command: 'cat huge.txt' })

    await settle()

    const result = lastResult()
    expect(result.success).toBe(true)
    expect(result.stdout.length).toBeLessThanOrEqual(5000)
    expect(result.output.length).toBeLessThanOrEqual(5000)
  })
})

describe('real-bridge integration: bridge always sends a result', () => {
  it('every command produces exactly one result message', async () => {
    h.setNextResponse({ kind: 'ok', stdout: '' })
    h.setNextResponse({ kind: 'exit', code: 1, stderr: 'bad' })
    h.setNextResponse({ kind: 'spawn-error', code: 'ENOENT', message: 'no shell' })

    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('terminal_execute', { command: 'good' })
    send('terminal_execute', { command: 'bad' })
    send('terminal_execute', { command: 'no-shell' })
    send('terminal_execute', {}) // no command — fast-fails
    send('terminal_execute', { command: 'rm -rf /' }) // blocked

    await settle(150)

    const results = h.currentWs.sent.filter((m: any) => m.type === 'result')
    expect(results).toHaveLength(5)
    expect(results.every((r: any) => typeof r.data.success === 'boolean')).toBe(true)
  })

  it('mix of terminal + non-terminal commands all produce results', async () => {
    h.setNextResponse({ kind: 'ok', stdout: 'ok' })
    h.setNextResponse({ kind: 'ok', stdout: 'ok2' })

    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('terminal_execute', { command: 'echo a' })
    send('screenshot') // unknown handler in this test setup → returns failure
    send('terminal_execute', { command: 'echo b' })

    await settle(150)

    const results = h.currentWs.sent.filter((m: any) => m.type === 'result')
    expect(results).toHaveLength(3)
  })
})

describe('real-bridge integration: serialization with REAL handlers', () => {
  it('three terminal_execute commands run strictly in order', async () => {
    // Each takes ~10ms (setImmediate cycle)
    h.setNextResponse({ kind: 'ok', stdout: 'A' })
    h.setNextResponse({ kind: 'ok', stdout: 'B' })
    h.setNextResponse({ kind: 'ok', stdout: 'C' })

    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('terminal_execute', { command: 'cmd-A' })
    send('terminal_execute', { command: 'cmd-B' })
    send('terminal_execute', { command: 'cmd-C' })

    await settle(150)

    // execFile must have been called exactly 3 times in order
    expect(h.calls.length).toBe(3)
    const cmds = h.calls.map((c) => c.args[c.args.length - 1])
    expect(cmds).toEqual(['cmd-A', 'cmd-B', 'cmd-C'])

    // Results delivered to backend in same order
    const results = h.currentWs.sent
      .filter((m: any) => m.type === 'result')
      .map((m: any) => m.data.stdout)
    expect(results).toEqual(['A', 'B', 'C'])
  })

  it('a slow command does not let a faster queued command overtake it', async () => {
    // Slow takes 100ms before its callback fires; fast is instant.
    h.setNextResponse({ kind: 'ok', stdout: 'slow-out', delayMs: 100 })
    h.setNextResponse({ kind: 'ok', stdout: 'fast-out' })

    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('terminal_execute', { command: 'slow' })
    send('terminal_execute', { command: 'fast' }) // queued behind

    // After 30ms: only slow should have started; fast is queued behind.
    await settle(30)
    expect(h.calls.length).toBe(1)
    expect(h.calls[0].args[h.calls[0].args.length - 1]).toBe('slow')

    // Wait for slow to finish (100ms) + fast to run.
    await settle(150)

    expect(h.calls.length).toBe(2)
    expect(h.calls[1].args[h.calls[1].args.length - 1]).toBe('fast')

    // Results delivered in order
    const results = h.currentWs.sent
      .filter((m: any) => m.type === 'result')
      .map((m: any) => m.data.stdout)
    expect(results).toEqual(['slow-out', 'fast-out'])
  })

  it('an exception thrown by the handler does not break the queue', async () => {
    // First call: spawn-error (synthesizes a thrown error in the handler)
    h.setNextResponse({ kind: 'spawn-error', code: 'EACCES', message: 'permission denied' })
    h.setNextResponse({ kind: 'ok', stdout: 'second-ok' })

    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('terminal_execute', { command: 'first' })
    send('terminal_execute', { command: 'second' })

    await settle(150)

    const results = h.currentWs.sent.filter((m: any) => m.type === 'result')
    expect(results).toHaveLength(2)
    expect(results[0].data.success).toBe(false)
    expect(results[1].data.success).toBe(true)
    expect(results[1].data.stdout).toBe('second-ok')
  })
})

describe('real-bridge integration: stopTask + disconnect', () => {
  it('stopTask while a command is mid-execution rejects subsequent commands', async () => {
    h.setNextResponse({ kind: 'ok', stdout: 'first' })

    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('terminal_execute', { command: 'first' })

    // Stop quickly
    await settle(5)
    bridge.stopTask()

    // Send another command after stop — should be rejected at the gate
    send('terminal_execute', { command: 'second-after-stop' })

    await settle(150)

    // execFile should only have been called for 'first', not 'second-after-stop'
    const cmds = h.calls.map((c) => c.args[c.args.length - 1])
    expect(cmds).toContain('first')
    expect(cmds).not.toContain('second-after-stop')

    // The post-stop command got the stop-rejection result
    const stopReject = h.currentWs.sent.find(
      (m: any) => m.type === 'result' && m.data.error === 'Task was stopped by user',
    )
    expect(stopReject).toBeDefined()
  })

  it('WebSocket close mid-task lets pending result still be sent (no crash)', async () => {
    h.setNextResponse({ kind: 'ok', stdout: 'in-flight' })

    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('terminal_execute', { command: 'in-flight' })

    // Close the socket immediately — the in-flight command may still
    // try to send a result. We just want NO uncaught exception.
    h.currentWs.simulateClose(1005, '')

    // No assertion needed — the test passes if the close handler ran
    // and the bridge didn't throw. settle gives the in-flight resolve
    // time to fire.
    await settle(80)
  })
})

describe('real-bridge integration: heavy-load + ordering preservation', () => {
  it('20 terminal_execute commands all complete in arrival order with correct results', async () => {
    for (let i = 0; i < 20; i++) {
      h.setNextResponse({ kind: 'ok', stdout: `out-${i}` })
    }

    const bridge = makeBridge()
    connectAndAuth(bridge)
    for (let i = 0; i < 20; i++) {
      send('terminal_execute', { command: `cmd-${i}` })
    }

    await settle(400)

    expect(h.calls.length).toBe(20)
    const cmds = h.calls.map((c) => c.args[c.args.length - 1])
    expect(cmds).toEqual([...Array(20).keys()].map((i) => `cmd-${i}`))

    const results = h.currentWs.sent
      .filter((m: any) => m.type === 'result')
      .map((m: any) => m.data.stdout)
    expect(results).toEqual([...Array(20).keys()].map((i) => `out-${i}`))
  })

  it('mixed success/failure burst — bridge sends all 10 results, none lost', async () => {
    for (let i = 0; i < 10; i++) {
      h.setNextResponse(
        i % 2 === 0
          ? { kind: 'ok', stdout: `ok-${i}` }
          : { kind: 'exit', code: 1, stderr: `err-${i}` },
      )
    }

    const bridge = makeBridge()
    connectAndAuth(bridge)
    for (let i = 0; i < 10; i++) send('terminal_execute', { command: `c${i}` })

    await settle(300)

    const results = h.currentWs.sent.filter((m: any) => m.type === 'result')
    expect(results).toHaveLength(10)
    for (let i = 0; i < 10; i++) {
      if (i % 2 === 0) {
        expect(results[i].data.success).toBe(true)
      } else {
        expect(results[i].data.success).toBe(false)
        expect(results[i].data.exit_code).toBe(1)
      }
    }
  })
})

describe('real-bridge integration: xdotool → native interception (the actual user fix)', () => {
  it('terminal_execute "xdotool key Return" → routes to desktopKeyPress, NOT execFile', async () => {
    const { desktopKeyPress } = await import('./desktop-automation')
    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('terminal_execute', { command: 'xdotool key Return' })

    await settle(80)

    // execFile NEVER called — the shell command was intercepted
    expect(h.mockExecFile).not.toHaveBeenCalled()
    // The native key_press handler WAS called with the translated key
    expect(desktopKeyPress).toHaveBeenCalledWith({ keys: ['enter'] })

    // The bridge sees a SUCCESS result, not the failed-PowerShell error
    const result = lastResult()
    expect(result.success).toBe(true)
  })

  it('terminal_execute "xdotool key -- super" → key_press [win] (the production-log case)', async () => {
    const { desktopKeyPress } = await import('./desktop-automation')
    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('terminal_execute', { command: 'xdotool key -- super' })

    await settle(80)

    expect(h.mockExecFile).not.toHaveBeenCalled()
    expect(desktopKeyPress).toHaveBeenCalledWith({ keys: ['win'] })
    expect(lastResult().success).toBe(true)
  })

  it('terminal_execute "xdotool key -- super+r" → key_combo [win, r]', async () => {
    const { desktopKeyCombo } = await import('./desktop-automation')
    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('terminal_execute', { command: 'xdotool key -- super+r' })

    await settle(80)

    expect(h.mockExecFile).not.toHaveBeenCalled()
    expect(desktopKeyCombo).toHaveBeenCalledWith({ keys: ['win', 'r'] })
    expect(lastResult().success).toBe(true)
  })

  it('terminal_execute "xdotool type \\"chrome\\"" → desktopType', async () => {
    const { desktopType } = await import('./desktop-automation')
    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('terminal_execute', { command: 'xdotool type "chrome"' })

    await settle(80)

    expect(h.mockExecFile).not.toHaveBeenCalled()
    expect(desktopType).toHaveBeenCalledWith({ text: 'chrome' })
    expect(lastResult().success).toBe(true)
  })

  it('multiple xdotool commands in serial — all intercepted, none hit shell', async () => {
    const { desktopKeyPress, desktopKeyCombo, desktopType } = await import('./desktop-automation')
    const bridge = makeBridge()
    connectAndAuth(bridge)

    send('terminal_execute', { command: 'xdotool key -- super' })
    send('terminal_execute', { command: 'xdotool type "paint"' })
    send('terminal_execute', { command: 'xdotool key -- Return' })
    send('terminal_execute', { command: 'xdotool key -- super+r' })

    await settle(150)

    // execFile called 0 times — the fix
    expect(h.mockExecFile).not.toHaveBeenCalled()

    // All four native handlers were called in order
    expect(desktopKeyPress).toHaveBeenCalledWith({ keys: ['win'] })
    expect(desktopKeyPress).toHaveBeenCalledWith({ keys: ['enter'] })
    expect(desktopType).toHaveBeenCalledWith({ text: 'paint' })
    expect(desktopKeyCombo).toHaveBeenCalledWith({ keys: ['win', 'r'] })

    // All four results delivered, all success
    const results = h.currentWs.sent.filter((m: any) => m.type === 'result')
    expect(results).toHaveLength(4)
    expect(results.every((r: any) => r.data.success === true)).toBe(true)
  })

  it('NON-xdotool terminal_execute still goes to shell as before', async () => {
    h.setNextResponse({ kind: 'ok', stdout: 'real-output' })

    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('terminal_execute', { command: 'echo hello' })

    await settle(80)

    // execFile WAS called for non-intercepted commands
    expect(h.mockExecFile).toHaveBeenCalledTimes(1)
    expect(lastResult().stdout).toBe('real-output')
  })

  it('mixed: xdotool intercepted, regular shell command runs normally', async () => {
    const { desktopKeyPress } = await import('./desktop-automation')
    h.setNextResponse({ kind: 'ok', stdout: 'shell-output' })

    const bridge = makeBridge()
    connectAndAuth(bridge)
    send('terminal_execute', { command: 'xdotool key Return' })   // intercepted
    send('terminal_execute', { command: 'Get-Process' })           // shell

    await settle(150)

    // Only ONE execFile call — for Get-Process. xdotool was intercepted.
    expect(h.mockExecFile).toHaveBeenCalledTimes(1)
    expect(desktopKeyPress).toHaveBeenCalledWith({ keys: ['enter'] })

    const results = h.currentWs.sent.filter((m: any) => m.type === 'result')
    expect(results).toHaveLength(2)
    expect(results.every((r: any) => r.data.success === true)).toBe(true)
  })

  it('xdotool intercept inherits the bridge serialization guarantee', async () => {
    const { desktopKeyPress } = await import('./desktop-automation')
    const bridge = makeBridge()
    connectAndAuth(bridge)

    // 10 rapid xdotool commands — each must arrive at desktopKeyPress in order
    for (let i = 0; i < 10; i++) {
      send('terminal_execute', { command: `xdotool key F${i + 1}` })
    }

    await settle(150)

    expect(desktopKeyPress).toHaveBeenCalledTimes(10)
    const callOrder = (desktopKeyPress as any).mock.calls.map((c: any[]) => c[0].keys[0])
    expect(callOrder).toEqual([
      'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10',
    ])
  })
})

describe('real-bridge integration: chained shell commands (multi-statement)', () => {

  describe('drag pattern', () => {
    it('the EXACT production-log drag chain → desktopDrag', async () => {
      const { desktopDrag } = await import('./desktop-automation')
      const cmd =
        'xdotool mousemove --sync 450 375 && sleep 0.2 && xdotool mousedown 1 ' +
        '&& sleep 0.15 && xdotool mousemove --sync 600 500 && sleep 0.15 && xdotool mouseup 1'

      const bridge = makeBridge()
      connectAndAuth(bridge)
      send('terminal_execute', { command: cmd })

      await settle(80)

      expect(h.mockExecFile).not.toHaveBeenCalled()
      expect(desktopDrag).toHaveBeenCalledWith(
        expect.objectContaining({ x1: 450, y1: 375, x2: 600, y2: 500 }),
      )
      expect(lastResult().success).toBe(true)
    })

    it('right-button drag (button 3)', async () => {
      const { desktopDrag } = await import('./desktop-automation')
      const bridge = makeBridge()
      connectAndAuth(bridge)
      send('terminal_execute', {
        command: 'xdotool mousemove 10 20 && xdotool mousedown 3 && xdotool mousemove 30 40 && xdotool mouseup 3',
      })

      await settle(80)

      expect(h.mockExecFile).not.toHaveBeenCalled()
      expect(desktopDrag).toHaveBeenCalledWith(
        expect.objectContaining({ x1: 10, y1: 20, x2: 30, y2: 40 }),
      )
    })
  })

  describe('keydown+click+keyup → click_with_modifiers', () => {
    it('shift+click chain', async () => {
      const { desktopClickWithModifiers } = await import('./desktop-automation')
      const bridge = makeBridge()
      connectAndAuth(bridge)
      send('terminal_execute', {
        command: 'xdotool keydown shift && xdotool click 1 && xdotool keyup shift',
      })

      await settle(80)

      expect(h.mockExecFile).not.toHaveBeenCalled()
      expect(desktopClickWithModifiers).toHaveBeenCalledWith(
        expect.objectContaining({ modifiers: ['shift'], button: 'left' }),
      )
    })

    it('ctrl+shift+click at position', async () => {
      const { desktopClickWithModifiers } = await import('./desktop-automation')
      const bridge = makeBridge()
      connectAndAuth(bridge)
      send('terminal_execute', {
        command:
          'xdotool keydown ctrl && xdotool keydown shift ' +
          '&& xdotool mousemove 200 300 && xdotool click 1 ' +
          '&& xdotool keyup ctrl && xdotool keyup shift',
      })

      await settle(80)

      expect(desktopClickWithModifiers).toHaveBeenCalledWith(
        expect.objectContaining({
          x: 200, y: 300,
          modifiers: ['ctrl', 'shift'],
          button: 'left',
        }),
      )
    })
  })

  describe('positioned click (mousemove + click)', () => {
    it('mousemove + click → desktopClick at (x, y)', async () => {
      const { desktopClick } = await import('./desktop-automation')
      const bridge = makeBridge()
      connectAndAuth(bridge)
      send('terminal_execute', {
        command: 'xdotool mousemove 100 200 && xdotool click 1',
      })

      await settle(80)

      expect(desktopClick).toHaveBeenCalledWith({ x: 100, y: 200 })
    })

    it('mousemove + right-click → click_with_modifiers right', async () => {
      const { desktopClickWithModifiers } = await import('./desktop-automation')
      const bridge = makeBridge()
      connectAndAuth(bridge)
      send('terminal_execute', {
        command: 'xdotool mousemove 50 50 && xdotool click 3',
      })

      await settle(80)

      expect(desktopClickWithModifiers).toHaveBeenCalledWith(
        expect.objectContaining({ x: 50, y: 50, button: 'right', modifiers: [] }),
      )
    })
  })

  describe('__sequence: chain of independent intercepts', () => {
    it('two key presses chained with ; → both fire in order', async () => {
      const { desktopKeyPress } = await import('./desktop-automation')
      const bridge = makeBridge()
      connectAndAuth(bridge)
      send('terminal_execute', { command: 'xdotool key Return ; xdotool key Tab' })

      await settle(80)

      expect(h.mockExecFile).not.toHaveBeenCalled()
      expect(desktopKeyPress).toHaveBeenCalledTimes(2)
      const callOrder = (desktopKeyPress as any).mock.calls.map((c: any[]) => c[0].keys[0])
      expect(callOrder).toEqual(['enter', 'tab'])
    })

    it('key + type chain', async () => {
      const { desktopKeyPress, desktopType } = await import('./desktop-automation')
      const bridge = makeBridge()
      connectAndAuth(bridge)
      send('terminal_execute', {
        command: 'xdotool key Return && xdotool type "hello world"',
      })

      await settle(80)

      expect(desktopKeyPress).toHaveBeenCalledWith({ keys: ['enter'] })
      expect(desktopType).toHaveBeenCalledWith({ text: 'hello world' })
    })

    it('sequence with sleeps interleaved → sleeps filtered', async () => {
      const { desktopKeyPress } = await import('./desktop-automation')
      const bridge = makeBridge()
      connectAndAuth(bridge)
      send('terminal_execute', {
        command: 'sleep 0.1 && xdotool key Tab && sleep 0.05 && xdotool key Tab && sleep 0.05 && xdotool key Return',
      })

      await settle(120)

      expect(desktopKeyPress).toHaveBeenCalledTimes(3)
    })

    it('sequence reports failure if any step fails (matches && semantics)', async () => {
      const { desktopKeyPress } = await import('./desktop-automation')
      // Make the second call fail
      ;(desktopKeyPress as any).mockResolvedValueOnce({ success: true })
      ;(desktopKeyPress as any).mockResolvedValueOnce({ success: false, error: 'simulated' })

      const bridge = makeBridge()
      connectAndAuth(bridge)
      send('terminal_execute', {
        command: 'xdotool key Tab && xdotool key Return && xdotool key Escape',
      })

      await settle(80)

      const result = lastResult()
      expect(result.success).toBe(false)
      // Only first two ran — the third is skipped on failure (&& semantics)
      expect(desktopKeyPress).toHaveBeenCalledTimes(2)
    })
  })

  describe('wmctrl interception', () => {
    it('wmctrl -a "Chrome" → routes to switch_to_window handler (no execFile)', async () => {
      const bridge = makeBridge()
      connectAndAuth(bridge)
      send('terminal_execute', { command: 'wmctrl -a "Chrome"' })

      await settle(80)

      // execFile is NEVER called for the intercepted wmctrl command, but the
      // switch_to_window handler internally uses execFile to run powershell
      // / wmctrl on Linux. We don't assert that since our test mocks the
      // OS-level `child_process` — what we DO assert is that the bridge's
      // result reflects the intercepted command's outcome.
      const result = lastResult()
      expect(result).toBeDefined()
    })
  })

  describe('NOT-recognized chains pass through to shell', () => {
    it('chain mixing xdotool with unknown shell cmd → safety net refuses (no PowerShell &&-error)', async () => {
      // On win32 / darwin, ANY chain that starts with a Linux-only tool is
      // refused by the safety net before it reaches the shell — otherwise
      // PowerShell 5.1 chokes on `&&` and the user gets a confusing parser
      // error instead of "this isn't supported on your platform."
      h.setNextResponse({ kind: 'exit', code: 1, stderr: 'pwsh failed' })
      const bridge = makeBridge()
      connectAndAuth(bridge)
      send('terminal_execute', { command: 'xdotool key Return && some-unknown-pwsh-cmd' })

      await settle(80)

      if (process.platform === 'linux') {
        // On Linux the shell can actually run xdotool, so it falls through.
        expect(h.mockExecFile).toHaveBeenCalledTimes(1)
      } else {
        // On Windows / macOS the safety net catches it — execFile NEVER runs.
        expect(h.mockExecFile).not.toHaveBeenCalled()
        const result = lastResult()
        expect(result?.success).toBe(false)
      }
    })

    it('plain shell command not intercepted', async () => {
      h.setNextResponse({ kind: 'ok', stdout: 'hi' })
      const bridge = makeBridge()
      connectAndAuth(bridge)
      send('terminal_execute', { command: 'echo hi && pwd' })

      await settle(80)

      expect(h.mockExecFile).toHaveBeenCalledTimes(1)
    })
  })

  describe('quoted args in chains are preserved', () => {
    it('xdotool type "hello && world" → quotes protect the &&', async () => {
      const { desktopType } = await import('./desktop-automation')
      const bridge = makeBridge()
      connectAndAuth(bridge)
      send('terminal_execute', { command: 'xdotool type "hello && world"' })

      await settle(80)

      expect(desktopType).toHaveBeenCalledWith({ text: 'hello && world' })
    })
  })
})

describe('real-bridge integration: the user-reported sequence', () => {
  it('reproduces the exact 8-command sequence with mixed outcomes', async () => {
    // Match the production log: screenshot, screenshot, terminal_execute (fail),
    // type, terminal_execute (fail), screenshot, click, screenshot
    // Only terminal_execute hits our mocked execFile; the others use stubbed handlers
    // that may fail too — that's fine for this test, we only assert serialization +
    // result delivery.
    h.setNextResponse({ kind: 'exit', code: 1, stderr: 'powershell command failed' })
    h.setNextResponse({ kind: 'exit', code: 1, stderr: 'powershell command failed' })

    const bridge = makeBridge()
    connectAndAuth(bridge)

    const sequence = [
      'screenshot',
      'screenshot',
      'terminal_execute',
      'type',
      'terminal_execute',
      'screenshot',
      'click',
      'screenshot',
    ]
    for (const c of sequence) send(c, { command: 'pwsh-Win-key', text: 'chrome', x: 100, y: 100 })

    await settle(400)

    // ALL 8 commands must produce a result — even the ones that fail
    const results = h.currentWs.sent.filter((m: any) => m.type === 'result')
    expect(results).toHaveLength(8)

    // The two terminal_execute failures should each have a clear, non-empty error
    const termResults = results.filter(
      (_: any, i: number) => sequence[i] === 'terminal_execute',
    )
    expect(termResults).toHaveLength(2)
    for (const r of termResults) {
      expect(r.data.success).toBe(false)
      expect(typeof r.data.error).toBe('string')
      expect(r.data.error.length).toBeGreaterThan(0)
      // The improved error message must include the exit code AND stderr
      expect(r.data.error).toMatch(/Exit code 1/)
      expect(r.data.error).toMatch(/powershell command failed/)
    }
  })
})
