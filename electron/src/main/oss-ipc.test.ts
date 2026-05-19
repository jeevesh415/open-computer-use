/**
 * Tests for the OSS-mode branches in IPC handlers.
 *
 * Verifies that when `isOssMode()` is true, every chats:* / credits:* /
 * auth:* handler routes to coasty.ai with the stored API key (via
 * X-API-Key) instead of going through Supabase.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => {
  const handlersMap = new Map<string, (event: any, ...args: any[]) => any>()
  return {
    handlers: handlersMap,
    mockIpcMain: {
      handle: (channel: string, handler: (event: any, ...args: any[]) => any) => {
        handlersMap.set(channel, handler)
      },
      removeHandler: (channel: string) => {
        handlersMap.delete(channel)
      },
    },
  }
})

const mainWindow = {
  webContents: { id: 1, send: vi.fn() },
  isDestroyed: () => false,
}

vi.mock('electron', () => ({
  ipcMain: hoisted.mockIpcMain,
  app: {
    getPath: () =>
      process.platform === 'win32'
        ? 'C:\\Users\\testuser\\AppData\\Roaming\\Coasty Desktop'
        : '/tmp/coasty-test-oss',
    isPackaged: false,
    getVersion: () => '0.0.0-test',
  },
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
  BrowserWindow: class {},
  shell: { openExternal: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from('ENC:' + s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8').replace(/^ENC:/, ''),
  },
}))

vi.mock('./ws-bridge', () => ({
  WebSocketBridge: class {
    private state = 'disconnected'
    connect = vi.fn(() => { this.state = 'connecting' })
    disconnect = vi.fn(() => { this.state = 'disconnected' })
    getState = vi.fn(() => this.state)
    setTokenProvider = vi.fn()
    setFatalAuthCallback = vi.fn()
    setTaskActive = vi.fn()
    resumeTask = vi.fn()
    stopTask = vi.fn()
    updateToken = vi.fn()
  },
}))

// We control oss-mode at the source: provide a thin in-memory backing for
// the storage helpers so our tests don't actually touch safeStorage / fs.
let _stored: string | null = null

vi.mock('./oss-mode', async () => {
  // We still want hashApiKeyToUserId to compute deterministically — pull it
  // from the real module via dynamic import inside the factory.
  const real = await vi.importActual<typeof import('./oss-mode')>('./oss-mode')
  return {
    ...real,
    isOssMode: vi.fn(async () => _stored !== null),
    getStoredKey: vi.fn(async () => _stored),
    setStoredKey: vi.fn(async (k: string) => { _stored = k }),
    clearStoredKey: vi.fn(async () => { _stored = null }),
    getCoastyApiBaseUrl: vi.fn(() => 'https://coasty.ai'),
  }
})

// Mock global fetch
const fetchCalls: Array<{ url: string; init: any }> = []
const mockFetch = vi.fn(async (url: string | URL, init: any = {}) => {
  fetchCalls.push({ url: String(url), init })
  return new Response(JSON.stringify({ ok: true, balance: 150, tier: 'free' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
;(globalThis as any).fetch = mockFetch

// Module under test
import { registerIpcHandlers } from './ipc-handlers'

const BACKEND_URL = 'http://localhost:8001'

function makeAuthStub() {
  return {
    signInWithGoogle: vi.fn(),
    signInWithEmail: vi.fn(),
    signUpWithEmail: vi.fn(),
    sendMagicLink: vi.fn(),
    awaitMagicLinkSession: vi.fn(),
    resetPassword: vi.fn(),
    cancelPendingAuth: vi.fn(),
    signOut: vi.fn(async () => undefined),
    isAuthenticated: vi.fn(() => false),
    getUserId: vi.fn(() => null),
    getUserEmail: vi.fn(() => null),
    getUserName: vi.fn(() => null),
    getUserAvatar: vi.fn(() => null),
    getMachineId: vi.fn(() => 'machine-prod'),
    getAccessToken: vi.fn(async () => null),
    getSupabaseClient: vi.fn(async () => { throw new Error('Should not reach Supabase in OSS mode') }),
  }
}

let auth: ReturnType<typeof makeAuthStub>
let approvalManager: any
let wsBridgeRef: any
let invokeEvent: any

beforeEach(() => {
  hoisted.handlers.clear()
  fetchCalls.length = 0
  mockFetch.mockClear()
  _stored = 'coasty_test-key-abc'

  auth = makeAuthStub()
  approvalManager = {
    getMode: vi.fn(() => 'smart_approve'),
    setMode: vi.fn(),
    handleResponse: vi.fn(),
    cancelAll: vi.fn(),
    isDenyAll: vi.fn(() => false),
    shouldAutoApprove: vi.fn(() => true),
    requestApproval: vi.fn(async () => ({ approved: true })),
  }
  wsBridgeRef = null

  registerIpcHandlers(
    auth as any,
    () => wsBridgeRef,
    (b: any) => { wsBridgeRef = b },
    BACKEND_URL,
    approvalManager,
    () => mainWindow as any,
  )

  invokeEvent = { sender: mainWindow.webContents }
})

async function invoke(channel: string, ...args: any[]): Promise<any> {
  const h = hoisted.handlers.get(channel)
  if (!h) throw new Error(`No handler registered for ${channel}`)
  return h(invokeEvent, ...args)
}

describe('OSS-mode IPC routing', () => {
  it('chats:create POSTs to /v1/chats with X-API-Key', async () => {
    const result = await invoke('chats:create', { title: 'Test', model: 'gpt-4' })

    expect(result.success).toBe(true)
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0].url).toBe('https://coasty.ai/v1/chats')
    expect(fetchCalls[0].init.method).toBe('POST')
    expect(fetchCalls[0].init.headers['X-API-Key']).toBe('coasty_test-key-abc')
    expect(fetchCalls[0].init.headers['X-Coasty-Source']).toBe('electron-oss')
    const body = JSON.parse(fetchCalls[0].init.body)
    expect(body.title).toBe('Test')
    expect(body.model).toBe('gpt-4')
    expect(body.source).toBe('electron-oss')
  })

  it('chats:list GETs /v1/chats with the machine_id query param', async () => {
    await invoke('chats:list')

    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0].url).toMatch(/^https:\/\/coasty\.ai\/v1\/chats\?machine_id=/)
    expect(fetchCalls[0].init.headers['X-API-Key']).toBe('coasty_test-key-abc')
  })

  it('chats:get-messages GETs /v1/chats/<id>/messages', async () => {
    await invoke('chats:get-messages', 'chat-123')

    expect(fetchCalls[0].url).toBe('https://coasty.ai/v1/chats/chat-123/messages')
    expect(fetchCalls[0].init.headers['X-API-Key']).toBe('coasty_test-key-abc')
  })

  it('chats:update PATCHes /v1/chats/<id>', async () => {
    await invoke('chats:update', { chatId: 'c-1', title: 'Renamed' })

    expect(fetchCalls[0].url).toBe('https://coasty.ai/v1/chats/c-1')
    expect(fetchCalls[0].init.method).toBe('PATCH')
    expect(JSON.parse(fetchCalls[0].init.body).title).toBe('Renamed')
  })

  it('chats:delete DELETEs /v1/chats/<id>', async () => {
    await invoke('chats:delete', 'c-1')

    expect(fetchCalls[0].url).toBe('https://coasty.ai/v1/chats/c-1')
    expect(fetchCalls[0].init.method).toBe('DELETE')
  })

  it('credits:get-balance routes to /v1/credits and never touches Supabase', async () => {
    const result = await invoke('credits:get-balance')

    expect(result.success).toBe(true)
    expect(result.balance).toBe(150)
    expect(result.can_start_session).toBe(true)
    expect(fetchCalls[0].url).toBe('https://coasty.ai/v1/credits')
    expect(auth.getSupabaseClient).not.toHaveBeenCalled()
  })

  it('auth:get-session returns a synthesised OSS session with kind="oss"', async () => {
    const session = await invoke('auth:get-session')

    expect(session.isAuthenticated).toBe(true)
    expect(session.kind).toBe('oss')
    expect(session.userId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(session.email).toBeNull()
  })

  it('auth:get-token returns null in OSS mode (no Bearer JWT)', async () => {
    const token = await invoke('auth:get-token')
    expect(token).toBeNull()
  })

  it('auth:sign-out clears the stored key in OSS mode', async () => {
    expect(_stored).not.toBeNull()
    const result = await invoke('auth:sign-out')
    expect(result.success).toBe(true)
    expect(_stored).toBeNull()
    // Production-mode signOut() must NOT have been called.
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it('falls through to production Supabase when OSS mode is off', async () => {
    _stored = null
    ;(auth.getUserId as any).mockReturnValue('prod-user-id')
    ;(auth.getMachineId as any).mockReturnValue('prod-machine-id')
    // Provide a minimal Supabase client stub for the production branch.
    ;(auth.getSupabaseClient as any).mockResolvedValue({
      from: () => ({
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'c1' }, error: null }) }) }),
      }),
    })

    const result = await invoke('chats:create', { title: 'Prod Test' })
    expect(result.success).toBe(true)
    // No HTTP calls — this went via Supabase.
    expect(fetchCalls).toHaveLength(0)
  })
})

describe('OSS bridge:connect', () => {
  it('seeds the bridge with the API key as the auth token', async () => {
    const result = await invoke('bridge:connect')

    expect(result.success).toBe(true)
    expect(wsBridgeRef).toBeTruthy()
    expect(wsBridgeRef.connect).toHaveBeenCalled()
    // The setTokenProvider hook returns the stored key.
    expect(wsBridgeRef.setTokenProvider).toHaveBeenCalled()
  })
})

describe('OSS chat:send-message', () => {
  it('streams from /v1/chat with X-API-Key (no Bearer)', async () => {
    // Override fetch to a streaming-shaped response so the SSE loop can run.
    mockFetch.mockImplementationOnce(async (url: string | URL, init: any) => {
      fetchCalls.push({ url: String(url), init })
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({}),
        body: {
          getReader: () => ({
            read: async () => ({ done: true, value: undefined }),
            releaseLock: vi.fn(),
          }),
        },
      } as any
    })

    await invoke('chat:send-message', {
      requestId: 'req-1',
      messages: [{ role: 'user', content: 'hello' }],
      chatId: 'c1',
      userId: 'u1',
      machineId: 'm1',
    })

    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0].url).toBe('https://coasty.ai/v1/chat')
    expect(fetchCalls[0].init.headers['X-API-Key']).toBe('coasty_test-key-abc')
    expect(fetchCalls[0].init.headers['X-Coasty-Source']).toBe('electron-oss')
    expect(fetchCalls[0].init.headers['Authorization']).toBeUndefined()
  })
})
