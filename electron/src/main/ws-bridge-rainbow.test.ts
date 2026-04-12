import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted shared state ──────────────────────────────────────────

const h = vi.hoisted(() => {
  const mockShowRainbow = vi.fn()
  const mockHideRainbow = vi.fn()
  const mockInitRainbow = vi.fn()
  const mockExecuteCommand = vi.fn().mockResolvedValue({ success: true })

  // Fake WebSocket
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
    close(): void {
      this.readyState = 3
      this.emit('close', 1000, '')
    }
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
    mockShowRainbow,
    mockHideRainbow,
    mockInitRainbow,
    mockExecuteCommand,
    FakeWebSocket,
    get currentWs() { return currentWs },
  }
})

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('./rainbow-border', () => ({
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

vi.mock('./local-executor', () => ({
  LocalExecutor: class MockLocalExecutor {
    executeCommand = h.mockExecuteCommand
  },
}))

vi.mock('./approval-manager', () => ({
  ApprovalManager: class MockApprovalManager {
    shouldAutoApprove = vi.fn(() => true)
    isDenyAll = vi.fn(() => false)
    requestApproval = vi.fn().mockResolvedValue({ approved: true })
    cancelAll = vi.fn()
  },
}))

vi.mock('ws', () => ({
  default: h.FakeWebSocket,
}))

import { WebSocketBridge } from './ws-bridge'
import { ApprovalManager } from './approval-manager'

// ── Helpers ────────────────────────────────────────────────────────

function createBridge(overrides?: {
  shouldAutoApprove?: (cmd: string) => boolean
  isDenyAll?: () => boolean
  requestApproval?: (cmd: string, params: any) => Promise<{ approved: boolean; reason?: string }>
}): { bridge: WebSocketBridge; approval: any } {
  const approval = new ApprovalManager()
  if (overrides?.shouldAutoApprove) approval.shouldAutoApprove = overrides.shouldAutoApprove as any
  if (overrides?.isDenyAll) approval.isDenyAll = overrides.isDenyAll as any
  if (overrides?.requestApproval) approval.requestApproval = overrides.requestApproval as any

  const bridge = new WebSocketBridge('http://localhost:8001', 'token', 'machine-1', 'user-1', approval)
  return { bridge, approval }
}

function connectAndAuth(bridge: WebSocketBridge): void {
  bridge.connect()
  h.currentWs.simulateOpen()
  h.currentWs.simulateMessage({ type: 'auth_success' })
}

function sendCommand(command: string, parameters: any = {}): void {
  h.currentWs.simulateMessage({ type: 'command', data: { command, parameters } })
}

function sendTaskEnd(): void {
  h.currentWs.simulateMessage({ type: 'task_end' })
}

// ── Tests ──────────────────────────────────────────────────────────

describe('WebSocketBridge — rainbow integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.mockExecuteCommand.mockResolvedValue({ success: true })
  })

  // ── Auto-approve path ───────────────────────────────────────────

  describe('auto-approve path (full_control / smart_approve safe commands)', () => {
    it('starts rainbow on first auto-approved command', async () => {
      const { bridge } = createBridge({ shouldAutoApprove: () => true })
      connectAndAuth(bridge)

      sendCommand('screenshot')
      await vi.waitFor(() => expect(h.mockShowRainbow).toHaveBeenCalledTimes(1))
    })

    it('does not call showRainbow again on subsequent auto-approved commands', async () => {
      const { bridge } = createBridge({ shouldAutoApprove: () => true })
      connectAndAuth(bridge)

      sendCommand('screenshot')
      await vi.waitFor(() => expect(h.mockShowRainbow).toHaveBeenCalledTimes(1))

      sendCommand('click', { x: 100, y: 200 })
      await vi.waitFor(() => expect(h.mockExecuteCommand).toHaveBeenCalledTimes(2))

      // startRainbow() returns early if already active
      expect(h.mockShowRainbow).toHaveBeenCalledTimes(1)
    })

    it('stops rainbow on task_end after auto-approved commands', async () => {
      const { bridge } = createBridge({ shouldAutoApprove: () => true })
      connectAndAuth(bridge)

      sendCommand('screenshot')
      await vi.waitFor(() => expect(h.mockShowRainbow).toHaveBeenCalledTimes(1))

      sendTaskEnd()
      expect(h.mockHideRainbow).toHaveBeenCalledTimes(1)
    })
  })

  // ── Manual approval path ────────────────────────────────────────

  describe('manual approval path (approve_all / smart_approve unsafe)', () => {
    it('starts rainbow after user approves a command', async () => {
      const { bridge } = createBridge({
        shouldAutoApprove: () => false,
        requestApproval: async () => ({ approved: true }),
      })
      connectAndAuth(bridge)

      sendCommand('terminal_execute', { command: 'ls' })
      await vi.waitFor(() => expect(h.mockShowRainbow).toHaveBeenCalledTimes(1))
    })

    it('does NOT start rainbow when user denies a command', async () => {
      const { bridge } = createBridge({
        shouldAutoApprove: () => false,
        requestApproval: async () => ({ approved: false, reason: 'too risky' }),
      })
      connectAndAuth(bridge)

      sendCommand('terminal_execute', { command: 'rm -rf /' })
      await vi.waitFor(() => {
        const results = h.currentWs.sent.filter((m: any) => m.type === 'result')
        expect(results.length).toBeGreaterThan(0)
      })

      expect(h.mockShowRainbow).not.toHaveBeenCalled()
    })

    it('sends denial reason in result', async () => {
      const { bridge } = createBridge({
        shouldAutoApprove: () => false,
        requestApproval: async () => ({ approved: false, reason: 'dangerous' }),
      })
      connectAndAuth(bridge)

      sendCommand('file_delete', { path: '/etc/passwd' })
      await vi.waitFor(() => {
        const results = h.currentWs.sent.filter((m: any) => m.type === 'result')
        expect(results.length).toBeGreaterThan(0)
        expect(results[0].data.error).toContain('dangerous')
      })
    })
  })

  // ── Deny-all mode (off) ─────────────────────────────────────────

  describe('deny-all mode (off)', () => {
    it('does NOT start rainbow — all commands blocked', async () => {
      const { bridge } = createBridge({
        isDenyAll: () => true,
        shouldAutoApprove: () => false,
      })
      connectAndAuth(bridge)

      sendCommand('screenshot')
      await vi.waitFor(() => {
        const results = h.currentWs.sent.filter((m: any) => m.type === 'result')
        expect(results.length).toBeGreaterThan(0)
      })

      expect(h.mockShowRainbow).not.toHaveBeenCalled()
    })

    it('sends block error message', async () => {
      const { bridge } = createBridge({
        isDenyAll: () => true,
        shouldAutoApprove: () => false,
      })
      connectAndAuth(bridge)

      sendCommand('click', { x: 0, y: 0 })
      await vi.waitFor(() => {
        const results = h.currentWs.sent.filter((m: any) => m.type === 'result')
        expect(results[0].data.error).toContain('paused')
      })
    })
  })

  // ── Task stopped ────────────────────────────────────────────────

  describe('task stopped by user', () => {
    it('stops rainbow immediately on stopTask()', async () => {
      const { bridge } = createBridge({ shouldAutoApprove: () => true })
      connectAndAuth(bridge)

      sendCommand('screenshot')
      await vi.waitFor(() => expect(h.mockShowRainbow).toHaveBeenCalledTimes(1))

      bridge.stopTask()
      expect(h.mockHideRainbow).toHaveBeenCalledTimes(1)
    })

    it('rejects subsequent commands after stopTask() — no rainbow', async () => {
      const { bridge } = createBridge({ shouldAutoApprove: () => true })
      connectAndAuth(bridge)

      sendCommand('screenshot')
      await vi.waitFor(() => expect(h.mockShowRainbow).toHaveBeenCalledTimes(1))

      bridge.stopTask()
      h.mockShowRainbow.mockClear()

      sendCommand('click', { x: 100, y: 200 })
      await vi.waitFor(() => {
        const results = h.currentWs.sent.filter((m: any) => m.type === 'result')
        const lastResult = results[results.length - 1]
        expect(lastResult.data.error).toContain('stopped')
      })

      expect(h.mockShowRainbow).not.toHaveBeenCalled()
    })

    it('stopTask() is idempotent — second call is a no-op', async () => {
      const { bridge } = createBridge({ shouldAutoApprove: () => true })
      connectAndAuth(bridge)

      sendCommand('screenshot')
      await vi.waitFor(() => expect(h.mockShowRainbow).toHaveBeenCalled())

      bridge.stopTask()
      h.mockHideRainbow.mockClear()

      bridge.stopTask()
      expect(h.mockHideRainbow).not.toHaveBeenCalled()
    })

    it('rainbow works again after task_end resets the stopped flag', async () => {
      const { bridge } = createBridge({ shouldAutoApprove: () => true })
      connectAndAuth(bridge)

      sendCommand('screenshot')
      await vi.waitFor(() => expect(h.mockShowRainbow).toHaveBeenCalledTimes(1))

      bridge.stopTask()
      expect(h.mockHideRainbow).toHaveBeenCalledTimes(1)

      sendTaskEnd()
      h.mockShowRainbow.mockClear()
      h.mockHideRainbow.mockClear()

      sendCommand('click', { x: 50, y: 50 })
      await vi.waitFor(() => expect(h.mockShowRainbow).toHaveBeenCalledTimes(1))
    })

    it('resumeTask() allows commands and rainbow again', async () => {
      const { bridge } = createBridge({ shouldAutoApprove: () => true })
      connectAndAuth(bridge)

      bridge.stopTask()
      bridge.resumeTask()
      h.mockShowRainbow.mockClear()

      sendCommand('screenshot')
      await vi.waitFor(() => expect(h.mockShowRainbow).toHaveBeenCalledTimes(1))
    })
  })

  // ── Disconnect ──────────────────────────────────────────────────

  describe('WebSocket disconnect', () => {
    it('stops rainbow on unexpected disconnect', async () => {
      const { bridge } = createBridge({ shouldAutoApprove: () => true })
      connectAndAuth(bridge)

      sendCommand('screenshot')
      await vi.waitFor(() => expect(h.mockShowRainbow).toHaveBeenCalledTimes(1))

      h.currentWs.simulateClose(1006, 'abnormal')
      expect(h.mockHideRainbow).toHaveBeenCalled()
    })

    it('stops rainbow on intentional disconnect()', async () => {
      const { bridge } = createBridge({ shouldAutoApprove: () => true })
      connectAndAuth(bridge)

      sendCommand('screenshot')
      await vi.waitFor(() => expect(h.mockShowRainbow).toHaveBeenCalledTimes(1))

      bridge.disconnect()
      expect(h.mockHideRainbow).toHaveBeenCalled()
    })

    it('hideRainbow not called on disconnect if rainbow was not active', () => {
      const { bridge } = createBridge({ shouldAutoApprove: () => true })
      connectAndAuth(bridge)

      h.currentWs.simulateClose()
      expect(h.mockHideRainbow).not.toHaveBeenCalled()
    })
  })

  // ── Auth ────────────────────────────────────────────────────────

  describe('auth_success', () => {
    it('pre-initializes rainbow border on auth', () => {
      const { bridge } = createBridge()
      bridge.connect()
      h.currentWs.simulateOpen()

      h.mockInitRainbow.mockClear()
      h.currentWs.simulateMessage({ type: 'auth_success' })
      expect(h.mockInitRainbow).toHaveBeenCalledTimes(1)
    })
  })

  // ── Command execution errors ────────────────────────────────────

  describe('command execution errors', () => {
    it('rainbow stays active even if command throws (auto-approve)', async () => {
      h.mockExecuteCommand.mockRejectedValueOnce(new Error('click failed'))

      const { bridge } = createBridge({ shouldAutoApprove: () => true })
      connectAndAuth(bridge)

      sendCommand('click', { x: -1, y: -1 })
      await vi.waitFor(() => {
        const results = h.currentWs.sent.filter((m: any) => m.type === 'result')
        expect(results.length).toBeGreaterThan(0)
        expect(results[0].data.success).toBe(false)
      })

      expect(h.mockShowRainbow).toHaveBeenCalledTimes(1)
      expect(h.mockHideRainbow).not.toHaveBeenCalled()
    })

    it('rainbow stays active even if command throws (manual approve)', async () => {
      h.mockExecuteCommand.mockRejectedValueOnce(new Error('browser crashed'))

      const { bridge } = createBridge({
        shouldAutoApprove: () => false,
        requestApproval: async () => ({ approved: true }),
      })
      connectAndAuth(bridge)

      sendCommand('browser_open', { url: 'http://example.com' })
      await vi.waitFor(() => {
        const results = h.currentWs.sent.filter((m: any) => m.type === 'result')
        expect(results.length).toBeGreaterThan(0)
      })

      expect(h.mockShowRainbow).toHaveBeenCalledTimes(1)
      expect(h.mockHideRainbow).not.toHaveBeenCalled()
    })

    it('task_end after error properly stops rainbow', async () => {
      h.mockExecuteCommand.mockRejectedValueOnce(new Error('failed'))

      const { bridge } = createBridge({ shouldAutoApprove: () => true })
      connectAndAuth(bridge)

      sendCommand('click', { x: 0, y: 0 })
      await vi.waitFor(() => expect(h.mockShowRainbow).toHaveBeenCalled())

      sendTaskEnd()
      expect(h.mockHideRainbow).toHaveBeenCalledTimes(1)
    })

    it('error with no .message uses String(error)', async () => {
      h.mockExecuteCommand.mockRejectedValueOnce('plain string error')

      const { bridge } = createBridge({ shouldAutoApprove: () => true })
      connectAndAuth(bridge)

      sendCommand('screenshot')
      await vi.waitFor(() => {
        const results = h.currentWs.sent.filter((m: any) => m.type === 'result')
        expect(results[0].data.error).toBe('plain string error')
      })
    })
  })

  // ── Multi-task lifecycle ────────────────────────────────────────

  describe('multi-task lifecycle', () => {
    it('rainbow on → off → on across two tasks', async () => {
      const { bridge } = createBridge({ shouldAutoApprove: () => true })
      connectAndAuth(bridge)

      // Task 1
      sendCommand('screenshot')
      await vi.waitFor(() => expect(h.mockShowRainbow).toHaveBeenCalledTimes(1))
      sendTaskEnd()
      expect(h.mockHideRainbow).toHaveBeenCalledTimes(1)

      h.mockShowRainbow.mockClear()
      h.mockHideRainbow.mockClear()

      // Task 2
      sendCommand('click', { x: 100, y: 100 })
      await vi.waitFor(() => expect(h.mockShowRainbow).toHaveBeenCalledTimes(1))
      sendTaskEnd()
      expect(h.mockHideRainbow).toHaveBeenCalledTimes(1)
    })

    it('stop + task_end + new task → full lifecycle', async () => {
      const { bridge } = createBridge({ shouldAutoApprove: () => true })
      connectAndAuth(bridge)

      // Task 1: user stops mid-way
      sendCommand('screenshot')
      await vi.waitFor(() => expect(h.mockShowRainbow).toHaveBeenCalledTimes(1))
      bridge.stopTask()
      expect(h.mockHideRainbow).toHaveBeenCalledTimes(1)

      sendTaskEnd()

      h.mockShowRainbow.mockClear()
      h.mockHideRainbow.mockClear()

      // Task 2: runs to completion
      sendCommand('type', { text: 'hello' })
      await vi.waitFor(() => expect(h.mockShowRainbow).toHaveBeenCalledTimes(1))
      sendTaskEnd()
      expect(h.mockHideRainbow).toHaveBeenCalledTimes(1)
    })

    it('rapid task_end without commands does not toggle rainbow', () => {
      const { bridge } = createBridge({ shouldAutoApprove: () => true })
      connectAndAuth(bridge)

      sendTaskEnd()
      sendTaskEnd()
      sendTaskEnd()

      expect(h.mockShowRainbow).not.toHaveBeenCalled()
      expect(h.mockHideRainbow).not.toHaveBeenCalled()
    })
  })

  // ── Mixed approval modes within a task ──────────────────────────

  describe('mixed approval within a single task', () => {
    it('auto-approved command starts rainbow, then manual-approved continues', async () => {
      const { bridge } = createBridge({
        shouldAutoApprove: (cmd) => cmd === 'screenshot',
        requestApproval: async () => ({ approved: true }),
      })
      connectAndAuth(bridge)

      sendCommand('screenshot')
      await vi.waitFor(() => expect(h.mockShowRainbow).toHaveBeenCalledTimes(1))

      sendCommand('click', { x: 50, y: 50 })
      await vi.waitFor(() => expect(h.mockExecuteCommand).toHaveBeenCalledTimes(2))

      expect(h.mockHideRainbow).not.toHaveBeenCalled()
    })
  })

  // ── Heartbeat / ping ────────────────────────────────────────────

  describe('ping / heartbeat does not affect rainbow', () => {
    it('ping message has no effect on rainbow state', async () => {
      const { bridge } = createBridge({ shouldAutoApprove: () => true })
      connectAndAuth(bridge)

      sendCommand('screenshot')
      await vi.waitFor(() => expect(h.mockShowRainbow).toHaveBeenCalledTimes(1))

      h.currentWs.simulateMessage({ type: 'ping' })
      expect(h.mockHideRainbow).not.toHaveBeenCalled()
    })
  })

  // ── Edge cases ──────────────────────────────────────────────────

  describe('edge cases', () => {
    it('unknown message type does not affect rainbow', () => {
      const { bridge } = createBridge({ shouldAutoApprove: () => true })
      connectAndAuth(bridge)

      h.currentWs.simulateMessage({ type: 'unknown_event', data: {} })
      expect(h.mockShowRainbow).not.toHaveBeenCalled()
      expect(h.mockHideRainbow).not.toHaveBeenCalled()
    })

    it('task_end when rainbow is already off is a no-op', async () => {
      const { bridge } = createBridge({ shouldAutoApprove: () => true })
      connectAndAuth(bridge)

      sendCommand('screenshot')
      await vi.waitFor(() => expect(h.mockShowRainbow).toHaveBeenCalled())

      sendTaskEnd()
      h.mockHideRainbow.mockClear()

      sendTaskEnd()
      expect(h.mockHideRainbow).not.toHaveBeenCalled()
    })

    it('disconnect during pending manual approval does not show rainbow', async () => {
      const { bridge } = createBridge({
        shouldAutoApprove: () => false,
        requestApproval: () => new Promise(() => {}), // never resolves
      })
      connectAndAuth(bridge)

      sendCommand('terminal_execute', { command: 'dangerous' })
      // Disconnect while waiting for approval
      h.currentWs.simulateClose(1006, 'lost connection')
      expect(h.mockShowRainbow).not.toHaveBeenCalled()
    })

    it('auth_failed does not init rainbow', () => {
      const { bridge } = createBridge()
      bridge.connect()
      h.currentWs.simulateOpen()
      h.mockInitRainbow.mockClear()

      h.currentWs.simulateMessage({ type: 'auth_failed', reason: 'bad token' })
      expect(h.mockInitRainbow).not.toHaveBeenCalled()
    })
  })
})
