/**
 * Heavy corner-case tests for `WebSocketBridge` command serialization.
 *
 * The original bug: the bridge's `'message'` handler is `async`, so when
 * multiple commands land before the first's executor chain completes
 * (hide overlay 50ms → action → 250ms fade-in), they all run
 * concurrently. That race caused screenshots to capture the overlay
 * mid-fade, keyboard input to interleave, and commands to silently
 * "not work" from the user's perspective.
 *
 * Fix: every command now routes through `executeSerially` which chains
 * onto a shared promise queue. These tests prove that:
 *
 *  1. Commands ALWAYS execute in arrival order
 *  2. Commands NEVER execute in parallel (overlap detection)
 *  3. A failing/throwing command DOES NOT break the queue
 *  4. A burst of 100 commands all execute, none skipped, all in order
 *  5. Rapid back-to-back same-command (e.g. screenshot, screenshot)
 *     don't race
 *  6. Slow commands (e.g. terminal_execute taking 2s) don't get
 *     overtaken by faster commands queued behind them
 *  7. Mid-queue stopTask still rejects subsequent commands cleanly
 *  8. Each command's RESULT is sent in the same order it was received
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted shared state ──────────────────────────────────────────

const h = vi.hoisted(() => {
  const mockShowRainbow = vi.fn()
  const mockHideRainbow = vi.fn()
  const mockInitRainbow = vi.fn()

  // Tracks invocations so we can assert order, overlap, and counts.
  type Call = { command: string; startedAt: number; finishedAt?: number }
  const invocations: Call[] = []
  // When the executor is mocked to "be slow", it awaits this delay map.
  const customDelay: Map<string, number> = new Map()
  // Commands that should throw (test error isolation)
  const shouldThrow: Set<string> = new Set()
  // Commands that should return success: false
  const shouldFail: Set<string> = new Set()

  let nowOffset = 0
  const now = () => Date.now() + nowOffset

  const mockExecuteCommand = vi.fn(async (command: string, _params: any) => {
    const call: Call = { command, startedAt: now() }
    invocations.push(call)
    const delay = customDelay.get(command)
    if (delay !== undefined && delay > 0) {
      // Real timer delay — only used by tests that prove concurrency timing.
      await new Promise((r) => setTimeout(r, delay))
    } else {
      // Fast path: microtask only. Lets bursts of 100+ commands settle in
      // a single event-loop tick so we don't blow our test budget.
      await Promise.resolve()
    }
    call.finishedAt = now()
    if (shouldThrow.has(command)) throw new Error(`boom: ${command}`)
    if (shouldFail.has(command)) return { success: false, error: 'failed' }
    return { success: true, command }
  })

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
    mockShowRainbow,
    mockHideRainbow,
    mockInitRainbow,
    mockExecuteCommand,
    invocations,
    customDelay,
    shouldThrow,
    shouldFail,
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

function makeBridge(): WebSocketBridge {
  const approval = new ApprovalManager()
  return new WebSocketBridge('http://localhost:8001', 'token', 'machine-1', 'user-1', approval)
}

function connectAndAuth(bridge: WebSocketBridge): void {
  bridge.connect()
  h.currentWs.simulateOpen()
  h.currentWs.simulateMessage({ type: 'auth_success' })
}

/** Drain microtasks + any setTimeouts up to `ms`. */
async function settle(ms: number = 50): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

/** Send a synthetic command message on the WS. */
function sendCommand(command: string, parameters: any = {}): void {
  h.currentWs.simulateMessage({
    type: 'command',
    data: { command, parameters },
  })
}

beforeEach(async () => {
  // Drain any leftover async work from the previous test BEFORE clearing
  // mocks. Otherwise late-firing setTimeouts bleed call counts into this
  // test (they hit `mockExecuteCommand` after `clearAllMocks` runs).
  await new Promise((r) => setTimeout(r, 1000))
  vi.clearAllMocks()
  h.invocations.length = 0
  h.customDelay.clear()
  h.shouldThrow.clear()
  h.shouldFail.clear()
})

// ── Tests ──────────────────────────────────────────────────────────

describe('WebSocketBridge command serialization', () => {

  describe('order preservation', () => {
    it('two commands sent back-to-back execute in arrival order', async () => {
      const bridge = makeBridge()
      connectAndAuth(bridge)

      sendCommand('screenshot')
      sendCommand('click')

      await settle(100)

      expect(h.invocations.map((c) => c.command)).toEqual(['screenshot', 'click'])
    })

    it('eight commands (the user-reported sequence) all run in order', async () => {
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
      for (const c of sequence) sendCommand(c)

      await settle(200)

      expect(h.invocations.map((c) => c.command)).toEqual(sequence)
      expect(h.mockExecuteCommand).toHaveBeenCalledTimes(8)
    })

    it('sends results in the same order commands arrived', async () => {
      const bridge = makeBridge()
      connectAndAuth(bridge)

      const sequence = ['type', 'click', 'screenshot', 'key_press']
      for (const c of sequence) sendCommand(c)

      await settle(200)

      const resultCmds = h.currentWs.sent
        .filter((m: any) => m.type === 'result')
        .map((m: any) => m.data.command)
      expect(resultCmds).toEqual(sequence)
    })
  })

  describe('no parallel execution', () => {
    it('a slow command blocks the next one — no overlap', async () => {
      h.customDelay.set('terminal_execute', 80)
      h.customDelay.set('screenshot', 5)

      const bridge = makeBridge()
      connectAndAuth(bridge)

      sendCommand('terminal_execute') // takes 80ms
      sendCommand('screenshot')        // would take 5ms if it could run alone

      await settle(200)

      const [a, b] = h.invocations
      expect(a.command).toBe('terminal_execute')
      expect(b.command).toBe('screenshot')
      // The screenshot must NOT have started before terminal_execute finished.
      // Allow 5ms slack for event-loop noise.
      expect(b.startedAt).toBeGreaterThanOrEqual((a.finishedAt ?? 0) - 5)
    })

    it('three slow commands serialize cumulatively, never overlap', async () => {
      h.customDelay.set('A', 30)
      h.customDelay.set('B', 30)
      h.customDelay.set('C', 30)

      const bridge = makeBridge()
      connectAndAuth(bridge)

      sendCommand('A')
      sendCommand('B')
      sendCommand('C')

      await settle(200)

      const [a, b, c] = h.invocations
      expect(b.startedAt).toBeGreaterThanOrEqual((a.finishedAt ?? 0) - 5)
      expect(c.startedAt).toBeGreaterThanOrEqual((b.finishedAt ?? 0) - 5)
    })

    it('two simultaneously-arriving commands cannot overlap', async () => {
      h.customDelay.set('screenshot', 40)

      const bridge = makeBridge()
      connectAndAuth(bridge)

      // Fire BOTH messages on the same event-loop tick — most adversarial case
      sendCommand('screenshot')
      sendCommand('screenshot')

      await settle(150)

      const [a, b] = h.invocations
      expect(a.command).toBe('screenshot')
      expect(b.command).toBe('screenshot')
      expect(b.startedAt).toBeGreaterThanOrEqual((a.finishedAt ?? 0) - 5)
    })
  })

  describe('error isolation — queue survives failures', () => {
    it('a thrown error in one command does not skip the next', async () => {
      h.shouldThrow.add('click')
      const bridge = makeBridge()
      connectAndAuth(bridge)

      sendCommand('screenshot')
      sendCommand('click')        // throws
      sendCommand('type')         // must still run

      await settle(150)

      expect(h.invocations.map((c) => c.command)).toEqual(['screenshot', 'click', 'type'])
      expect(h.mockExecuteCommand).toHaveBeenCalledTimes(3)
    })

    it('a {success: false} result does not skip the next command', async () => {
      h.shouldFail.add('click')
      const bridge = makeBridge()
      connectAndAuth(bridge)

      sendCommand('screenshot')
      sendCommand('click')   // returns {success: false}
      sendCommand('type')    // must still run

      await settle(150)

      expect(h.invocations.map((c) => c.command)).toEqual(['screenshot', 'click', 'type'])
    })

    it('every queued command sends a result back, even after a thrown error', async () => {
      h.shouldThrow.add('terminal_execute')
      const bridge = makeBridge()
      connectAndAuth(bridge)

      sendCommand('screenshot')
      sendCommand('terminal_execute')
      sendCommand('click')

      await settle(150)

      const results = h.currentWs.sent.filter((m: any) => m.type === 'result')
      expect(results).toHaveLength(3)
      expect(results[0].data.success).toBe(true)
      expect(results[1].data.success).toBe(false)
      expect(results[2].data.success).toBe(true)
    })
  })

  describe('100-command burst (heavy load)', () => {
    it('all 100 execute in order, none skipped', async () => {
      // No customDelay → uses microtask-only fast path.
      const bridge = makeBridge()
      connectAndAuth(bridge)

      for (let i = 0; i < 100; i++) {
        h.currentWs.simulateMessage({
          type: 'command',
          data: { command: 'cmd', parameters: { i } },
        })
      }

      await settle(300)

      expect(h.mockExecuteCommand).toHaveBeenCalledTimes(100)
      // Verify every params.i was passed exactly once, in order
      const seenIs = h.mockExecuteCommand.mock.calls.map((args: any[]) => args[1].i)
      expect(seenIs).toEqual([...Array(100).keys()])
    })

    it('result count matches command count — none lost', async () => {
      const bridge = makeBridge()
      connectAndAuth(bridge)

      for (let i = 0; i < 100; i++) sendCommand('cmd', { i })

      await settle(300)

      const results = h.currentWs.sent.filter((m: any) => m.type === 'result')
      expect(results).toHaveLength(100)
    })
  })

  describe('rapid back-to-back same-command (the screenshot bug)', () => {
    it('two rapid screenshots both execute, in order, never overlap', async () => {
      h.customDelay.set('screenshot', 30)
      const bridge = makeBridge()
      connectAndAuth(bridge)

      sendCommand('screenshot')
      sendCommand('screenshot')

      await settle(150)

      expect(h.mockExecuteCommand).toHaveBeenCalledTimes(2)
      const [a, b] = h.invocations
      expect(b.startedAt).toBeGreaterThanOrEqual((a.finishedAt ?? 0) - 5)
    })

    it('five rapid type commands all execute in order', async () => {
      h.customDelay.set('type', 15)
      const bridge = makeBridge()
      connectAndAuth(bridge)

      for (let i = 0; i < 5; i++) sendCommand('type', { text: `chunk-${i}` })

      await settle(200)

      expect(h.mockExecuteCommand).toHaveBeenCalledTimes(5)
      const texts = h.mockExecuteCommand.mock.calls.map((args: any[]) => args[1].text)
      expect(texts).toEqual(['chunk-0', 'chunk-1', 'chunk-2', 'chunk-3', 'chunk-4'])
    })
  })

  describe('mid-queue stopTask', () => {
    it('stopTask while commands are queued rejects subsequent ones with task-stopped error', async () => {
      h.customDelay.set('screenshot', 40)
      const bridge = makeBridge()
      connectAndAuth(bridge)

      sendCommand('screenshot')   // starts
      sendCommand('screenshot')   // queued

      // Stop while #1 is still executing
      await settle(10)
      bridge.stopTask()

      // Send another command AFTER stop — should be rejected at the gate
      sendCommand('click')

      await settle(150)

      // The stop-rejected command never reached the executor
      const calls = h.mockExecuteCommand.mock.calls.map((args: any[]) => args[0])
      expect(calls).not.toContain('click')

      // The bridge sent a stop-rejection result for `click`
      const stopRejection = h.currentWs.sent.find(
        (m: any) => m.type === 'result' && m.data.error === 'Task was stopped by user',
      )
      expect(stopRejection).toBeDefined()
    })
  })

  describe('queue survives slow commands without deadlock', () => {
    it('a 200ms command does not freeze the queue past its completion', async () => {
      h.customDelay.set('slow', 200)
      h.customDelay.set('fast', 5)
      const bridge = makeBridge()
      connectAndAuth(bridge)

      sendCommand('slow')
      sendCommand('fast')

      await settle(400)

      expect(h.invocations).toHaveLength(2)
      expect(h.invocations[1].command).toBe('fast')
      // Fast command starts AFTER slow one finishes
      expect(h.invocations[1].startedAt).toBeGreaterThanOrEqual(
        (h.invocations[0].finishedAt ?? 0) - 5,
      )
    })
  })

  describe('two consecutive tasks (queue resets correctly)', () => {
    it('queue handles task 1 → task_end → task 2 cleanly', async () => {
      const bridge = makeBridge()
      connectAndAuth(bridge)

      // Task 1: 3 commands
      sendCommand('screenshot')
      sendCommand('click')
      sendCommand('screenshot')
      await settle(80)
      h.currentWs.simulateMessage({ type: 'task_end' })

      // Task 2: 3 more commands
      sendCommand('screenshot')
      sendCommand('type')
      sendCommand('screenshot')
      await settle(80)

      const calls = h.mockExecuteCommand.mock.calls.map((args: any[]) => args[0])
      expect(calls).toEqual([
        'screenshot', 'click', 'screenshot',
        'screenshot', 'type', 'screenshot',
      ])
    })
  })

  describe('startup race — commands before queue is ready', () => {
    it('command sent immediately after auth_success still executes', async () => {
      const bridge = makeBridge()
      bridge.connect()
      h.currentWs.simulateOpen()
      h.currentWs.simulateMessage({ type: 'auth_success' })
      // Send command on the SAME tick as auth_success
      sendCommand('screenshot')

      await settle(80)

      expect(h.mockExecuteCommand).toHaveBeenCalledTimes(1)
      expect(h.invocations[0].command).toBe('screenshot')
    })
  })

  describe('mixed delays — queue remains strictly ordered', () => {
    it('alternating fast/slow/fast/slow stays in order', async () => {
      h.customDelay.set('fast', 5)
      h.customDelay.set('slow', 40)
      const bridge = makeBridge()
      connectAndAuth(bridge)

      sendCommand('fast')
      sendCommand('slow')
      sendCommand('fast')
      sendCommand('slow')
      sendCommand('fast')

      await settle(400)

      expect(h.invocations.map((c) => c.command)).toEqual([
        'fast', 'slow', 'fast', 'slow', 'fast',
      ])
      // Each command's start ≥ previous command's end
      for (let i = 1; i < h.invocations.length; i++) {
        expect(h.invocations[i].startedAt).toBeGreaterThanOrEqual(
          (h.invocations[i - 1].finishedAt ?? 0) - 5,
        )
      }
    })
  })
})
