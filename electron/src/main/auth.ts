import { createClient, SupabaseClient, Session, User } from '@supabase/supabase-js'
import { app, shell } from 'electron'
import * as http from 'http'
import * as url from 'url'
import * as crypto from 'crypto'
import * as path from 'path'
import * as fs from 'fs'

// ── Shared HTML templates for the local callback server ──────────────────

const SUCCESS_HTML = `
<html>
  <head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:#0a0a0a;color:#fff;padding:40px 20px}
    .card{text-align:center;display:flex;flex-direction:column;align-items:center;gap:20px;max-width:480px;opacity:0;animation:slideUp .6s cubic-bezier(.22,1,.36,1) forwards}
    .logo{width:40px;height:40px}
    .check{width:36px;height:36px;border-radius:50%;background:rgba(16,185,129,.12);display:flex;align-items:center;justify-content:center}
    .check svg{width:20px;height:20px;color:#10b981}
    h2{font-size:20px;font-weight:600;letter-spacing:-.02em;margin:0}
    p{font-size:13px;color:#737373;line-height:1.6;margin:0}
    .demo{width:100%;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,.08);margin:4px 0;opacity:0;animation:fadeIn .8s ease .3s forwards}
    .demo img{width:100%;display:block}
    .hints{display:flex;flex-direction:column;gap:8px;width:100%}
    .hint{display:flex;align-items:center;gap:10px;padding:10px 16px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06)}
    .hint svg{flex-shrink:0;color:#a3a3a3;width:16px;height:16px}
    .hint span{font-size:12px;color:#a3a3a3;text-align:left}
    @keyframes slideUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
    @keyframes fadeIn{from{opacity:0}to{opacity:1}}
  </style></head>
  <body>
    <div class="card">
      <svg class="logo" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="g" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="rgba(255,255,255,0)"/>
          <stop offset="30%" stop-color="rgba(255,255,255,.1)"/>
          <stop offset="50%" stop-color="rgba(255,255,255,.3)"/>
          <stop offset="70%" stop-color="rgba(255,255,255,.6)"/>
          <stop offset="100%" stop-color="#fff"/>
        </linearGradient></defs>
        <circle cx="100" cy="100" r="100" fill="url(#g)"/>
      </svg>
      <div class="check">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <div>
        <h2>You're all set</h2>
        <p>You can close this tab. Coasty is ready on your desktop.</p>
      </div>
      <div class="demo">
        <img src="https://coasty.ai/demo-screenshot-mobile.png" alt="Coasty Desktop" loading="eager" onerror="this.onerror=null;this.src='https://coasty.ai/demo-screenshot.png'" />
      </div>
      <div class="hints">
        <div class="hint">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><polyline points="12 5 19 12 12 19"/></svg>
          <span>Type a task in the floating pill on your desktop and you're done.</span>
        </div>
        <div class="hint">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
          <span>You can also remote-control your computer from your phone at <strong style="color:#e5e5e5">coasty.ai</strong></span>
        </div>
      </div>
    </div>
    <script>
      // After a short delay so the user can read the success message:
      // 1. Try to close the tab (works if browser allows it)
      // 2. If blocked, redirect to the branded site so the address bar
      //    shows coasty.ai instead of 127.0.0.1
      setTimeout(function(){
        window.close();
        setTimeout(function(){ window.location.href='https://coasty.ai'; }, 400);
      }, 2500);
    </script>
  </body>
</html>`

function errorHtml(message: string): string {
  return `<html><head><style>*{margin:0;padding:0}body{display:flex;justify-content:center;align-items:center;height:100vh;font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;background:#0a0a0a;color:#fff}.c{text-align:center;display:flex;flex-direction:column;align-items:center;gap:16px}p{font-size:13px;color:#a3a3a3}h2{font-size:16px;font-weight:600;color:#f87171}</style></head><body><div class="c"><h2>Something went wrong</h2><p>${message}</p></div></body></html>`
}

// ── ElectronAuth class ───────────────────────────────────────────────────

/**
 * Reasons a session can transition from "valid" to "permanently dead".
 *
 * Every value here represents a failure mode where the right
 * production-grade response is to sign the user out and surface a
 * fresh sign-in screen. The renderer reads the reason verbatim to
 * decide whether to log telemetry, show a different toast, etc.
 *
 * Why this enum exists
 * --------------------
 * The pre-refactor auth layer had FIVE silent failure modes where
 * the session was cleared in memory but no caller was told:
 *   - performRefresh() failure → `session = null` + void return
 *   - scheduled-refresh failure → logged + void return
 *   - getAccessToken() falling back to null → caller might use it or not
 *   - OAuth callback timeout → only the awaiting IPC caller knew
 *   - bridge auth_failed → only the WS bridge knew (via state)
 *
 * Each silent path left the renderer thinking "still authenticated"
 * while every downstream IPC call would 401. The user saw "the app
 * keeps failing" with no understanding that their session was dead.
 *
 * Now every failure path calls ``signalSessionDead(reason)`` which
 * fans out to all registered listeners — main-process broadcasts to
 * the renderer, renderer auto-signs-out, done.
 */
export type SessionDeadReason =
  | 'refresh-failed'         // Supabase refreshSession() returned error or no session
  | 'refresh-network-error'  // refreshSession() threw (offline, DNS, etc.)
  | 'scheduled-refresh-failed' // background refresh fired and failed
  | 'oauth-timeout'          // user never completed the sign-in flow
  | 'bridge-auth-rejected'   // backend WS bridge said the JWT is invalid
  | 'token-missing'          // a caller asked for a token and nothing was stored
  | 'manual'                 // user clicked sign-out (still fired for symmetry)

export class ElectronAuth {
  private supabase: SupabaseClient
  private session: Session | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private refreshPromise: Promise<void> | null = null
  private pendingCallbackServer: http.Server | null = null
  private pendingSessionPromise: Promise<{ user: User; session: Session }> | null = null
  private tokenRefreshListeners: Array<(token: string) => void> = []
  /** Subscribers fired exactly once per session-death event. The
   *  main process registers a listener that broadcasts to the
   *  renderer via IPC, which auto-signs out the UI. */
  private sessionDeadListeners: Array<(reason: SessionDeadReason) => void> = []
  /** Latched so we never fire ``onSessionDead`` twice for the same
   *  dead session (e.g. both refresh-failed AND scheduled-refresh-failed
   *  could land on the same already-dead session). Cleared when a new
   *  session is set. */
  private sessionDeadFired = false
  // Protocol-based OAuth state (used in packaged builds instead of local HTTP server)
  private protocolAuthResolve: ((result: { user: User; session: Session }) => void) | null = null
  private protocolAuthReject: ((error: Error) => void) | null = null
  private protocolAuthTimeout: ReturnType<typeof setTimeout> | null = null

  constructor() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

    if (!supabaseUrl || !supabaseAnonKey) {
      console.warn('[Auth] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY not set in .env')
    }

    this.supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        flowType: 'pkce',
      },
    })
    this.loadStoredSession()
  }

  // ── Shared callback server ─────────────────────────────────────────────
  // Starts a local HTTP server that captures Supabase auth tokens from browser redirects.
  // Used by Google OAuth, email sign-up confirmation, and magic link flows.

  private startCallbackServer(timeoutMs: number = 5 * 60 * 1000): Promise<{
    redirectUrl: string
    sessionPromise: Promise<{ user: User; session: Session }>
  }> {
    // Cancel any previous pending auth flow
    this.cancelPendingAuth()

    // Generate a cryptographic nonce for CSRF / replay protection.
    // Only requests whose URL path contains this nonce are accepted,
    // which prevents other local processes from injecting tokens into
    // our ephemeral callback server.
    const nonce = crypto.randomBytes(32).toString('hex')

    return new Promise((resolveSetup, rejectSetup) => {
      const server = http.createServer()
      this.pendingCallbackServer = server

      server.on('error', (err) => {
        this.pendingCallbackServer = null
        rejectSetup(err)
      })

      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number }
        // Nonce embedded in the callback path — Supabase redirects the browser
        // here with tokens in the URL fragment (never sent to the server).
        const redirectUrl = `http://127.0.0.1:${addr.port}/auth/callback/${nonce}`

        const sessionPromise = new Promise<{ user: User; session: Session }>((resolve, reject) => {
          // Guard against double-resolution (e.g. browser retry or timeout vs. success race)
          let settled = false
          const finish = (fn: typeof resolve | typeof reject, value: any): void => {
            if (settled) return
            settled = true
            this.pendingCallbackServer = null
            server.close()
            fn(value)
          }

          server.on('request', async (req, res) => {
            const parsed = url.parse(req.url || '', true)

            // PKCE flow: the auth code arrives as a ?code= query parameter
            // on the GET request — no JavaScript fragment extraction needed.
            if (req.method === 'GET' && parsed.pathname === `/auth/callback/${nonce}`) {
              const code = parsed.query.code as string | undefined

              if (!code) {
                res.writeHead(400, {
                  'Content-Type': 'text/html',
                  'Cache-Control': 'no-store',
                })
                res.end(errorHtml('No authorization code received. Please try again.'))
                finish(reject, new Error('No authorization code in callback'))
                return
              }

              try {
                const { data, error } = await this.supabase.auth.exchangeCodeForSession(code)

                if (error || !data.session || !data.user) {
                  res.writeHead(500, { 'Content-Type': 'text/html' })
                  res.end(errorHtml('Authentication failed. Please close this tab and try again.'))
                  finish(reject, error || new Error('No session returned'))
                  return
                }

                this.session = data.session
                this.sessionDeadFired = false  // reset latch — fresh session can die again later
                this.storeSession(data.session)
                this.scheduleRefresh(data.session)

                res.writeHead(200, { 'Content-Type': 'text/html' })
                res.end(SUCCESS_HTML)
                finish(resolve, { user: data.user, session: data.session })
              } catch (err) {
                res.writeHead(500, { 'Content-Type': 'text/html' })
                res.end(errorHtml('Something went wrong. Please close this tab and try again.'))
                finish(reject, err)
              }
              return
            }

            // Reject all other requests (wrong nonce, path, or method)
            res.writeHead(404, { 'Content-Type': 'text/plain' })
            res.end('Not Found')
          })

          // Timeout — clean up if the user never completes auth
          setTimeout(() => {
            finish(reject, new Error('Authentication timed out'))
          }, timeoutMs)
        })

        resolveSetup({ redirectUrl, sessionPromise })
      })
    })
  }

  /** Cancel any pending auth flow (sign-up waiting for confirmation, magic link, etc.) */
  cancelPendingAuth(): void {
    if (this.pendingCallbackServer) {
      this.pendingCallbackServer.close()
      this.pendingCallbackServer = null
      console.log('[Auth] Pending auth flow cancelled')
    }
    this.cleanupProtocolAuth()
  }

  /**
   * Release all background resources owned by this instance.
   *
   * Called during app shutdown to tear down the token-refresh timer, any
   * in-flight OAuth/magic-link callback server, and registered token-refresh
   * listeners. Safe to call multiple times.
   */
  dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
    this.refreshPromise = null
    this.cancelPendingAuth()
    this.tokenRefreshListeners = []
  }

  // ── Auth methods ───────────────────────────────────────────────────────

  async signInWithGoogle(): Promise<{ user: User; session: Session }> {
    // Packaged builds: use coasty:// deep link so the browser never shows 127.0.0.1
    if (app.isPackaged) {
      return this.signInWithProtocol('google')
    }
    // Dev builds: custom protocol isn't registered reliably, use local HTTP server
    const { redirectUrl, sessionPromise } = await this.startCallbackServer(5 * 60 * 1000)

    const { data, error } = await this.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
        skipBrowserRedirect: true,
      },
    })

    if (error || !data.url) {
      this.cancelPendingAuth()
      throw error || new Error('Failed to get OAuth URL')
    }

    shell.openExternal(data.url)
    return sessionPromise
  }

  // ── Deep-link (custom protocol) OAuth ─────────────────────────────────
  // In packaged builds the redirect URL is coasty://auth/callback which
  // triggers the OS to open the app instead of navigating to localhost.
  // With PKCE the auth code arrives as a ?code= query parameter (not a
  // URL fragment), so it's reliably passed through on all platforms.

  private async signInWithProtocol(provider: 'google'): Promise<{ user: User; session: Session }> {
    this.cancelPendingAuth()

    // Redirect to the web app's intermediate callback page instead of directly
    // to coasty://. The web page triggers the custom protocol and shows a
    // "You can close this tab" message — preventing the browser from being
    // stuck on a blank/loading page after the protocol handoff.
    const webCallbackUrl = (process.env.COASTY_WEB_URL || 'https://coasty.ai') + '/auth/desktop-callback'

    const { data, error } = await this.supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: webCallbackUrl,
        skipBrowserRedirect: true,
      },
    })

    if (error || !data.url) {
      throw error || new Error('Failed to get OAuth URL')
    }

    return new Promise<{ user: User; session: Session }>((resolve, reject) => {
      this.protocolAuthResolve = resolve
      this.protocolAuthReject = reject

      // Timeout after 5 minutes
      this.protocolAuthTimeout = setTimeout(() => {
        this.cleanupProtocolAuth()
        reject(new Error('Authentication timed out'))
      }, 5 * 60 * 1000)

      shell.openExternal(data.url)
    })
  }

  /** Handle a coasty:// protocol callback URL (called from main process). */
  async handleProtocolCallback(callbackUrl: string): Promise<void> {
    try {
      const parsed = new URL(callbackUrl)
      const code = parsed.searchParams.get('code')

      if (!code) {
        console.error('[Auth] Protocol callback missing auth code:', callbackUrl)
        this.protocolAuthReject?.(new Error('No authorization code in callback'))
        this.cleanupProtocolAuth()
        return
      }

      console.log('[Auth] Exchanging protocol auth code for session...')
      const { data, error } = await this.supabase.auth.exchangeCodeForSession(code)

      if (error || !data.session || !data.user) {
        console.error('[Auth] Code exchange failed:', error?.message)
        this.protocolAuthReject?.(error || new Error('Failed to exchange code for session'))
        this.cleanupProtocolAuth()
        return
      }

      this.session = data.session
      this.sessionDeadFired = false  // reset latch — fresh session can die again later
      this.storeSession(data.session)
      this.scheduleRefresh(data.session)

      console.log('[Auth] Protocol auth succeeded')
      this.protocolAuthResolve?.({ user: data.user, session: data.session })
      this.cleanupProtocolAuth()
    } catch (err: any) {
      console.error('[Auth] Protocol callback error:', err.message)
      this.protocolAuthReject?.(err)
      this.cleanupProtocolAuth()
    }
  }

  private cleanupProtocolAuth(): void {
    if (this.protocolAuthTimeout) {
      clearTimeout(this.protocolAuthTimeout)
      this.protocolAuthTimeout = null
    }
    this.protocolAuthResolve = null
    this.protocolAuthReject = null
  }

  async signUpWithEmail(email: string, password: string): Promise<{ user: User; session: Session }> {
    // Start local server first so we have a redirect URL for the confirmation email
    const { redirectUrl, sessionPromise } = await this.startCallbackServer(10 * 60 * 1000)

    const { data, error } = await this.supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
      },
    })

    if (error) {
      this.cancelPendingAuth()
      throw error
    }

    // If identities is empty, the email is already registered
    if (data?.user?.identities?.length === 0) {
      this.cancelPendingAuth()
      throw new Error('An account with this email already exists.')
    }

    // Wait for the user to click the confirmation link in their email.
    // When they do, their browser redirects to our local server → tokens captured → session set.
    return sessionPromise
  }

  async signInWithEmail(email: string, password: string): Promise<{ user: User; session: Session }> {
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) throw error

    if (!data.session || !data.user) {
      throw new Error('No session returned')
    }

    this.session = data.session
    this.sessionDeadFired = false  // reset latch — fresh session can die again later
    this.storeSession(data.session)
    this.scheduleRefresh(data.session)

    return { user: data.user, session: data.session }
  }

  /** Phase 1: Send the magic link OTP. Returns quickly with success or throws on error. */
  async sendMagicLink(email: string): Promise<void> {
    const { redirectUrl, sessionPromise } = await this.startCallbackServer(10 * 60 * 1000)

    const { error } = await this.supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectUrl,
        shouldCreateUser: false,
      },
    })

    if (error) {
      this.cancelPendingAuth()
      throw error
    }

    // OTP sent successfully — store the session promise for phase 2
    this.pendingSessionPromise = sessionPromise
  }

  /** Phase 2: Wait for the user to click the magic link (long-running). */
  async awaitMagicLinkSession(): Promise<{ user: User; session: Session }> {
    if (!this.pendingSessionPromise) {
      throw new Error('No pending magic link session')
    }
    try {
      const result = await this.pendingSessionPromise
      return result
    } finally {
      this.pendingSessionPromise = null
    }
  }

  async resetPassword(email: string): Promise<void> {
    const { error } = await this.supabase.auth.resetPasswordForEmail(email)
    if (error) throw error
    // User resets password in the browser, then signs in with new password in Electron.
  }

  // ── Session management ─────────────────────────────────────────────────

  async getSession(): Promise<Session | null> {
    if (this.session && !this.isAuthenticated() && this.session.refresh_token) {
      await this.refreshSessionNow()
    }
    return this.session
  }

  async getAccessToken(): Promise<string | null> {
    // Refresh expired tokens before returning — mirrors getSession() logic
    if (this.session && !this.isAuthenticated() && this.session.refresh_token) {
      await this.refreshSessionNow()
    }
    return this.session?.access_token || null
  }

  /** Expose the authenticated Supabase client for direct DB queries.
   *  Ensures the client has a valid session set before returning. */
  async getSupabaseClient(): Promise<SupabaseClient> {
    // Make sure the client has the current session's JWT
    if (this.session?.access_token) {
      await this.supabase.auth.setSession({
        access_token: this.session.access_token,
        refresh_token: this.session.refresh_token,
      })
    }
    return this.supabase
  }

  getUserId(): string | null {
    return this.session?.user?.id || null
  }

  getUserEmail(): string | null {
    return this.session?.user?.email || null
  }

  getUserName(): string | null {
    return this.session?.user?.user_metadata?.full_name || null
  }

  getUserAvatar(): string | null {
    return this.session?.user?.user_metadata?.avatar_url || null
  }

  async signOut(): Promise<void> {
    this.cancelPendingAuth()
    this.session = null
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
    this.clearStoredSession()
    // Latch sessionDeadFired so any in-flight refresh that fails
    // AFTER the user clicked sign-out doesn't redundantly fire the
    // session-died event back to a renderer that already knows.
    this.sessionDeadFired = true
    try {
      await this.supabase.auth.signOut()
    } catch {
      // Ignore sign-out errors
    }
  }

  isAuthenticated(): boolean {
    if (!this.session) return false
    const expiresAt = this.session.expires_at
    if (expiresAt && Date.now() / 1000 > expiresAt) {
      return false
    }
    return true
  }

  /** Register a callback that fires whenever the access token is refreshed. */
  onTokenRefresh(listener: (token: string) => void): void {
    this.tokenRefreshListeners.push(listener)
  }

  private notifyTokenRefresh(token: string): void {
    for (const listener of this.tokenRefreshListeners) {
      try { listener(token) } catch { /* ignore listener errors */ }
    }
  }

  /**
   * Register a callback that fires when the session has died and the
   * user MUST be signed out. The main process uses this to broadcast
   * an IPC event to the renderer so the UI returns to the AuthScreen.
   *
   * Callbacks are called at most once per session-death (the
   * ``sessionDeadFired`` latch prevents double-firing on cascading
   * failures — e.g. a refresh failure followed by a scheduled-refresh
   * failure on the same dead session).
   */
  onSessionDead(listener: (reason: SessionDeadReason) => void): void {
    this.sessionDeadListeners.push(listener)
  }

  /**
   * Public entry point for declaring the session dead from OUTSIDE
   * the auth layer. Used by the WS bridge's fatal-auth callback +
   * IPC handlers that receive a null token. Always tears down the
   * in-memory session + on-disk state before notifying listeners
   * so a fast follow-up ``getAccessToken()`` call from another
   * subsystem can't accidentally surface stale credentials.
   *
   * Idempotent — the ``sessionDeadFired`` latch coalesces multiple
   * declarations into a single renderer-facing event.
   */
  declareDead(reason: SessionDeadReason): void {
    if (this.sessionDeadFired) return
    // Tear down state BEFORE notifying so listeners see a consistent
    // post-death state (session=null, no refresh timer pending).
    this.session = null
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
    this.clearStoredSession()
    this.signalSessionDead(reason)
  }

  /**
   * Internal: declare the session dead. Idempotent per session.
   * Every callsite that observes an auth failure MUST call this
   * before returning. Production-grade fault tolerance means failures
   * never sit silently — they always surface to the UI as a
   * sign-out.
   */
  private signalSessionDead(reason: SessionDeadReason): void {
    if (this.sessionDeadFired) return
    this.sessionDeadFired = true
    console.warn(`[Auth] Session declared dead: reason="${reason}"`)
    for (const listener of this.sessionDeadListeners) {
      try { listener(reason) } catch (err) {
        console.error('[Auth] sessionDead listener threw:', err)
      }
    }
  }

  getMachineId(): string {
    const userId = this.getUserId() || 'unknown'
    const hostname = require('os').hostname()
    const username = require('os').userInfo().username
    const platform = process.platform
    const name = `electron-${userId}-${hostname}-${username}-${platform}`
    return uuidv5FromName(name)
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private getSessionPath(): string {
    return path.join(app.getPath('userData'), '.session')
  }

  private storeSession(session: Session): void {
    try {
      const json = JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
        user: session.user,
      })

      const sessionPath = this.getSessionPath()

      fs.writeFileSync(sessionPath, json, { encoding: 'utf-8', mode: 0o600 })
      // Defend against pre-existing files with looser permissions on POSIX —
      // writeFileSync's `mode` only applies on file creation. chmod is a no-op
      // semantically on Windows but errors out cleanly there, so guard it.
      if (process.platform !== 'win32') {
        try {
          fs.chmodSync(sessionPath, 0o600)
        } catch (chmodErr) {
          console.warn('[Auth] Failed to chmod 0600 on session file:', chmodErr)
        }
      }
      console.log('[Auth] Session saved to disk')
    } catch (err) {
      console.error('[Auth] Failed to store session:', err)
    }
  }

  private loadStoredSession(): void {
    try {
      const sessionPath = this.getSessionPath()
      if (!fs.existsSync(sessionPath)) return

      const raw = fs.readFileSync(sessionPath)
      let json: string

      json = raw.toString('utf-8')

      const data = JSON.parse(json)

      // Runtime shape guard — guard against tampered / malformed session files.
      // Without this, a non-conforming JSON value (string, array, or an object
      // missing required fields) would be cast straight to Session and could
      // confuse downstream isAuthenticated() / refresh logic.
      const isValidStoredSession = (d: unknown): d is Session => {
        return (
          typeof d === 'object' &&
          d !== null &&
          typeof (d as any).access_token === 'string' && (d as any).access_token.length > 0 &&
          typeof (d as any).refresh_token === 'string' && (d as any).refresh_token.length > 0 &&
          ((d as any).expires_at === undefined || typeof (d as any).expires_at === 'number') &&
          (d as any).user !== null && typeof (d as any).user === 'object'
        )
      }

      if (!isValidStoredSession(data)) {
        console.warn('[Auth] Stored session has invalid shape, clearing')
        this.session = null
        this.clearStoredSession()
        return
      }

      this.session = data as Session

      if (this.isAuthenticated()) {
        console.log('[Auth] Restored valid session from disk')
        // Reset the death latch — we have a fresh-looking session.
        this.sessionDeadFired = false
        // Set the session on the Supabase client so RLS-protected queries work.
        // Without this, the client has no JWT and all DB queries fail with RLS errors.
        this.supabase.auth.setSession({
          access_token: this.session!.access_token,
          refresh_token: this.session!.refresh_token,
        }).catch((err) => {
          console.error('[Auth] Failed to set restored session on Supabase client:', err)
        })
        this.scheduleRefresh(this.session!)
      } else if (this.session?.refresh_token) {
        console.log('[Auth] Access token expired, refreshing eagerly...')
        // Refresh immediately instead of deferring — getAccessToken() callers
        // need a valid token and the old "lazy refresh on getSession()" approach
        // left the token stale since nothing called getSession().
        // performRefresh() will signal session-dead on failure.
        this.refreshSessionNow().catch((err) => {
          console.error('[Auth] Eager refresh failed:', err)
        })
      } else {
        // Stored session has no refresh_token (malformed write or
        // partial corruption). Can't recover from this on disk; the
        // renderer's ``checkSession`` IPC will report
        // ``isAuthenticated: false`` and the UI routes to the
        // AuthScreen naturally — no need to fire signalSessionDead
        // here because there's no LIVE session to declare dead
        // (the user was never signed in this session).
        console.log('[Auth] Stored session fully expired, clearing')
        this.session = null
        this.clearStoredSession()
      }
    } catch (err) {
      console.error('[Auth] Failed to load stored session:', err)
      this.session = null
    }
  }

  private clearStoredSession(): void {
    try {
      const sessionPath = this.getSessionPath()
      if (fs.existsSync(sessionPath)) {
        fs.unlinkSync(sessionPath)
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Mutex-guarded token refresh. If a refresh is already in-flight, all
   * concurrent callers share the same promise instead of racing against
   * each other (which could revoke a just-issued refresh token).
   */
  private async refreshSessionNow(): Promise<void> {
    if (this.refreshPromise) {
      return this.refreshPromise
    }

    this.refreshPromise = this.performRefresh()
    try {
      await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  /** The actual refresh logic — only called via refreshSessionNow(). */
  private async performRefresh(): Promise<void> {
    if (!this.session?.refresh_token) {
      // No refresh token to use — session is unrecoverable.
      this.session = null
      this.clearStoredSession()
      this.signalSessionDead('token-missing')
      return
    }

    console.log('[Auth] Refreshing expired access token...')
    try {
      const { data, error } = await this.supabase.auth.refreshSession({
        refresh_token: this.session.refresh_token,
      })

      if (error || !data.session) {
        // Refresh returned but Supabase says the token can't be
        // refreshed (revoked, user deleted, etc.). The session is
        // permanently dead — sign the user out.
        console.error('[Auth] Refresh failed:', error?.message || 'No session returned')
        this.session = null
        this.clearStoredSession()
        this.signalSessionDead('refresh-failed')
        return
      }

      // Success path — new session, reset everything.
      this.session = data.session
      this.sessionDeadFired = false  // a fresh session can die again later
      this.storeSession(data.session)
      this.scheduleRefresh(data.session)
      this.notifyTokenRefresh(data.session.access_token)
      console.log('[Auth] Token refreshed successfully')
    } catch (err: any) {
      // Network error, DNS failure, TLS handshake error, etc. We
      // can't tell whether the token would refresh on retry, but
      // the user is currently in a broken state — sign them out so
      // they can re-authenticate cleanly when the network comes back.
      console.error('[Auth] Refresh error:', err.message)
      this.session = null
      this.clearStoredSession()
      this.signalSessionDead('refresh-network-error')
    }
  }

  private scheduleRefresh(session: Session): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }

    const expiresAt = session.expires_at
    if (!expiresAt) return

    const refreshIn = Math.max((expiresAt - Date.now() / 1000 - 300) * 1000, 10000)

    this.refreshTimer = setTimeout(() => {
      // Use the mutex-guarded refreshSessionNow() so a scheduled refresh
      // and an on-demand refresh from getSession()/getAccessToken() never
      // race each other.
      this.refreshSessionNow().catch((err) => {
        console.error('[Auth] Scheduled refresh error:', err)
        // Even if performRefresh's own catch fired signalSessionDead,
        // a synchronous throw inside refreshSessionNow's microtask
        // bookkeeping could escape past that. Fire defensively so a
        // scheduled refresh failure ALWAYS reaches the renderer.
        this.signalSessionDead('scheduled-refresh-failed')
      })
    }, refreshIn)
  }
}

/** Generate a deterministic UUID v5 from a name string (no external deps). */
function uuidv5FromName(name: string): string {
  const namespace = Buffer.from('a1b2c3d4e5f67890abcdef1234567890', 'hex')
  const nameBuffer = Buffer.from(name, 'utf8')
  const hash = crypto.createHash('sha1').update(Buffer.concat([namespace, nameBuffer])).digest()
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.toString('hex').slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}
