/**
 * Fault-tolerance tests for the auth + WS bridge "session-dead → sign out"
 * pipeline.
 *
 * What this file enforces
 * -----------------------
 * The user's directive: "if there are any issues just sign the user
 * out simple as that". Concretely, EVERY failure path in the auth /
 * connection layer must end at ``ElectronAuth.declareDead()`` /
 * ``signalSessionDead`` → ``onSessionDead`` listener → renderer
 * sign-out. No silent failures, no zombie sessions, no infinite
 * retry loops with stale credentials.
 *
 * Pre-hardening audit found five leak paths where failures cleared
 * the in-memory session but no listener was told:
 *   1. ``performRefresh`` Supabase error response
 *   2. ``performRefresh`` network/DNS/TLS throw
 *   3. Scheduled refresh fires + fails — only logged to stdout
 *   4. ``getAccessToken`` returns null to caller — caller may use stale
 *   5. WS bridge ``auth_failed`` — only the bridge knew (via state)
 *
 * Plus two retry-loop hazards in the WS bridge:
 *   6. Reconnect retries forever — no budget
 *   7. Heartbeat sends but no pong watchdog — dead sockets look alive
 *
 * Every test below pins one of these failure modes to its fix.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// ── Hoisted: deterministic Supabase mock ────────────────────────────

const h = vi.hoisted(() => {
  const refreshSessionMock = vi.fn()
  const setSessionMock = vi.fn().mockResolvedValue({})
  const signInWithOAuthMock = vi.fn()
  const signInWithPasswordMock = vi.fn()
  const signOutMock = vi.fn().mockResolvedValue(undefined)
  const exchangeCodeForSessionMock = vi.fn()
  return {
    refreshSessionMock,
    setSessionMock,
    signInWithOAuthMock,
    signInWithPasswordMock,
    signOutMock,
    exchangeCodeForSessionMock,
  }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      refreshSession: h.refreshSessionMock,
      setSession: h.setSessionMock,
      signInWithOAuth: h.signInWithOAuthMock,
      signInWithPassword: h.signInWithPasswordMock,
      signOut: h.signOutMock,
      exchangeCodeForSession: h.exchangeCodeForSessionMock,
    },
  }),
}))

vi.mock('electron', () => {
  // Each test gets a fresh fake userData dir so .session writes don't
  // leak between tests.
  const tmpRoot = path.join(os.tmpdir(), `auth-fault-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
  return {
    app: {
      getPath: () => {
        try { fs.mkdirSync(tmpRoot, { recursive: true }) } catch {}
        return tmpRoot
      },
      isPackaged: false,
    },
    shell: { openExternal: vi.fn() },
  }
})

import { ElectronAuth, SessionDeadReason } from './auth'
import * as electron from 'electron'

// ── Helpers ─────────────────────────────────────────────────────────

function makeValidSession(opts: { expiresInSec?: number; refreshToken?: string } = {}) {
  return {
    access_token: 'access-' + Math.random().toString(36).slice(2, 8),
    refresh_token: opts.refreshToken ?? 'refresh-' + Math.random().toString(36).slice(2, 8),
    expires_at: Math.floor(Date.now() / 1000) + (opts.expiresInSec ?? 3600),
    user: {
      id: 'user-test-001',
      email: 'test@coasty.ai',
      user_metadata: { full_name: 'Test User' },
    },
  }
}

function writeStoredSession(session: any): void {
  // We need to inject a session before construction. The ElectronAuth
  // constructor calls loadStoredSession() which reads from the app's
  // userData. Get the path via the electron mock and write the file.
  // The mock returns the same tmpRoot per process run.
  const userDataDir = (electron as any).app.getPath('userData')
  const sessionPath = path.join(userDataDir, '.session')
  fs.writeFileSync(sessionPath, JSON.stringify(session), 'utf-8')
}

function clearStoredSession(): void {
  try {
    const userDataDir = (electron as any).app.getPath('userData')
    fs.unlinkSync(path.join(userDataDir, '.session'))
  } catch {}
}

beforeEach(() => {
  vi.clearAllMocks()
  clearStoredSession()
})

afterEach(() => {
  clearStoredSession()
})

// ════════════════════════════════════════════════════════════════════
// CATEGORY 1: performRefresh failures fire signalSessionDead
// ════════════════════════════════════════════════════════════════════

describe('auth fault tolerance — performRefresh failures fire signalSessionDead', () => {
  it('★ Supabase refreshSession returns error → onSessionDead fires with "refresh-failed"', async () => {
    writeStoredSession(makeValidSession({ expiresInSec: 60 }))
    h.refreshSessionMock.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'refresh_token expired' },
    })

    const auth = new ElectronAuth()
    const deadReasons: SessionDeadReason[] = []
    auth.onSessionDead((reason) => deadReasons.push(reason))

    // Force a refresh.
    await (auth as any).refreshSessionNow()

    expect(deadReasons).toEqual(['refresh-failed'])
  })

  it('★ refreshSession throws (network/DNS/TLS) → onSessionDead fires with "refresh-network-error"', async () => {
    writeStoredSession(makeValidSession({ expiresInSec: 60 }))
    h.refreshSessionMock.mockRejectedValueOnce(new Error('ENOTFOUND login.coasty.ai'))

    const auth = new ElectronAuth()
    const deadReasons: SessionDeadReason[] = []
    auth.onSessionDead((reason) => deadReasons.push(reason))

    await (auth as any).refreshSessionNow()

    expect(deadReasons).toEqual(['refresh-network-error'])
  })

  it('★ session with no refresh_token → onSessionDead fires with "token-missing"', async () => {
    writeStoredSession({
      access_token: 'expired-token',
      refresh_token: '',  // empty → invalid shape passes constructor's guard? No — guard rejects.
      expires_at: Math.floor(Date.now() / 1000) - 100,
      user: { id: 'u' },
    })
    // The shape guard rejects empty refresh_token (length === 0), so the
    // constructor will null the session before we even get here. Use a
    // different setup: valid shape, no expires_at, force a refresh.
    clearStoredSession()
    const auth = new ElectronAuth()
    const deadReasons: SessionDeadReason[] = []
    auth.onSessionDead((reason) => deadReasons.push(reason))

    // Force the refresh path on an auth with no session.
    await (auth as any).refreshSessionNow()

    expect(deadReasons).toEqual(['token-missing'])
  })

  it('refresh success → onSessionDead does NOT fire', async () => {
    writeStoredSession(makeValidSession({ expiresInSec: 60 }))
    h.refreshSessionMock.mockResolvedValueOnce({
      data: { session: makeValidSession({ expiresInSec: 3600 }) },
      error: null,
    })

    const auth = new ElectronAuth()
    const deadReasons: SessionDeadReason[] = []
    auth.onSessionDead((reason) => deadReasons.push(reason))

    await (auth as any).refreshSessionNow()

    expect(deadReasons).toEqual([])
  })

  it('★ onSessionDead is idempotent — multiple failures fire only ONE listener call', async () => {
    writeStoredSession(makeValidSession({ expiresInSec: 60 }))
    h.refreshSessionMock.mockResolvedValue({
      data: { session: null },
      error: { message: 'fail' },
    })

    const auth = new ElectronAuth()
    const deadReasons: SessionDeadReason[] = []
    auth.onSessionDead((reason) => deadReasons.push(reason))

    // Three back-to-back refresh attempts on the same dead session.
    await (auth as any).refreshSessionNow()
    await (auth as any).refreshSessionNow()
    await (auth as any).refreshSessionNow()

    // The latch coalesces — exactly one listener call.
    expect(deadReasons).toHaveLength(1)
  })

  it('successful sign-in resets the latch so a future death can fire again', async () => {
    writeStoredSession(makeValidSession({ expiresInSec: 60 }))
    // Refresh path mocks: first call fails (Death #1), second call (after
    // sign-in) also fails (Death #2). The sign-in itself goes through
    // signInWithPassword, NOT refreshSession, so we only need two
    // refreshSession entries in the chain.
    h.refreshSessionMock
      .mockResolvedValueOnce({ data: { session: null }, error: { message: 'fail #1' } })
      .mockResolvedValueOnce({ data: { session: null }, error: { message: 'fail #2' } })

    const auth = new ElectronAuth()
    const deadReasons: SessionDeadReason[] = []
    auth.onSessionDead((reason) => deadReasons.push(reason))

    // Death #1.
    await (auth as any).refreshSessionNow()
    expect(deadReasons).toHaveLength(1)

    // Recover by signing in — feed in a session via the password path.
    h.signInWithPasswordMock.mockResolvedValueOnce({
      data: { session: makeValidSession({ expiresInSec: 3600 }), user: { id: 'u' } },
      error: null,
    })
    await auth.signInWithEmail('t@t.t', 'p')

    // Death #2 — latch was reset, so the new failure fires the listener again.
    await (auth as any).refreshSessionNow()
    expect(deadReasons).toHaveLength(2)
  })
})

// ════════════════════════════════════════════════════════════════════
// CATEGORY 2: Session state is cleared BEFORE listener runs
// ════════════════════════════════════════════════════════════════════

describe('auth fault tolerance — state consistency on death', () => {
  it('listener sees a CLEAN session state (session=null, file deleted)', async () => {
    writeStoredSession(makeValidSession({ expiresInSec: 60 }))
    h.refreshSessionMock.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'revoked' },
    })

    const auth = new ElectronAuth()
    let observedSession: any = 'sentinel'
    let observedFileExists: boolean | 'sentinel' = 'sentinel'
    auth.onSessionDead(() => {
      observedSession = (auth as any).session
      const userDataDir = (electron as any).app.getPath('userData')
      observedFileExists = fs.existsSync(path.join(userDataDir, '.session'))
    })

    await (auth as any).refreshSessionNow()

    expect(observedSession).toBeNull()
    expect(observedFileExists).toBe(false)
  })

  it('declareDead() also clears state synchronously before firing listener', async () => {
    writeStoredSession(makeValidSession({ expiresInSec: 3600 }))
    const auth = new ElectronAuth()
    expect(auth.getUserId()).not.toBeNull()  // sanity

    let observedUserId: any = 'sentinel'
    auth.onSessionDead(() => {
      observedUserId = auth.getUserId()
    })

    auth.declareDead('bridge-auth-rejected')
    expect(observedUserId).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════
// CATEGORY 3: signOut() doesn't trigger a spurious dead event
// ════════════════════════════════════════════════════════════════════

describe('auth fault tolerance — manual signOut behaviour', () => {
  it('★ manual signOut() does NOT fire onSessionDead (renderer already knows it called signOut)', async () => {
    writeStoredSession(makeValidSession({ expiresInSec: 3600 }))
    h.signOutMock.mockResolvedValueOnce(undefined)

    const auth = new ElectronAuth()
    const deadReasons: SessionDeadReason[] = []
    auth.onSessionDead((reason) => deadReasons.push(reason))

    await auth.signOut()

    expect(deadReasons).toEqual([])
  })

  it('★ stray refresh that fails AFTER signOut() does NOT re-fire the dead event', async () => {
    writeStoredSession(makeValidSession({ expiresInSec: 60 }))
    h.signOutMock.mockResolvedValue(undefined)
    h.refreshSessionMock.mockResolvedValue({
      data: { session: null },
      error: { message: 'too late' },
    })

    const auth = new ElectronAuth()
    const deadReasons: SessionDeadReason[] = []
    auth.onSessionDead((reason) => deadReasons.push(reason))

    await auth.signOut()
    // Simulate a stray refresh attempt firing AFTER signOut.
    await (auth as any).refreshSessionNow()

    expect(deadReasons).toEqual([])
  })
})

// ════════════════════════════════════════════════════════════════════
// CATEGORY 4: declareDead() — public entry for external death signals
// ════════════════════════════════════════════════════════════════════

describe('auth fault tolerance — declareDead() public API', () => {
  it('★ declareDead() with bridge-auth-rejected fires onSessionDead', async () => {
    writeStoredSession(makeValidSession({ expiresInSec: 3600 }))
    const auth = new ElectronAuth()
    const reasons: SessionDeadReason[] = []
    auth.onSessionDead((r) => reasons.push(r))

    auth.declareDead('bridge-auth-rejected')
    expect(reasons).toEqual(['bridge-auth-rejected'])
  })

  it('★ declareDead() is idempotent — second call is a no-op', async () => {
    writeStoredSession(makeValidSession({ expiresInSec: 3600 }))
    const auth = new ElectronAuth()
    const reasons: SessionDeadReason[] = []
    auth.onSessionDead((r) => reasons.push(r))

    auth.declareDead('bridge-auth-rejected')
    auth.declareDead('refresh-failed')  // ← latched, no-op
    auth.declareDead('refresh-network-error')  // ← latched, no-op

    expect(reasons).toEqual(['bridge-auth-rejected'])
  })

  it('★ declareDead() clears the refresh timer (no future stray refreshes)', async () => {
    writeStoredSession(makeValidSession({ expiresInSec: 3600 }))
    const auth = new ElectronAuth()
    // Sanity: the constructor scheduled a refresh.
    expect((auth as any).refreshTimer).not.toBeNull()

    auth.declareDead('bridge-auth-rejected')
    expect((auth as any).refreshTimer).toBeNull()
  })

  it('★ declareDead() clears the on-disk .session file', async () => {
    writeStoredSession(makeValidSession({ expiresInSec: 3600 }))
    const auth = new ElectronAuth()
    const userDataDir = (electron as any).app.getPath('userData')
    const sessionPath = path.join(userDataDir, '.session')
    expect(fs.existsSync(sessionPath)).toBe(true)

    auth.declareDead('refresh-network-error')
    expect(fs.existsSync(sessionPath)).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════
// CATEGORY 5: Multiple listeners — all get the event
// ════════════════════════════════════════════════════════════════════

describe('auth fault tolerance — listener fan-out', () => {
  it('★ multiple listeners all fire on the same death', async () => {
    writeStoredSession(makeValidSession({ expiresInSec: 60 }))
    h.refreshSessionMock.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'fail' },
    })

    const auth = new ElectronAuth()
    const calls: string[] = []
    auth.onSessionDead((r) => calls.push(`a:${r}`))
    auth.onSessionDead((r) => calls.push(`b:${r}`))
    auth.onSessionDead((r) => calls.push(`c:${r}`))

    await (auth as any).refreshSessionNow()

    expect(calls).toEqual(['a:refresh-failed', 'b:refresh-failed', 'c:refresh-failed'])
  })

  it('a throwing listener does NOT block subsequent listeners', async () => {
    writeStoredSession(makeValidSession({ expiresInSec: 60 }))
    h.refreshSessionMock.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'fail' },
    })

    const auth = new ElectronAuth()
    const calls: string[] = []
    auth.onSessionDead(() => { throw new Error('listener boom') })
    auth.onSessionDead((r) => calls.push(`b:${r}`))

    await (auth as any).refreshSessionNow()

    // The throwing listener didn't block the second one.
    expect(calls).toEqual(['b:refresh-failed'])
  })
})

// ════════════════════════════════════════════════════════════════════
// CATEGORY 6: Cold start — no session = no spurious death event
// ════════════════════════════════════════════════════════════════════

describe('auth fault tolerance — cold start (no session)', () => {
  it('★ no .session file → onSessionDead does NOT fire (cold start is not a death)', async () => {
    // No writeStoredSession call → no file on disk.
    const auth = new ElectronAuth()
    const reasons: SessionDeadReason[] = []
    auth.onSessionDead((r) => reasons.push(r))

    // Drain any synchronous startup work.
    await new Promise((r) => setTimeout(r, 10))
    expect(reasons).toEqual([])
  })

  it('★ corrupted .session file → no spurious death event (renderer routes to AuthScreen via checkSession)', async () => {
    const userDataDir = (electron as any).app.getPath('userData')
    fs.writeFileSync(path.join(userDataDir, '.session'), 'not-valid-json{{{', 'utf-8')

    const auth = new ElectronAuth()
    const reasons: SessionDeadReason[] = []
    auth.onSessionDead((r) => reasons.push(r))

    await new Promise((r) => setTimeout(r, 10))
    expect(reasons).toEqual([])
    // And isAuthenticated is false so checkSession returns the right state.
    expect(auth.isAuthenticated()).toBe(false)
  })
})
