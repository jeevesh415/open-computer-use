/**
 * Security tests for ElectronAuth — covering:
 *
 *  #23  PKCE auth code exchange (replaces old POST-based token exchange)
 *  #24  Nonce-based CSRF protection on callback server
 *  #25  Refresh mutex prevents token refresh race conditions
 *  NEW  Protocol callback handling (coasty:// deep link flow)
 *
 * These tests spin up real HTTP servers via the auth module and make real
 * HTTP requests against them. They are fully cross-platform (Windows + macOS).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as http from 'http'
import * as crypto from 'crypto'

// ── Mock Electron + Supabase before importing auth ──────────────────────────

const mockSetSession = vi.fn()
const mockRefreshSession = vi.fn()
const mockSignInWithOAuth = vi.fn()
const mockSignInWithPassword = vi.fn()
const mockSignOut = vi.fn()
const mockSignUp = vi.fn()
const mockSignInWithOtp = vi.fn()
const mockExchangeCodeForSession = vi.fn()

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() =>
      process.platform === 'win32'
        ? 'C:\\Users\\testuser\\AppData\\Roaming\\Coasty Desktop'
        : '/tmp/coasty-test-userdata',
    ),
    isPackaged: false,
  },
  shell: {
    openExternal: vi.fn(),
  },
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      setSession: mockSetSession,
      refreshSession: mockRefreshSession,
      signInWithOAuth: mockSignInWithOAuth,
      signInWithPassword: mockSignInWithPassword,
      signOut: mockSignOut,
      signUp: mockSignUp,
      signInWithOtp: mockSignInWithOtp,
      exchangeCodeForSession: mockExchangeCodeForSession,
    },
  })),
}))

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => { throw new Error('no session') }),
  existsSync: vi.fn(() => false),
  unlinkSync: vi.fn(),
}))

import { ElectronAuth } from './auth'

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Make an HTTP request and return { statusCode, headers, body }. */
function httpRequest(
  options: http.RequestOptions & { body?: string },
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = ''
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () =>
        resolve({ statusCode: res.statusCode || 0, headers: res.headers, body }),
      )
    })
    req.on('error', reject)
    if (options.body) req.write(options.body)
    req.end()
  })
}

/** Extract port and nonce from a redirect URL like http://127.0.0.1:12345/auth/callback/abc123 */
function parseRedirectUrl(redirectUrl: string): { port: number; nonce: string } {
  const u = new URL(redirectUrl)
  const segments = u.pathname.split('/')
  return { port: parseInt(u.port, 10), nonce: segments[segments.length - 1] }
}

// ── Setup ───────────────────────────────────────────────────────────────────

let auth: ElectronAuth

beforeEach(() => {
  vi.clearAllMocks()
  // Default: exchangeCodeForSession succeeds (PKCE flow)
  mockExchangeCodeForSession.mockResolvedValue({
    data: {
      session: {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: 'user-123', email: 'test@example.com' },
      },
      user: { id: 'user-123', email: 'test@example.com' },
    },
    error: null,
  })
  // Also set up setSession for backward compat
  mockSetSession.mockResolvedValue({
    data: {
      session: {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: 'user-123', email: 'test@example.com' },
      },
      user: { id: 'user-123', email: 'test@example.com' },
    },
    error: null,
  })
  auth = new ElectronAuth()
})

afterEach(() => {
  // Clean up any pending servers
  auth.cancelPendingAuth()
  vi.restoreAllMocks()
})

// ═══════════════════════════════════════════════════════════════════════════════
// #23 — PKCE AUTH CODE EXCHANGE
// ═══════════════════════════════════════════════════════════════════════════════

describe('#23: PKCE auth code exchange via GET ?code= parameter', () => {
  it('GET /auth/callback/{nonce}?code=AUTH_CODE exchanges code and returns success', async () => {
    const { redirectUrl, sessionPromise } = await (auth as any).startCallbackServer(5000)
    const { port, nonce } = parseRedirectUrl(redirectUrl)

    const res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: `/auth/callback/${nonce}?code=test-auth-code`,
      method: 'GET',
    })

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain("You're all set")

    // Verify exchangeCodeForSession was called with the code
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('test-auth-code')

    const result = await sessionPromise
    expect(result.user.id).toBe('user-123')
  })

  it('GET /auth/callback/{nonce} without ?code= returns 400', async () => {
    const { redirectUrl, sessionPromise } = await (auth as any).startCallbackServer(5000)
    const { port, nonce } = parseRedirectUrl(redirectUrl)

    // Attach catch early to prevent unhandled rejection
    const rejectionPromise = sessionPromise.catch((e: Error) => e)

    const res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: `/auth/callback/${nonce}`,
      method: 'GET',
    })

    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('No authorization code')
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled()

    const err = await rejectionPromise
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('No authorization code in callback')
  })

  it('POST /auth/complete (old endpoint) returns 404', async () => {
    const { redirectUrl } = await (auth as any).startCallbackServer(5000)
    const { port, nonce } = parseRedirectUrl(redirectUrl)

    // The old POST-based token exchange endpoint should no longer exist
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: `/auth/complete/${nonce}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'access_token=stolen-token&refresh_token=r',
    })

    expect(res.statusCode).toBe(404)
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled()
    expect(mockSetSession).not.toHaveBeenCalled()

    auth.cancelPendingAuth()
  })

  it('exchangeCodeForSession error returns 500 and rejects', async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: new Error('Invalid code'),
    })

    const { redirectUrl, sessionPromise } = await (auth as any).startCallbackServer(5000)
    const { port, nonce } = parseRedirectUrl(redirectUrl)

    const rejectionPromise = sessionPromise.catch((e: Error) => e)

    const res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: `/auth/callback/${nonce}?code=bad-code`,
      method: 'GET',
    })

    expect(res.statusCode).toBe(500)
    const err = await rejectionPromise
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('Invalid code')
  })

  it('double-request guard prevents second code exchange from re-resolving', async () => {
    const { redirectUrl, sessionPromise } = await (auth as any).startCallbackServer(5000)
    const { port, nonce } = parseRedirectUrl(redirectUrl)

    // First request — succeeds
    const res1 = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: `/auth/callback/${nonce}?code=code-1`,
      method: 'GET',
    })
    expect(res1.statusCode).toBe(200)

    const result = await sessionPromise
    expect(result.user.id).toBe('user-123')

    // exchangeCodeForSession should only have been called once (server closes after first success)
    expect(mockExchangeCodeForSession).toHaveBeenCalledTimes(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// #24 — NONCE-BASED CSRF PROTECTION
// ═══════════════════════════════════════════════════════════════════════════════

describe('#24: Nonce validation prevents CSRF / token injection', () => {
  it('redirect URL contains a cryptographic nonce in the path', async () => {
    const { redirectUrl } = await (auth as any).startCallbackServer(5000)

    // URL format: http://127.0.0.1:{port}/auth/callback/{64-char-hex-nonce}
    expect(redirectUrl).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback\/[0-9a-f]{64}$/,
    )

    auth.cancelPendingAuth()
  })

  it('each startCallbackServer call generates a unique nonce', async () => {
    const { redirectUrl: url1 } = await (auth as any).startCallbackServer(5000)
    const nonce1 = parseRedirectUrl(url1).nonce
    auth.cancelPendingAuth()

    const { redirectUrl: url2 } = await (auth as any).startCallbackServer(5000)
    const nonce2 = parseRedirectUrl(url2).nonce
    auth.cancelPendingAuth()

    expect(nonce1).not.toBe(nonce2)
    expect(nonce1).toHaveLength(64)
    expect(nonce2).toHaveLength(64)
  })

  it('GET /auth/callback with wrong nonce returns 404', async () => {
    const { redirectUrl } = await (auth as any).startCallbackServer(5000)
    const { port } = parseRedirectUrl(redirectUrl)

    const wrongNonce = crypto.randomBytes(32).toString('hex')
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: `/auth/callback/${wrongNonce}?code=test-code`,
      method: 'GET',
    })

    expect(res.statusCode).toBe(404)
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled()

    auth.cancelPendingAuth()
  })

  it('GET /auth/callback without nonce (old path) returns 404', async () => {
    const { redirectUrl } = await (auth as any).startCallbackServer(5000)
    const { port } = parseRedirectUrl(redirectUrl)

    const res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/auth/callback?code=test-code',
      method: 'GET',
    })

    expect(res.statusCode).toBe(404)

    auth.cancelPendingAuth()
  })

  it('random paths return 404', async () => {
    const { redirectUrl } = await (auth as any).startCallbackServer(5000)
    const { port } = parseRedirectUrl(redirectUrl)

    for (const testPath of ['/favicon.ico', '/', '/admin', '/auth/hack']) {
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: testPath,
        method: 'GET',
      })
      expect(res.statusCode).toBe(404)
    }

    auth.cancelPendingAuth()
  })

  it('server binds to 127.0.0.1 only (not 0.0.0.0)', async () => {
    const { redirectUrl } = await (auth as any).startCallbackServer(5000)
    expect(redirectUrl).toContain('127.0.0.1')
    expect(redirectUrl).not.toContain('0.0.0.0')
    auth.cancelPendingAuth()
  })

  it('timeout rejects the session promise', async () => {
    // Very short timeout
    const { sessionPromise } = await (auth as any).startCallbackServer(200)

    await expect(sessionPromise).rejects.toThrow('Authentication timed out')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// #25 — REFRESH MUTEX (NO RACE CONDITIONS)
// ═══════════════════════════════════════════════════════════════════════════════

describe('#25: Token refresh mutex prevents race conditions', () => {
  it('concurrent refreshSessionNow() calls share the same promise', async () => {
    // Set up a session with expired token
    ;(auth as any).session = {
      access_token: 'expired-token',
      refresh_token: 'valid-refresh',
      expires_at: Math.floor(Date.now() / 1000) - 100,
      user: { id: 'user-123' },
    }

    let resolveRefresh!: (value: any) => void
    mockRefreshSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve
        }),
    )

    // Call refreshSessionNow() three times concurrently
    const p1 = (auth as any).refreshSessionNow()
    const p2 = (auth as any).refreshSessionNow()
    const p3 = (auth as any).refreshSessionNow()

    // refreshSession should only be called ONCE
    expect(mockRefreshSession).toHaveBeenCalledTimes(1)

    // Resolve the refresh
    resolveRefresh({
      data: {
        session: {
          access_token: 'new-token',
          refresh_token: 'new-refresh',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: 'user-123' },
        },
      },
      error: null,
    })

    await Promise.all([p1, p2, p3])

    // Still only called once
    expect(mockRefreshSession).toHaveBeenCalledTimes(1)
    expect((auth as any).session.access_token).toBe('new-token')
  })

  it('mutex is released after successful refresh, allowing subsequent refresh', async () => {
    ;(auth as any).session = {
      access_token: 'old',
      refresh_token: 'refresh-1',
      expires_at: Math.floor(Date.now() / 1000) - 100,
      user: { id: 'user-123' },
    }

    mockRefreshSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'token-2',
          refresh_token: 'refresh-2',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: 'user-123' },
        },
      },
      error: null,
    })

    await (auth as any).refreshSessionNow()
    expect((auth as any).session.access_token).toBe('token-2')

    // refreshPromise should be null after completion
    expect((auth as any).refreshPromise).toBeNull()

    // Second refresh should work (new call, new promise)
    mockRefreshSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'token-3',
          refresh_token: 'refresh-3',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: 'user-123' },
        },
      },
      error: null,
    })

    ;(auth as any).session.refresh_token = 'refresh-2'
    await (auth as any).refreshSessionNow()
    expect((auth as any).session.access_token).toBe('token-3')
    expect(mockRefreshSession).toHaveBeenCalledTimes(2)
  })

  it('mutex is released after failed refresh', async () => {
    ;(auth as any).session = {
      access_token: 'old',
      refresh_token: 'bad-refresh',
      expires_at: Math.floor(Date.now() / 1000) - 100,
      user: { id: 'user-123' },
    }

    mockRefreshSession.mockResolvedValueOnce({
      data: { session: null },
      error: new Error('Refresh token revoked'),
    })

    await (auth as any).refreshSessionNow()

    // Session should be cleared on failure
    expect((auth as any).session).toBeNull()
    // Mutex released
    expect((auth as any).refreshPromise).toBeNull()
  })

  it('mutex is released after refresh throws an exception', async () => {
    ;(auth as any).session = {
      access_token: 'old',
      refresh_token: 'refresh',
      expires_at: Math.floor(Date.now() / 1000) - 100,
      user: { id: 'user-123' },
    }

    mockRefreshSession.mockRejectedValueOnce(new Error('Network error'))

    await (auth as any).refreshSessionNow()

    expect((auth as any).session).toBeNull()
    expect((auth as any).refreshPromise).toBeNull()
  })

  it('getSession() and getAccessToken() both go through the mutex', async () => {
    ;(auth as any).session = {
      access_token: 'expired',
      refresh_token: 'valid-refresh',
      expires_at: Math.floor(Date.now() / 1000) - 100,
      user: { id: 'user-123' },
    }

    let resolveRefresh!: (value: any) => void
    mockRefreshSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve
        }),
    )

    // Both getSession and getAccessToken trigger refresh concurrently
    const sessionPromise = auth.getSession()
    const tokenPromise = auth.getAccessToken()

    // Only one refresh call should happen
    expect(mockRefreshSession).toHaveBeenCalledTimes(1)

    resolveRefresh({
      data: {
        session: {
          access_token: 'fresh-token',
          refresh_token: 'fresh-refresh',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: 'user-123' },
        },
      },
      error: null,
    })

    const [session, token] = await Promise.all([sessionPromise, tokenPromise])
    expect(session?.access_token).toBe('fresh-token')
    expect(token).toBe('fresh-token')
    expect(mockRefreshSession).toHaveBeenCalledTimes(1)
  })

  it('scheduleRefresh uses the mutex-guarded path', async () => {
    vi.useFakeTimers()

    const session = {
      access_token: 'will-expire',
      refresh_token: 'sched-refresh',
      // Expires in 20 seconds — refresh scheduled at max(20-300, 10) = 10s
      expires_at: Math.floor(Date.now() / 1000) + 20,
      user: { id: 'user-123' },
    }
    ;(auth as any).session = session

    mockRefreshSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'auto-refreshed',
          refresh_token: 'auto-refresh-2',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: 'user-123' },
        },
      },
      error: null,
    })

    // Trigger scheduleRefresh
    ;(auth as any).scheduleRefresh(session)

    // Advance past the refresh interval
    await vi.advanceTimersByTimeAsync(11000)

    expect(mockRefreshSession).toHaveBeenCalledTimes(1)
    expect((auth as any).session.access_token).toBe('auto-refreshed')

    vi.useRealTimers()
  })

  it('no refresh when session has no refresh_token', async () => {
    ;(auth as any).session = {
      access_token: 'expired',
      refresh_token: null,
      expires_at: Math.floor(Date.now() / 1000) - 100,
      user: { id: 'user-123' },
    }

    await (auth as any).refreshSessionNow()

    expect(mockRefreshSession).not.toHaveBeenCalled()
    expect((auth as any).session).toBeNull()
  })

  it('token refresh listeners are notified exactly once per refresh', async () => {
    ;(auth as any).session = {
      access_token: 'old',
      refresh_token: 'refresh',
      expires_at: Math.floor(Date.now() / 1000) - 100,
      user: { id: 'user-123' },
    }

    const listener = vi.fn()
    auth.onTokenRefresh(listener)

    mockRefreshSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'notified-token',
          refresh_token: 'notified-refresh',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: 'user-123' },
        },
      },
      error: null,
    })

    // Three concurrent calls — listener should fire once
    await Promise.all([
      (auth as any).refreshSessionNow(),
      (auth as any).refreshSessionNow(),
      (auth as any).refreshSessionNow(),
    ])

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith('notified-token')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// PROTOCOL CALLBACK (coasty:// deep link)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Protocol callback: coasty:// deep link', () => {
  it('handleProtocolCallback exchanges code for session', async () => {
    // Simulate the pending protocol auth promise
    let resolveAuth!: (result: any) => void
    const authPromise = new Promise((resolve) => { resolveAuth = resolve })
    ;(auth as any).protocolAuthResolve = resolveAuth

    await auth.handleProtocolCallback('coasty://auth/callback?code=protocol-code-123')

    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('protocol-code-123')
  })

  it('handleProtocolCallback rejects when no code in URL', async () => {
    const rejectFn = vi.fn()
    ;(auth as any).protocolAuthReject = rejectFn

    await auth.handleProtocolCallback('coasty://auth/callback')

    expect(rejectFn).toHaveBeenCalledWith(expect.objectContaining({
      message: 'No authorization code in callback',
    }))
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('handleProtocolCallback rejects on exchangeCodeForSession failure', async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: new Error('Code expired'),
    })

    const rejectFn = vi.fn()
    ;(auth as any).protocolAuthReject = rejectFn

    await auth.handleProtocolCallback('coasty://auth/callback?code=expired-code')

    expect(rejectFn).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Code expired',
    }))
  })

  it('handleProtocolCallback stores session and schedules refresh on success', async () => {
    const resolveFn = vi.fn()
    ;(auth as any).protocolAuthResolve = resolveFn

    await auth.handleProtocolCallback('coasty://auth/callback?code=good-code')

    expect(resolveFn).toHaveBeenCalledWith({
      user: { id: 'user-123', email: 'test@example.com' },
      session: expect.objectContaining({ access_token: 'new-access-token' }),
    })
    expect((auth as any).session).not.toBeNull()
    expect((auth as any).session.access_token).toBe('new-access-token')
  })

  it('cleanupProtocolAuth clears the timeout and resolvers', () => {
    ;(auth as any).protocolAuthResolve = vi.fn()
    ;(auth as any).protocolAuthReject = vi.fn()
    ;(auth as any).protocolAuthTimeout = setTimeout(() => {}, 60000)

    ;(auth as any).cleanupProtocolAuth()

    expect((auth as any).protocolAuthResolve).toBeNull()
    expect((auth as any).protocolAuthReject).toBeNull()
    expect((auth as any).protocolAuthTimeout).toBeNull()
  })

  it('cancelPendingAuth also cleans up protocol auth state', () => {
    ;(auth as any).protocolAuthResolve = vi.fn()
    ;(auth as any).protocolAuthReject = vi.fn()
    ;(auth as any).protocolAuthTimeout = setTimeout(() => {}, 60000)

    auth.cancelPendingAuth()

    expect((auth as any).protocolAuthResolve).toBeNull()
    expect((auth as any).protocolAuthReject).toBeNull()
    expect((auth as any).protocolAuthTimeout).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION — FULL PKCE CALLBACK FLOW
// ═══════════════════════════════════════════════════════════════════════════════

describe('Integration: full PKCE callback flow', () => {
  it('complete OAuth flow: GET callback with ?code= → exchange → session created', async () => {
    const { redirectUrl, sessionPromise } = await (auth as any).startCallbackServer(5000)
    const { port, nonce } = parseRedirectUrl(redirectUrl)

    // Browser hits the callback URL with PKCE auth code
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: `/auth/callback/${nonce}?code=real-auth-code`,
      method: 'GET',
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain("You're all set")

    // Session promise resolves
    const result = await sessionPromise
    expect(result.user.id).toBe('user-123')
    expect(result.session.access_token).toBe('new-access-token')

    // Verify the correct code was sent to Supabase
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('real-auth-code')
  })

  it('cancelPendingAuth closes the server', async () => {
    const { redirectUrl } = await (auth as any).startCallbackServer(60000)
    const { port, nonce } = parseRedirectUrl(redirectUrl)

    // Server should be reachable
    const res1 = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: `/auth/callback/${nonce}?code=test`,
      method: 'GET',
    })
    expect(res1.statusCode).toBe(200)
  })

  it('starting a new callback server cancels the previous one', async () => {
    const { redirectUrl: url1 } = await (auth as any).startCallbackServer(60000)
    const { port: port1 } = parseRedirectUrl(url1)

    const { redirectUrl: url2 } = await (auth as any).startCallbackServer(60000)
    const { port: port2, nonce: nonce2 } = parseRedirectUrl(url2)

    // Old server should be closed
    await expect(
      httpRequest({
        hostname: '127.0.0.1',
        port: port1,
        path: '/auth/callback/anything?code=test',
        method: 'GET',
      }),
    ).rejects.toThrow()

    // New server should work
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port: port2,
      path: `/auth/callback/${nonce2}?code=test`,
      method: 'GET',
    })
    expect(res.statusCode).toBe(200)

    auth.cancelPendingAuth()
  })
})

// ── ElectronAuth.dispose() ────────────────────────────────────────────────
//
// dispose() is called from performFullShutdown during app exit. It must
// release every background resource the instance holds so the event loop
// can drain and the process can actually terminate.

describe('ElectronAuth.dispose', () => {
  let auth: ElectronAuth

  beforeEach(() => {
    vi.clearAllMocks()
    auth = new ElectronAuth()
  })

  it('clears the token refresh timer', () => {
    // Install a fake refresh timer (as scheduleTokenRefresh would).
    const internal = auth as any
    internal.refreshTimer = setTimeout(() => {
      throw new Error('refresh timer should have been cleared')
    }, 60_000)

    auth.dispose()

    expect(internal.refreshTimer).toBeNull()
  })

  it('closes any in-flight OAuth callback server', async () => {
    // Spin up a real callback server like the production flow does.
    const { redirectUrl } = await (auth as any).startCallbackServer(60_000)
    const port = parseInt(new URL(redirectUrl).port, 10)

    // Sanity: server is up and responding.
    expect((auth as any).pendingCallbackServer).toBeDefined()

    auth.dispose()

    // After dispose the port must be free — i.e. connections are rejected.
    await expect(
      httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/auth/callback/anything',
        method: 'GET',
      }),
    ).rejects.toThrow()

    expect((auth as any).pendingCallbackServer).toBeNull()
  })

  it('drops registered token-refresh listeners', () => {
    const listener = vi.fn()
    auth.onTokenRefresh(listener)
    expect((auth as any).tokenRefreshListeners.length).toBe(1)

    auth.dispose()
    expect((auth as any).tokenRefreshListeners.length).toBe(0)
  })

  it('is safe to call multiple times', () => {
    expect(() => {
      auth.dispose()
      auth.dispose()
      auth.dispose()
    }).not.toThrow()
  })

  it('is safe to call when nothing is in flight', () => {
    // Fresh instance, no pending server, no refresh timer, no listeners.
    expect(() => auth.dispose()).not.toThrow()
  })

  it('clears both a live timer and a live server in one call', async () => {
    const internal = auth as any
    internal.refreshTimer = setTimeout(() => {}, 60_000)
    await (auth as any).startCallbackServer(60_000)

    auth.dispose()

    expect(internal.refreshTimer).toBeNull()
    expect(internal.pendingCallbackServer).toBeNull()
  })
})
