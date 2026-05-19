/**
 * Verifies the WebSocket bridge's OSS-mode auth message includes an
 * `apiKey` field and a `source=electron-oss` URL hint when the token
 * looks like a Coasty API key (`coasty_*`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  type WSHandler = (...args: any[]) => void
  let currentWs: any = null
  let lastUrl: string = ''

  class FakeWebSocket {
    static OPEN = 1
    static CLOSED = 3
    readyState = 1
    private handlers: Record<string, WSHandler[]> = {}
    sent: any[] = []

    constructor(url: string) {
      lastUrl = url
      currentWs = this
    }
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
  }

  return {
    FakeWebSocket,
    get currentWs() { return currentWs },
    get lastUrl() { return lastUrl },
  }
})

vi.mock('./rainbow-border', () => ({
  showRainbowBorder: vi.fn(),
  hideRainbowBorder: vi.fn(),
  initRainbowBorder: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
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
  LocalExecutor: class { executeCommand = vi.fn() },
}))

vi.mock('./approval-manager', () => ({
  ApprovalManager: class {
    shouldAutoApprove = vi.fn(() => true)
    isDenyAll = vi.fn(() => false)
    requestApproval = vi.fn()
    cancelAll = vi.fn()
  },
}))

vi.mock('ws', () => ({ default: h.FakeWebSocket }))

import { WebSocketBridge } from './ws-bridge'
import { ApprovalManager } from './approval-manager'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('WebSocketBridge OSS-mode auth', () => {
  it('includes apiKey + source on connect when token looks like a Coasty API key', async () => {
    const approval = new ApprovalManager()
    const bridge = new WebSocketBridge(
      'http://localhost:8001',
      'coasty_abc123key',
      'machine-x',
      'user-hash',
      approval,
    )

    bridge.connect()
    expect(h.lastUrl).toContain('source=electron-oss')

    // Trigger 'open' so the auth message is sent.
    await Promise.resolve()
    h.currentWs.simulateOpen()
    // Wait for the async handler chain to complete
    await new Promise((r) => setImmediate(r))

    const authMsg = h.currentWs.sent.find((m: any) => m.type === 'auth')
    expect(authMsg).toBeTruthy()
    expect(authMsg.apiKey).toBe('coasty_abc123key')
    expect(authMsg.source).toBe('electron-oss')
    expect(authMsg.token).toBe('coasty_abc123key')
    expect(authMsg.machine_id).toBe('machine-x')
    expect(authMsg.user_id).toBe('user-hash')
  })

  it('does NOT include apiKey when the token is a JWT', async () => {
    const approval = new ApprovalManager()
    const bridge = new WebSocketBridge(
      'http://localhost:8001',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig',
      'machine-x',
      'user-uuid',
      approval,
    )

    bridge.connect()
    expect(h.lastUrl).not.toContain('source=electron-oss')

    await Promise.resolve()
    h.currentWs.simulateOpen()
    await new Promise((r) => setImmediate(r))

    const authMsg = h.currentWs.sent.find((m: any) => m.type === 'auth')
    expect(authMsg).toBeTruthy()
    expect(authMsg.apiKey).toBeUndefined()
    expect(authMsg.source).toBeUndefined()
    expect(authMsg.token).toMatch(/^eyJ/)
  })
})
