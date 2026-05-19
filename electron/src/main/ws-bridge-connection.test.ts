import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted shared state ──────────────────────────────────────────

const h = vi.hoisted(() => {
  const mockShowRainbow = vi.fn()
  const mockHideRainbow = vi.fn()
  const mockInitRainbow = vi.fn()
  const mockExecuteCommand = vi.fn().mockResolvedValue({ success: true })

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

const mockSend = vi.fn()
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => [{ webContents: { send: mockSend } }]) },
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

function createBridge(): { bridge: WebSocketBridge; approval: any } {
  const approval = new ApprovalManager()
  const bridge = new WebSocketBridge('http://localhost:8001', 'token', 'machine-1', 'user-1', approval)
  return { bridge, approval }
}

// ── Tests ──────────────────────────────────────────────────────────

describe('WebSocketBridge — connection state & reconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  // ── State transitions ───────────────────────────────────────────

  describe('state transitions', () => {
    it('starts in disconnected state', () => {
      const { bridge } = createBridge()
      expect(bridge.getState()).toBe('disconnected')
    })

    it('transitions to connecting on connect()', () => {
      const { bridge } = createBridge()
      bridge.connect()
      expect(bridge.getState()).toBe('connecting')
    })

    it('transitions to connected on auth_success', () => {
      const { bridge } = createBridge()
      bridge.connect()
      h.currentWs.simulateOpen()
      h.currentWs.simulateMessage({ type: 'auth_success' })
      expect(bridge.getState()).toBe('connected')
    })

    it('transitions to auth_error on auth_failed (distinct from generic connection error)', () => {
      const { bridge } = createBridge()
      bridge.connect()
      h.currentWs.simulateOpen()
      h.currentWs.simulateMessage({ type: 'auth_failed', reason: 'invalid token' })
      expect(bridge.getState()).toBe('auth_error')
    })

    it('transitions to disconnected on unintentional close', () => {
      const { bridge } = createBridge()
      bridge.connect()
      h.currentWs.simulateOpen()
      h.currentWs.simulateMessage({ type: 'auth_success' })
      expect(bridge.getState()).toBe('connected')

      h.currentWs.simulateClose(1006, 'abnormal')
      expect(bridge.getState()).toBe('disconnected')
    })

    it('transitions to disconnected on intentional disconnect()', () => {
      const { bridge } = createBridge()
      bridge.connect()
      h.currentWs.simulateOpen()
      h.currentWs.simulateMessage({ type: 'auth_success' })

      bridge.disconnect()
      expect(bridge.getState()).toBe('disconnected')
    })
  })

  // ── State broadcasting via IPC ──────────────────────────────────

  describe('state broadcasting', () => {
    it('broadcasts connecting state to renderer', () => {
      const { bridge } = createBridge()
      bridge.connect()
      expect(mockSend).toHaveBeenCalledWith('connection-state-changed', 'connecting')
    })

    it('broadcasts connected state on auth_success', () => {
      const { bridge } = createBridge()
      bridge.connect()
      h.currentWs.simulateOpen()
      mockSend.mockClear()
      h.currentWs.simulateMessage({ type: 'auth_success' })
      expect(mockSend).toHaveBeenCalledWith('connection-state-changed', 'connected')
    })

    it('broadcasts auth_error state on auth_failed', () => {
      const { bridge } = createBridge()
      bridge.connect()
      h.currentWs.simulateOpen()
      mockSend.mockClear()
      h.currentWs.simulateMessage({ type: 'auth_failed', reason: 'bad token' })
      expect(mockSend).toHaveBeenCalledWith('connection-state-changed', 'auth_error')
    })

    it('broadcasts disconnected state on unintentional close', () => {
      const { bridge } = createBridge()
      bridge.connect()
      h.currentWs.simulateOpen()
      h.currentWs.simulateMessage({ type: 'auth_success' })
      mockSend.mockClear()

      h.currentWs.simulateClose(1006, 'abnormal')
      expect(mockSend).toHaveBeenCalledWith('connection-state-changed', 'disconnected')
    })
  })

  // ── auth_failed: no auto-reconnect ──────────────────────────────

  describe('auth_failed — no auto-reconnect', () => {
    it('does NOT schedule reconnect after auth_failed', () => {
      const { bridge } = createBridge()
      bridge.connect()
      h.currentWs.simulateOpen()
      h.currentWs.simulateMessage({ type: 'auth_failed', reason: 'expired' })

      // Advance timers well past any backoff delay
      vi.advanceTimersByTime(60000)

      // State should still be auth_error, no reconnect attempt
      expect(bridge.getState()).toBe('auth_error')
    })

    it('closes the WebSocket after auth_failed', () => {
      const { bridge } = createBridge()
      bridge.connect()
      const ws = h.currentWs
      h.currentWs.simulateOpen()
      h.currentWs.simulateMessage({ type: 'auth_failed', reason: 'revoked' })

      expect(ws.readyState).toBe(3) // CLOSED
    })
  })

  // ── Unintentional close: auto-reconnect ─────────────────────────

  describe('unintentional close — auto-reconnect', () => {
    it('schedules reconnect after unintentional close', () => {
      const { bridge } = createBridge()
      bridge.connect()
      h.currentWs.simulateOpen()
      h.currentWs.simulateMessage({ type: 'auth_success' })

      h.currentWs.simulateClose(1006, 'abnormal')
      expect(bridge.getState()).toBe('disconnected')

      // Advance past first reconnect delay (1s)
      vi.advanceTimersByTime(1100)

      // Bridge should be back in connecting state
      expect(bridge.getState()).toBe('connecting')
    })

    it('uses exponential backoff for reconnection', () => {
      const { bridge } = createBridge()
      bridge.connect()
      h.currentWs.simulateOpen()
      h.currentWs.simulateMessage({ type: 'auth_success' })

      // First disconnect → 1s backoff
      h.currentWs.simulateClose(1006, 'lost')
      vi.advanceTimersByTime(900)
      expect(bridge.getState()).toBe('disconnected') // not yet
      vi.advanceTimersByTime(200)
      expect(bridge.getState()).toBe('connecting') // now

      // Reconnect opens but fails auth → close without auth_success
      // This keeps reconnectAttempts incrementing (no reset)
      h.currentWs.simulateOpen()
      h.currentWs.simulateClose(1006, 'lost again')

      // Second disconnect → 2s backoff (attempt 2)
      vi.advanceTimersByTime(1900)
      expect(bridge.getState()).toBe('disconnected') // not yet
      vi.advanceTimersByTime(200)
      expect(bridge.getState()).toBe('connecting') // now
    })

    it('resets reconnect attempts on successful auth', () => {
      const { bridge } = createBridge()
      bridge.connect()
      h.currentWs.simulateOpen()
      h.currentWs.simulateMessage({ type: 'auth_success' })

      // Disconnect and reconnect a few times to increase backoff
      h.currentWs.simulateClose(1006, 'lost')
      vi.advanceTimersByTime(1100)
      h.currentWs.simulateOpen()
      h.currentWs.simulateMessage({ type: 'auth_success' })

      h.currentWs.simulateClose(1006, 'lost')
      vi.advanceTimersByTime(2100)
      h.currentWs.simulateOpen()
      h.currentWs.simulateMessage({ type: 'auth_success' })

      // After successful auth, next disconnect should use 1s backoff again
      h.currentWs.simulateClose(1006, 'lost')
      vi.advanceTimersByTime(900)
      expect(bridge.getState()).toBe('disconnected')
      vi.advanceTimersByTime(200)
      expect(bridge.getState()).toBe('connecting') // 1s, not 4s
    })

    it('caps backoff at 15 seconds', () => {
      const { bridge } = createBridge()
      bridge.connect()
      h.currentWs.simulateOpen()
      h.currentWs.simulateMessage({ type: 'auth_success' })

      // Simulate many disconnects to reach cap
      // 1s, 2s, 4s, 8s, 15s (capped)
      for (let i = 0; i < 5; i++) {
        h.currentWs.simulateClose(1006, 'lost')
        vi.advanceTimersByTime(16000) // always enough
        h.currentWs.simulateOpen()
        // Don't auth_success so attempts keep incrementing
        h.currentWs.simulateClose(1006, 'no auth')
        vi.advanceTimersByTime(16000)
      }

      // Should reconnect within 15s
      h.currentWs.simulateClose(1006, 'lost')
      vi.advanceTimersByTime(15100)
      expect(bridge.getState()).toBe('connecting')
    })
  })

  // ── WS error event ──────────────────────────────────────────────

  describe('WebSocket error event', () => {
    it('sets state to error, then close triggers reconnect', () => {
      const { bridge } = createBridge()
      bridge.connect()
      h.currentWs.simulateOpen()
      h.currentWs.simulateMessage({ type: 'auth_success' })

      // Error event followed by close event (as per WS spec)
      h.currentWs.emit('error', new Error('ECONNRESET'))
      expect(bridge.getState()).toBe('error')

      h.currentWs.simulateClose(1006, 'abnormal')
      expect(bridge.getState()).toBe('disconnected')

      // Should schedule reconnect
      vi.advanceTimersByTime(1100)
      expect(bridge.getState()).toBe('connecting')
    })
  })

  // ── disconnect() prevents reconnect ─────────────────────────────

  describe('intentional disconnect()', () => {
    it('does NOT schedule reconnect', () => {
      const { bridge } = createBridge()
      bridge.connect()
      h.currentWs.simulateOpen()
      h.currentWs.simulateMessage({ type: 'auth_success' })

      bridge.disconnect()
      expect(bridge.getState()).toBe('disconnected')

      vi.advanceTimersByTime(60000)
      expect(bridge.getState()).toBe('disconnected') // still disconnected, no retry
    })

    it('clears pending reconnect timer', () => {
      const { bridge } = createBridge()
      bridge.connect()
      h.currentWs.simulateOpen()
      h.currentWs.simulateMessage({ type: 'auth_success' })

      // Unintentional close — reconnect scheduled
      h.currentWs.simulateClose(1006, 'lost')
      expect(bridge.getState()).toBe('disconnected')

      // User disconnects before timer fires
      bridge.disconnect()

      // Advance past the reconnect timer
      vi.advanceTimersByTime(60000)
      expect(bridge.getState()).toBe('disconnected') // no reconnect
    })
  })

  // ── Token refresh on reconnect ──────────────────────────────────

  describe('token refresh on reconnect', () => {
    it('fetches fresh token via provider on reconnect', () => {
      const mockGetToken = vi.fn().mockResolvedValue('fresh-token')
      const { bridge } = createBridge()
      bridge.setTokenProvider(mockGetToken)
      bridge.connect()
      h.currentWs.simulateOpen()
      h.currentWs.simulateMessage({ type: 'auth_success' })

      // Disconnect and reconnect
      h.currentWs.simulateClose(1006, 'lost')
      vi.advanceTimersByTime(1100)

      // New WS opens — should call getToken
      h.currentWs.simulateOpen()
      expect(mockGetToken).toHaveBeenCalled()
    })

    it('updateToken re-authenticates on existing connection', () => {
      const { bridge } = createBridge()
      bridge.connect()
      h.currentWs.simulateOpen()
      h.currentWs.simulateMessage({ type: 'auth_success' })
      h.currentWs.sent.length = 0 // clear previous sent messages

      bridge.updateToken('new-token')

      const authMsg = h.currentWs.sent.find((m: any) => m.type === 'auth')
      expect(authMsg).toBeDefined()
      expect(authMsg.token).toBe('new-token')
    })
  })
})
