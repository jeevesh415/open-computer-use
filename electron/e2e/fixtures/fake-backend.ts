/**
 * In-process fake backend for real-Electron E2E tests.
 *
 * Spins up:
 *   - HTTP server on a random ephemeral port
 *   - WebSocket server mounted at /api/electron/ws
 *
 * Real-Electron tests point the app at ``http://localhost:<port>`` via
 * ``COASTY_BACKEND_URL``, then verify the WS bridge actually connects,
 * authenticates, exchanges heartbeats, etc. — same code paths a production
 * client takes against the real backend.
 *
 * Intentionally minimal — every additional endpoint is one more thing that
 * can drift from the real FastAPI behaviour. We stub only what the IPC
 * handlers we test actually hit (credits balance, chat CRUD shape, machine-
 * busy lookup) plus the WS-bridge handshake.
 */
import * as http from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { AddressInfo } from 'net'

export interface FakeBackendOptions {
  /** Optional override for the credits balance returned by /v1/credits and
   *  /api/billing/credits/balance. Defaults to 100. */
  credits?: number
  /** When true, every HTTP request returns 500. Used by tests that drive
   *  error-handling paths. */
  failHttp?: boolean
  /** When true, the WS server rejects the auth handshake with auth_failed.
   *  Used by the session-death test to verify the renderer signs out. */
  rejectAuth?: boolean
  /** When set, the WS server emits these messages after a successful auth
   *  handshake. Useful for testing command-execution and event flows. */
  postAuthMessages?: Array<Record<string, unknown>>
}

export interface FakeBackend {
  url: string
  port: number
  /** Snapshot of every HTTP request the app made — assertions check this. */
  httpRequests: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders; body: string }>
  /** Snapshot of every WS message the app sent. */
  wsMessages: Array<unknown>
  /** Number of WS clients that have authenticated successfully. */
  authenticatedClients: number
  /** Send a message to every connected WS client. Tests use this to push
   *  commands down to the app and verify the right handlers ran. */
  broadcast: (msg: Record<string, unknown>) => void
  /** Wait until the WS bridge has authenticated at least ``n`` times.
   *  Resolves on success; rejects after ``timeoutMs``. */
  waitForAuth: (n?: number, timeoutMs?: number) => Promise<void>
  close: () => Promise<void>
}

export async function startFakeBackend(opts: FakeBackendOptions = {}): Promise<FakeBackend> {
  const state: FakeBackend = {
    url: '',
    port: 0,
    httpRequests: [],
    wsMessages: [],
    authenticatedClients: 0,
    broadcast: () => {},
    waitForAuth: () => Promise.resolve(),
    close: async () => {},
  }

  const credits = opts.credits ?? 100

  const httpServer = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      state.httpRequests.push({
        method: req.method || 'GET',
        url: req.url || '/',
        headers: req.headers,
        body,
      })

      if (opts.failHttp) {
        res.statusCode = 500
        res.end(JSON.stringify({ error: 'fake-backend-forced-failure' }))
        return
      }

      res.setHeader('Content-Type', 'application/json')
      const url = req.url || '/'

      // ── Credits / billing ────────────────────────────────────────────
      if (url.startsWith('/api/billing/credits/balance') || url.startsWith('/v1/credits')) {
        res.end(JSON.stringify({
          ok: true,
          balance: credits,
          tier: 'free',
          can_start_session: credits > 0,
        }))
        return
      }

      // ── Chat CRUD ────────────────────────────────────────────────────
      if (url.startsWith('/api/chats/create') || url === '/v1/chats') {
        if (req.method === 'POST') {
          res.end(JSON.stringify({ ok: true, chat: { id: 'fake-chat-id', title: 'Fake' } }))
          return
        }
        if (req.method === 'GET') {
          res.end(JSON.stringify({ ok: true, chats: [] }))
          return
        }
      }
      if (url.startsWith('/api/chats/list')) {
        res.end(JSON.stringify({ ok: true, chats: [] }))
        return
      }
      if (url.match(/^\/(api|v1)\/chats\/[^/]+\/messages/)) {
        res.end(JSON.stringify({ ok: true, messages: [] }))
        return
      }

      // ── Machine busy / stop ──────────────────────────────────────────
      if (url.includes('/check-machine-busy')) {
        res.end(JSON.stringify({ ok: true, busy: false, ownerChatId: null }))
        return
      }
      if (url.includes('/stop-machine')) {
        res.end(JSON.stringify({ ok: true, stopped: true, released: true, ownerChatId: null }))
        return
      }

      // ── Chat SSE stream ──────────────────────────────────────────────
      // Minimal SSE — just an immediate finish so the request resolves
      // without the renderer thinking the model hung.
      if (url.startsWith('/api/chat') && req.method === 'POST') {
        res.setHeader('Content-Type', 'text/event-stream')
        res.write(`0:"Hello from fake-backend.\\n"\n`)
        res.write(`d:{"finishReason":"stop"}\n`)
        res.end()
        return
      }

      res.statusCode = 404
      res.end(JSON.stringify({ error: 'not-found', url }))
    })
  })

  const wss = new WebSocketServer({ noServer: true })
  const wsClients = new Set<WebSocket>()
  let authWatchers: Array<() => void> = []

  httpServer.on('upgrade', (req, socket, head) => {
    const url = req.url || ''
    if (!url.startsWith('/api/electron/ws')) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wsClients.add(ws)
      let authed = false

      ws.on('message', (raw) => {
        let msg: unknown
        try { msg = JSON.parse(raw.toString()) } catch { return }
        state.wsMessages.push(msg)

        // The bridge sends `{ type: 'auth', data: { ... } }` as the very
        // first message. Real backend verifies the token; we either accept
        // or reject based on test opts.
        if (typeof msg === 'object' && msg !== null && (msg as any).type === 'auth') {
          if (opts.rejectAuth) {
            ws.send(JSON.stringify({ type: 'auth_failed', data: { reason: 'fake-rejected' } }))
            ws.close()
            return
          }
          authed = true
          state.authenticatedClients++
          ws.send(JSON.stringify({ type: 'auth_ok', data: { ok: true } }))
          // Optional scripted follow-up messages so tests can drive command
          // execution without rolling their own WS server.
          for (const m of opts.postAuthMessages ?? []) {
            ws.send(JSON.stringify(m))
          }
          // Notify anyone waiting on auth completion.
          const fired = authWatchers
          authWatchers = []
          for (const w of fired) w()
          return
        }

        // Real-backend behaviour: respond to ping/pong heartbeats so the
        // bridge's pong-watchdog never fires.
        if (typeof msg === 'object' && msg !== null && (msg as any).type === 'ping') {
          if (authed) {
            ws.send(JSON.stringify({ type: 'pong', data: {} }))
          }
        }
      })

      ws.on('close', () => {
        wsClients.delete(ws)
      })
    })
  })

  state.broadcast = (msg) => {
    const payload = JSON.stringify(msg)
    for (const ws of wsClients) {
      if (ws.readyState === ws.OPEN) ws.send(payload)
    }
  }

  state.waitForAuth = (n = 1, timeoutMs = 15_000) =>
    new Promise<void>((resolve, reject) => {
      if (state.authenticatedClients >= n) return resolve()
      const start = Date.now()
      const check = () => {
        if (state.authenticatedClients >= n) {
          resolve()
        } else if (Date.now() - start > timeoutMs) {
          reject(new Error(
            `Timed out after ${timeoutMs}ms waiting for ${n} WS auth(s) — got ${state.authenticatedClients}`,
          ))
        } else {
          authWatchers.push(check)
        }
      }
      check()
    })

  state.close = () =>
    new Promise<void>((resolve) => {
      for (const ws of wsClients) {
        try { ws.close() } catch { /* ignore */ }
      }
      wss.close(() => {
        httpServer.close(() => resolve())
      })
    })

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  const addr = httpServer.address() as AddressInfo
  state.port = addr.port
  state.url = `http://127.0.0.1:${addr.port}`
  return state
}
