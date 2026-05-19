import WebSocket from 'ws'
import { BrowserWindow, screen } from 'electron'
import * as os from 'os'
import { LocalExecutor } from './local-executor'
import { ApprovalManager } from './approval-manager'
import { showRainbowBorder, hideRainbowBorder, initRainbowBorder } from './rainbow-border'
import { errorReporter, reportError } from './error-reporter'

// 'error'      → transient connection error (TLS/DNS/5xx/network); keeps retrying
// 'auth_error' → backend rejected the JWT; fatal, triggers sign-out in the renderer
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error' | 'auth_error'

/**
 * Per-command parameter preview for failure logs. Pulls the most
 * informative field for each command type so a "failed" log line
 * actually tells you what was attempted (we previously logged only
 * the command name, which made every terminal_execute failure look
 * identical).
 */
function previewParameters(command: string, parameters: any): string | null {
  if (!parameters || typeof parameters !== 'object') return null
  const trim = (s: any, n = 100) => {
    const str = typeof s === 'string' ? s : JSON.stringify(s)
    if (!str) return ''
    return str.length > n ? str.slice(0, n) + '…' : str
  }
  switch (command) {
    case 'terminal_execute':
    case 'execute_command':
      return trim(parameters.command)
    case 'terminal_type':
    case 'type':
      return trim(parameters.text)
    case 'key_press':
    case 'key_combo':
      return trim(parameters.keys ?? parameters.key)
    case 'click':
    case 'double_click':
    case 'click_with_modifiers':
      if (typeof parameters.x === 'number' && typeof parameters.y === 'number') {
        return `(${parameters.x}, ${parameters.y})`
      }
      return null
    case 'browser_navigate':
      return trim(parameters.url)
    case 'browser_type':
      return trim(parameters.text)
    case 'file_read':
    case 'file_write':
    case 'file_edit':
    case 'file_delete':
    case 'file_exists':
    case 'directory_list':
      return trim(parameters.path ?? parameters.filepath ?? parameters.dirpath)
    default:
      return null
  }
}

/** Compose a human-readable failure reason from an executor result. */
function formatFailureReason(result: any): string {
  if (!result || typeof result !== 'object') return 'no result returned'
  const parts: string[] = []
  if (result.error) parts.push(String(result.error))
  if (result.exit_code !== undefined && result.exit_code !== 0) {
    parts.push(`exit=${result.exit_code}`)
  }
  if (result.output && typeof result.output === 'string' && result.output.trim()) {
    const head = result.output.trim().split('\n').slice(0, 2).join(' / ').slice(0, 200)
    parts.push(`out="${head}"`)
  }
  return parts.length ? parts.join(' | ') : 'unknown failure (no error message in result)'
}

/**
 * Heuristic for an OSS-mode Coasty API key.
 *
 * Production tokens are JWTs (compact serialization: three base64-url segments
 * separated by dots; the header always decodes to JSON starting with `{"alg"`,
 * which after base64-url-encoding always begins with `eyJ`). API keys minted
 * by coasty.ai start with the literal prefix `coasty_`. Treat anything that
 * doesn't start with `eyJ` AND does start with `coasty_` as an API key.
 *
 * The two callers (URL builder + auth message) MUST use the same predicate so
 * the backend never sees a mismatch (e.g. a JWT in the URL and an API key in
 * the auth body, or vice versa).
 */
function looksLikeCoastyApiKey(token: string): boolean {
  return typeof token === 'string' && token.startsWith('coasty_')
}

/** Collect local system details to send to the backend. */
function getSystemInfo(): Record<string, string> {
  const primary = screen.getPrimaryDisplay()
  return {
    platform: process.platform,                    // win32, darwin, linux
    os_name: `${os.type()} ${os.release()}`,       // Windows_NT 10.0.26200, Darwin 23.2.0, etc.
    os_version: os.release(),
    arch: os.arch(),                               // x64, arm64
    hostname: os.hostname(),
    username: os.userInfo().username,
    home_dir: os.homedir(),
    shell: process.platform === 'win32' ? 'powershell' : (process.env.SHELL || '/bin/bash'),
    screen_width: String(primary.size.width),
    screen_height: String(primary.size.height),
  }
}

// ─────────────────────────────────────────────────────────────────────
// Reconnect + heartbeat-watchdog tuning
// ─────────────────────────────────────────────────────────────────────
//
// Production-grade fault tolerance: every retry surface MUST have a
// budget. The pre-hardening version of this bridge retried forever
// with 15s caps, which meant a user whose backend was unreachable
// would sit on a "connecting" pill indefinitely without any cue to
// either re-sign-in or check their network. The user's directive
// "if there are any issues just sign the user out simple as that"
// is implemented by exhausting these budgets → calling the fatal
// callback → renderer signs out.
//
// MAX_RECONNECT_ATTEMPTS = 15. At the capped 15s interval the budget
// is roughly ``15 × ~10s_avg = ~2.5 min`` of attempted reconnects
// before we surrender. Long enough to ride out a router reboot or a
// brief backend deploy; short enough that a permanently-broken setup
// surfaces fast instead of leaving the user staring at a hung pill.
const MAX_RECONNECT_ATTEMPTS = 15
// HEARTBEAT_INTERVAL_MS — how often we send ``{type:'heartbeat'}``.
const HEARTBEAT_INTERVAL_MS = 30000
// HEARTBEAT_PONG_TIMEOUT_MS — if NO message of any kind arrives from
// the backend within this window, the connection is presumed dead
// even if the OS thinks the socket is still open (the typical TCP
// half-close scenario: WiFi → cellular handoff, laptop sleep/wake,
// VPN drop). We force-close the socket which fires our ``close``
// handler and triggers the bounded-reconnect chain.
//
// 75 s = 2.5 × heartbeat interval. Captures a missed-pong AND a
// missed follow-up before declaring death. The previous version had
// NO watchdog at all, so a dead socket could look alive for the
// entire user session.
const HEARTBEAT_PONG_TIMEOUT_MS = 75000

// ─────────────────────────────────────────────────────────────────────
// Initial-connect watchdog
// ─────────────────────────────────────────────────────────────────────
//
// `new WebSocket(url)` from the `ws` package has NO connect timeout —
// if the TCP handshake stalls (e.g. signed-bundle TLS quirk on macOS,
// strict corporate proxy that accepts the SYN but never finishes the
// TLS exchange, captive portal, DNS pointed at a black-holed IP), the
// socket can sit in CONNECTING state for tens of minutes before the
// OS-level TCP keepalive finally tears it down.
//
// The pong watchdog above only arms AFTER the 'open' event fires, so
// it cannot rescue a pre-open hang. Without this connect watchdog the
// renderer's connection-state pill is stuck on the pulsing-yellow
// "connecting" dot forever, which is exactly the "stuck in working"
// symptom packaged macOS builds were exhibiting.
//
// 15 s matches the reconnect-cap interval — long enough to ride out a
// slow first handshake on poor networks, short enough that a broken
// handshake escalates to the reconnect chain promptly. On expiry the
// socket is force-closed which fires our `close` handler and schedules
// a normal reconnect (subject to MAX_RECONNECT_ATTEMPTS).
const CONNECT_TIMEOUT_MS = 15000

// ─────────────────────────────────────────────────────────────────────
// Command-queue backpressure thresholds
// ─────────────────────────────────────────────────────────────────────
//
// The bridge serializes every inbound command through ``commandQueue``
// (see WHY at line ~169). Because a single overlay-hiding command can
// easily take ~300 ms (50 ms hide + action + 250 ms fade-in), a chatty
// backend that pipelines commands faster than the local machine can
// drain them will silently grow the queue. From the user's perspective
// the agent feels "laggy" but no error surfaces — the queue just grows
// unbounded and command results trickle back seconds late.
//
// We surface this BEFORE the user feels it. When in-flight depth reaches
// WARN, the bridge sends a one-shot ``command_queue_backpressure``
// telemetry frame so the backend can throttle or coalesce. When the
// queue drains back to RECOVER (50% of WARN), we send a one-shot
// "recovered" frame so the backend knows it's safe to resume normal
// pacing. The hysteresis gap (WARN minus RECOVER) prevents flap when
// depth oscillates around the threshold.
//
// COMMAND_QUEUE_BACKPRESSURE_WARN = 8. Eight queued commands at ~300 ms
// each = ~2.4 s of latency. That's the threshold where a UI delay
// crosses from "snappy" to "the agent feels stuck", and where a human
// user would notice and complain. Set lower and we'd cry wolf on every
// modest burst; set higher and we'd miss the early signal.
//
// COMMAND_QUEUE_BACKPRESSURE_RECOVER = 4. Half of WARN gives the
// queue room to oscillate (typical burst→drain swings of ±3) without
// re-firing the warning. Recovery at 4 also means the backend has at
// least ~1.2 s of headroom before another warning could fire, which
// is enough time for a remote rate-limit decision to take effect.
const COMMAND_QUEUE_BACKPRESSURE_WARN = 8
const COMMAND_QUEUE_BACKPRESSURE_RECOVER = 4

export class WebSocketBridge {
  private ws: WebSocket | null = null
  private executor: LocalExecutor
  private backendUrl: string
  private token: string
  private machineId: string
  private userId: string
  private reconnectAttempts = 0
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private pongWatchdog: ReturnType<typeof setTimeout> | null = null
  private connectWatchdog: ReturnType<typeof setTimeout> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private state: ConnectionState = 'disconnected'
  private intentionalClose = false
  /** Fired when the bridge has given up on the current credential
   *  set — either too many reconnect failures OR backend reported
   *  ``auth_failed``. The main process wires this to
   *  ``auth.signalSessionDead`` which routes the renderer to the
   *  AuthScreen. Set via setFatalAuthCallback() from index.ts. */
  private onFatalAuth: ((reason: 'auth-rejected' | 'reconnect-exhausted') => void) | null = null
  private approvalManager: ApprovalManager
  // Remote approval tracking: approval_id → { resolve }
  private pendingRemoteApprovals = new Map<string, { resolve: (result: { approved: boolean; reason?: string }) => void }>()
  // Rainbow border: on for the entire task, off on task_end / disconnect
  private rainbowActive = false
  // When true, reject all incoming commands (user clicked Stop)
  private taskStopped = false
  /**
   * Strict serial queue for command execution.
   *
   * The 'message' WebSocket handler is `async` — Node's ws library will
   * dispatch the next message as soon as the current handler hits its
   * first `await`. If two commands land in the bridge before the first
   * completes, both call `executor.executeCommand` concurrently. That's
   * a problem: many commands wrap the action in `withOverlayHidden`,
   * which hides the overlay (50ms wait) → runs the action → schedules
   * a fire-and-forget 250ms fade-in. Concurrent execution causes:
   *   - the overlay fade-in for cmd A overlapping the hide for cmd B
   *   - screenshots capturing the overlay mid-fade
   *   - keyboard input from `type` interleaving with `key_press`
   *   - the result for cmd B arriving at the backend before cmd A
   *
   * Even if the backend awaits each result before sending the next
   * (it does), network jitter or backend pipelining can land two
   * messages in the bridge before the first's full chain (hide → action
   * → send-result) finishes. Chaining onto a single promise guarantees
   * strict in-order, one-at-a-time execution. Errors don't break the chain.
   */
  private commandQueue: Promise<unknown> = Promise.resolve()
  /**
   * Current depth of the serial command queue — incremented at enqueue,
   * decremented when a chain link resolves OR rejects. Used to drive the
   * backpressure telemetry frame. See COMMAND_QUEUE_BACKPRESSURE_* for
   * threshold rationale.
   */
  private commandQueueDepth = 0
  /**
   * Latched while we're above the WARN threshold so we don't spam the
   * backend with a warning frame on every increment. Cleared when depth
   * drops below RECOVER, at which point we emit a one-shot recovery frame.
   */
  private backpressureActive = false

  private getToken: (() => Promise<string | null>) | null = null

  constructor(backendUrl: string, token: string, machineId: string, userId: string, approvalManager: ApprovalManager) {
    this.backendUrl = backendUrl
    this.token = token
    this.machineId = machineId
    this.userId = userId
    this.executor = new LocalExecutor()
    this.approvalManager = approvalManager
  }

  /** Provide a callback to fetch a fresh token on reconnect. */
  setTokenProvider(fn: () => Promise<string | null>): void {
    this.getToken = fn
  }

  /** Turn on the rainbow aura for the duration of the task. */
  private startRainbow(): void {
    if (this.rainbowActive) return
    this.rainbowActive = true
    showRainbowBorder()
  }

  /** Turn off the rainbow (task_end / disconnect). */
  private stopRainbow(): void {
    if (!this.rainbowActive) return
    this.rainbowActive = false
    hideRainbowBorder()
  }

  /**
   * Run a command through the serial queue. Each call chains onto the
   * previous one's completion (success OR failure), guaranteeing strict
   * in-order execution. The returned promise resolves when THIS command
   * completes; the queue itself swallows errors so a failed command
   * doesn't break the chain for subsequent ones.
   *
   * Telemetry: logs duration + outcome so concurrency / latency issues
   * show up in the logs.
   */
  private executeSerially(command: string, parameters: any): Promise<any> {
    const start = Date.now()
    // For commands whose parameters carry the actual workload (e.g.
    // terminal_execute's `command` field), log a short preview so a
    // failure log has enough context to debug what was attempted.
    const paramPreview = previewParameters(command, parameters)
    if (paramPreview) {
      console.log(`[WS Bridge] ${command} → ${paramPreview}`)
    }

    // ── Backpressure accounting (enqueue side) ─────────────────────────
    //
    // Increment up-front: every call to executeSerially appends exactly
    // one link to the promise chain, and every link consumes a slot
    // regardless of whether it ends up running the executor or hitting
    // the stop-gate no-op below. The decrement happens in BOTH
    // resolution paths of the telemetry `.then` (success + error), so
    // depth stays consistent across the full lifecycle. The matching
    // emitBackpressure(...) call below this comment may fire a one-shot
    // warning frame when we cross the WARN threshold.
    this.commandQueueDepth++
    if (
      this.commandQueueDepth >= COMMAND_QUEUE_BACKPRESSURE_WARN &&
      !this.backpressureActive
    ) {
      this.backpressureActive = true
      this.emitBackpressure('warning')
    }

    // ── Last-mile stop gate (commands queued before stop) ──────────────
    //
    // Stop-race fix verified 2026-05-14: this in-queue gate is the
    // authoritative one. The ingress check in the 'message' handler
    // only catches commands that ARRIVE after taskStopped flips; this
    // gate catches commands that were already enqueued before the flip.
    //
    // The ``taskStopped`` flag is also checked at message ingress
    // (line 358), but that only catches commands that ARRIVE after the
    // flag was set. Anything already queued onto ``commandQueue`` would
    // execute without this check.
    //
    // Real-world race: user clicks Stop, ``stopTask`` flips the flag,
    // ``task_stop`` goes to the backend. Meanwhile the backend has
    // already pipelined 1-3 commands into the WS that landed BEFORE
    // the flag flipped, so they passed the ingress check and chained
    // onto the queue. Without this gate they execute (clicks, types,
    // screenshots) AFTER the user thought they'd stopped the task.
    //
    // The gate fires when THIS link in the chain unblocks — i.e. at
    // the moment the command would actually run. If ``taskStopped``
    // is true by then, we skip the executor and return a synthetic
    // "task was stopped" result. The next chain link still runs (it
    // hits the same gate too), so the queue drains cleanly without
    // executing anything.
    const next = this.commandQueue.then(() => {
      if (this.taskStopped) {
        console.log(`[WS Bridge] Queue-drained (task stopped): ${command}`)
        return {
          success: false,
          error: 'Task was stopped by user',
          stoppedByUser: true,
        }
      }
      return this.executor.executeCommand(command, parameters)
    })
    // Don't break the chain on rejected promises — every chain link
    // must always resolve so subsequent commands still get to run.
    this.commandQueue = next.catch(() => undefined)
    next.then(
      (result) => {
        const ms = Date.now() - start
        const ok = result && result.success !== false
        if (ok) {
          console.log(`[WS Bridge] ${command} ok (${ms}ms)`)
        } else {
          // Surface the actual failure cause: the executor's error string,
          // the exit code (terminal commands), and the head of any output.
          const reason = formatFailureReason(result)
          console.log(`[WS Bridge] ${command} failed (${ms}ms) — ${reason}`)
          // Funnel into the central reporter so this gets persisted to
          // disk + shipped to the backend even when stdout is invisible
          // (packaged builds, no attached terminal, etc.).
          reportError('local_executor', {
            severity: 'warn',
            message: `${command} failed: ${reason}`,
            command,
            context: {
              durationMs: ms,
              exitCode: result?.exit_code,
              permissionDenied: result?.permissionDenied || undefined,
              permissionType: result?.permissionType || undefined,
            },
          })
        }
        // Backpressure accounting — drain side. The Promise contract
        // guarantees onFulfilled XOR onRejected fires (never both), so
        // the depth is decremented exactly once per executeSerially call.
        this.onCommandDrained()
      },
      (err) => {
        const ms = Date.now() - start
        console.log(`[WS Bridge] ${command} threw (${ms}ms): ${err?.message || err}`)
        // Exceptions bubbling out of a handler are MORE serious than a
        // soft `success: false` — surface as error severity so they're
        // never sampled and they always reach the backend.
        reportError('local_executor', {
          error: err,
          message: `${command} threw: ${err?.message || String(err)}`,
          command,
          context: { durationMs: ms },
        })
        // Decrement on the error path too — see comment in the
        // onFulfilled handler above.
        this.onCommandDrained()
      },
    )
    return next
  }

  /**
   * Drain-side accounting for the command queue. Decrements depth and,
   * if we've fallen back below the RECOVER threshold while a warning
   * was active, sends a one-shot "recovered" frame to the backend.
   *
   * Kept as a method (not inlined) so the resolve/reject branches of
   * the executeSerially telemetry handler stay readable and the
   * threshold logic lives in exactly one place.
   */
  private onCommandDrained(): void {
    this.commandQueueDepth = Math.max(0, this.commandQueueDepth - 1)
    if (
      this.commandQueueDepth <= COMMAND_QUEUE_BACKPRESSURE_RECOVER &&
      this.backpressureActive
    ) {
      this.backpressureActive = false
      this.emitBackpressure('recovered')
    }
  }

  /**
   * Send a single ``command_queue_backpressure`` telemetry frame.
   * The backend uses these signals to throttle (on 'warning') or
   * resume normal pacing (on 'recovered'). We send at most one of
   * each per warn→recover cycle thanks to the ``backpressureActive``
   * latch — never spam.
   *
   * The ``ws.send`` call can throw (broken socket, serialization edge
   * case). Telemetry is best-effort: a failure here MUST NOT propagate
   * upstream because the caller — ``executeSerially`` / ``onCommandDrained``
   * — has bookkeeping (depth decrement, telemetry logging) that must
   * complete regardless of whether the backpressure frame reached the
   * backend. Without this guard a thrown send would (a) leak a queue
   * slot when emitted on the enqueue side, and (b) skip the success
   * log + decrement on the drain side. Swallow + log; the latch state
   * remains correct because we already updated it before calling here.
   */
  private emitBackpressure(state: 'warning' | 'recovered'): void {
    try {
      this.send({
        type: 'command_queue_backpressure',
        depth: this.commandQueueDepth,
        threshold: COMMAND_QUEUE_BACKPRESSURE_WARN,
        state,
      })
    } catch (err: any) {
      console.error(
        `[WS Bridge] Failed to emit backpressure ${state} frame: ${err?.message || err}`,
      )
    }
  }

  getState(): ConnectionState {
    return this.state
  }

  /**
   * External task-active sync — driven by the renderer's `isStreaming`
   * state via IPC. The backend's `task_end` WebSocket message is a
   * fire-and-forget send and isn't always delivered (network blip,
   * backend exception, missing is_electron flag, etc.), so we can't
   * rely on it alone. The renderer is the source of truth: when its
   * SSE stream finishes, this method ensures the rainbow follows.
   * Both `startRainbow`/`stopRainbow` are guarded by `rainbowActive`,
   * so this is idempotent and safe to interleave with the bridge's
   * own task-end / disconnect handlers.
   */
  setTaskActive(active: boolean): void {
    if (active) this.startRainbow()
    else this.stopRainbow()
  }

  /** Signal that the user stopped the current task. Tells the backend to
   *  cancel the CUA executor and rejects any further commands on the bridge
   *  until a new task begins. */
  stopTask(): void {
    if (this.taskStopped) return
    this.taskStopped = true
    this.send({ type: 'task_stop' })
    this.stopRainbow()
    this.approvalManager.cancelAll()
    this.cancelAllRemoteApprovals()
    console.log('[WS Bridge] Task stopped by user')
  }

  /** Reset the stopped flag so the bridge accepts commands for the next task. */
  resumeTask(): void {
    this.taskStopped = false
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return

    this.setState('connecting')
    this.intentionalClose = false

    // Only non-sensitive system info goes in the URL query params.
    // Auth credentials (token, user_id, machine_id) are sent in the
    // first message after the connection opens — this avoids exposing
    // tokens in URLs which get logged by proxies, servers, and CDNs.
    //
    // OSS-mode hint: when the token is an API key (not a JWT), tag the URL
    // with `source=electron-oss` so the backend's WS handler can route the
    // session through the API-key auth path before the body's `auth` message
    // arrives. The hint is a routing breadcrumb only — the actual key never
    // travels in the URL; it goes in the body's auth message like all other
    // credentials.
    const sysInfo = getSystemInfo()
    const params = new URLSearchParams(sysInfo)
    if (looksLikeCoastyApiKey(this.token)) {
      params.set('source', 'electron-oss')
    }
    const wsUrl = `${this.backendUrl.replace(/^http/, 'ws')}/api/electron/ws?${params.toString()}`

    this.ws = new WebSocket(wsUrl)

    // Arm the initial-connect watchdog. See CONNECT_TIMEOUT_MS above for
    // why this is needed — the `ws` package gives us no built-in connect
    // timeout, and a stalled handshake leaves the renderer's pill on
    // "connecting" forever. Disarmed by either 'open' (handshake done) or
    // 'close' / 'error' (cleanup path below).
    this.armConnectWatchdog()

    this.ws.on('open', async () => {
      // Handshake succeeded — disarm the pre-open watchdog. From here on
      // the pong watchdog is the liveness gate.
      this.disarmConnectWatchdog()
      console.log('[WS Bridge] Connected, authenticating...')
      // On reconnect (e.g. after sleep/hibernate), the stored token may be
      // expired. Ask the auth layer for a fresh token before authenticating.
      if (this.getToken) {
        try {
          const freshToken = await this.getToken()
          if (freshToken) {
            this.token = freshToken
          }
        } catch (err) {
          console.error('[WS Bridge] Failed to refresh token on reconnect:', err)
        }
      }
      // Send auth credentials in the message body, not the URL.
      // OSS mode: also include explicit `apiKey` + `source` fields so the
      // backend's WS auth path can take the API-key branch without having
      // to re-sniff the token shape. `token` is left populated for backward
      // compat (older backend builds only read `token`).
      const authMsg: Record<string, unknown> = {
        type: 'auth',
        token: this.token,
        machine_id: this.machineId,
        user_id: this.userId,
      }
      if (looksLikeCoastyApiKey(this.token)) {
        authMsg.apiKey = this.token
        authMsg.source = 'electron-oss'
      }
      this.send(authMsg)
    })

    this.ws.on('message', async (data: WebSocket.RawData) => {
      // Any inbound message is proof the connection is alive; reset
      // the pong watchdog regardless of message type.
      this.resetPongWatchdog()
      try {
        const message = JSON.parse(data.toString())

        if (message.type === 'command') {
          const { command, parameters } = message.data
          console.log(`[WS Bridge] Received command: ${command}`)

          // Reject commands that arrive after the user stopped the task.
          // The backend may still have in-flight commands queued before
          // it processes our task_stop message.
          if (this.taskStopped) {
            console.log(`[WS Bridge] Rejected (task stopped): ${command}`)
            this.send({
              type: 'result',
              data: { success: false, error: 'Task was stopped by user' },
            })
          } else if (this.approvalManager.isDenyAll()) {
            console.log(`[WS Bridge] Denied (mode=off): ${command}`)
            this.send({
              type: 'result',
              data: { success: false, error: 'Action blocked: agent actions are currently paused by user' },
            })
          } else if (this.approvalManager.shouldAutoApprove(command)) {
            console.log(`[WS Bridge] Auto-approved: ${command}`)
            this.startRainbow()
            try {
              // Route through the serial queue — never call executor directly.
              // See comment on `commandQueue` for why this MUST be serialized.
              const result = await this.executeSerially(command, parameters)
              this.send({ type: 'result', data: result })
            } catch (error: any) {
              this.send({
                type: 'result',
                data: { success: false, error: error.message || String(error) },
              })
            }
          } else {
            console.log(`[WS Bridge] Requesting approval: ${command}`)

            // Notify backend about the pending approval so the web/phone UI
            // can also show the prompt and respond remotely.
            const approvalId = `approval_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
            this.send({
              type: 'approval_request',
              data: { id: approvalId, command, parameters },
            })

            // Race: local Electron overlay approval vs remote web/phone approval.
            // The approval manager handles local UI; we also listen for a
            // 'approval_response' message from the backend (sent by the web UI).
            const localPromise = this.approvalManager.requestApproval(command, parameters)
            const remotePromise = this.waitForRemoteApproval(approvalId)

            const { approved, reason } = await Promise.race([localPromise, remotePromise])

            // Cancel the local approval prompt if remote won the race (and vice versa)
            this.approvalManager.cancelAll()
            this.clearRemoteApproval(approvalId)

            if (approved) {
              console.log(`[WS Bridge] Approved: ${command}`)
              this.startRainbow()
              try {
                // Route through the serial queue — never call executor directly.
                const result = await this.executeSerially(command, parameters)
                this.send({ type: 'result', data: result })
              } catch (error: any) {
                this.send({
                  type: 'result',
                  data: { success: false, error: error.message || String(error) },
                })
              }
            } else {
              const msg = reason ? `Action denied by user: ${reason}` : 'Action denied by user'
              console.log(`[WS Bridge] Denied: ${command} — ${msg}`)
              this.send({
                type: 'result',
                data: { success: false, error: msg },
              })
            }
          }
        } else if (message.type === 'task_end') {
          console.log('[WS Bridge] Task ended')
          this.taskStopped = false
          this.stopRainbow()
        } else if (message.type === 'approval_response') {
          // Remote approval response from web/phone UI (forwarded by backend)
          const { id, approved, reason } = message.data || {}
          console.log(`[WS Bridge] Remote approval response: ${id} → ${approved ? 'approved' : 'denied'}`)
          this.resolveRemoteApproval(id, { approved: !!approved, reason })
        } else if (message.type === 'ping') {
          this.send({ type: 'heartbeat' })
        } else if (message.type === 'auth_success') {
          console.log('[WS Bridge] Authenticated with backend')
          this.reconnectAttempts = 0
          this.setState('connected')
          this.startHeartbeat()
          // Pre-create rainbow border so first show is instant
          initRainbowBorder()
          // Wire the error reporter so future errors flow over THIS WS.
          // Identity propagates the user_id/machine_id into every report.
          errorReporter.setIdentity(this.machineId, this.userId)
          errorReporter.setWebSocketSink((report) => {
            // Best-effort: if the underlying socket isn't open the send()
            // helper logs and drops; the reporter then queues for the HTTP
            // fallback. We never let the reporter's send throw upstream.
            try {
              this.send({ type: 'error_report', data: report })
            } catch (e) {
              throw e // signal failure so reporter falls back to HTTP queue
            }
          })
        } else if (message.type === 'auth_failed') {
          // Distinct from generic connection 'error' so the renderer can tell
          // "your JWT is invalid, log out" apart from "transient network blip,
          // keep retrying". App.tsx only auto-signs-out on 'auth_error'.
          console.error('[WS Bridge] Authentication failed:', message.reason)
          this.setState('auth_error')
          this.intentionalClose = true
          this.ws?.close()
          reportError('auth', {
            message: `Backend rejected JWT: ${message.reason || '<no reason>'}`,
            context: { reason: message.reason },
          })
          // Trigger the auth layer's signalSessionDead via the
          // registered callback. Without this, the renderer would
          // also auto-sign-out via App.tsx's connectionState
          // watcher — but firing here ALSO ensures the main-process
          // ElectronAuth tears down the session (clears the
          // .session file, kills the refresh timer, latches
          // sessionDeadFired) so the bridge can't loop on stale
          // creds even if the renderer's watcher is slow to react.
          try {
            this.onFatalAuth?.('auth-rejected')
          } catch (err) {
            console.error('[WS Bridge] onFatalAuth callback threw:', err)
          }
        } else if (message.type === 'reauth_required') {
          // ── Server-pushed token refresh ────────────────────────────
          //
          // The backend tracks JWT exp internally and pushes this frame
          // ~5 min before expiry. If we miss the ``deadline_ms``, the
          // server closes the socket with code 4001 and our normal
          // reconnect chain takes over — but at that point the user
          // sees a "disconnected" flicker. Reacting to this push lets
          // us swap the token in-place with zero visible state change.
          //
          // The deadline is informational: getToken() reads a cached
          // Supabase session (sync I/O wrapped in a promise) and
          // resolves in <10 ms in practice, so we don't add explicit
          // timing logic. If something pathological blocks getToken,
          // the missed-deadline socket close is the safety net.
          const deadline = typeof message.deadline_ms === 'number' ? message.deadline_ms : null
          console.log(
            `[WS Bridge] Server requested reauth ` +
            `(deadline=${deadline ? new Date(deadline).toISOString() : 'none'})`,
          )
          if (!this.getToken) {
            // Provider not wired (early-boot edge case). Send back the
            // current token as best-effort; backend will either accept
            // it (if still valid) or close with 4001 and we reconnect.
            console.warn('[WS Bridge] reauth_required but no token provider wired — sending current token')
            const reauthMsg: Record<string, unknown> = {
              type: 'reauth',
              token: this.token,
            }
            if (looksLikeCoastyApiKey(this.token)) {
              reauthMsg.apiKey = this.token
              reauthMsg.source = 'electron-oss'
            }
            this.send(reauthMsg)
          } else {
            let freshToken: string | null = null
            try {
              freshToken = await this.getToken()
            } catch (err: any) {
              console.error('[WS Bridge] getToken threw during reauth:', err?.message || err)
              reportError('ws_bridge', {
                error: err,
                message: `reauth getToken threw: ${err?.message || String(err)}`,
              })
            }
            if (!freshToken) {
              // No fresh token — let the server close us on the deadline
              // and let the reconnect chain (which calls getToken again
              // on the next 'open') handle recovery. Closing here would
              // race the server's 4001 close and emit a redundant error.
              console.error('[WS Bridge] reauth_required: getToken returned null — awaiting server close')
              reportError('auth', {
                severity: 'warn',
                message: 'reauth_required: token provider returned null',
              })
            } else {
              this.token = freshToken
              const reauthMsg: Record<string, unknown> = {
                type: 'reauth',
                token: this.token,
              }
              // OSS-mode parity with the initial ``auth`` message:
              // when the token is an API key, attach the explicit
              // apiKey + source breadcrumbs so the backend's reauth
              // path takes the same branch as the initial auth.
              if (looksLikeCoastyApiKey(this.token)) {
                reauthMsg.apiKey = this.token
                reauthMsg.source = 'electron-oss'
              }
              this.send(reauthMsg)
            }
          }
        } else if (message.type === 'reauth_ack') {
          // Server-acknowledged reauth. On success, keep going — the
          // socket stays open and the refreshed credentials are in
          // effect server-side. On failure, log the reason and wait
          // for the server to close us; our close handler triggers the
          // normal reconnect path (where the next 'open' calls
          // getToken again and re-auths from scratch).
          if (message.success) {
            console.log('[WS Bridge] reauth_ack: server accepted refreshed token')
          } else {
            console.error(`[WS Bridge] reauth_ack: server rejected refresh — ${message.reason || '<no reason>'}`)
            reportError('auth', {
              severity: 'warn',
              message: `reauth rejected by server: ${message.reason || '<no reason>'}`,
              context: { reason: message.reason },
            })
          }
        }
      } catch (e) {
        console.error('[WS Bridge] Error processing message:', e)
        reportError('ws_bridge', {
          error: e,
          message: 'Error processing inbound WS message',
        })
      }
    })

    this.ws.on('close', (code, reason) => {
      console.log(`[WS Bridge] Disconnected: ${code} ${reason}`)
      this.disarmConnectWatchdog()
      this.stopHeartbeat()
      this.stopRainbow()
      // Cancel all pending approvals (local + remote) so promises don't hang
      this.approvalManager.cancelAll()
      this.cancelAllRemoteApprovals()
      // Tear down the WS sink so future reports queue for HTTP instead of
      // failing against a dead socket.
      errorReporter.setWebSocketSink(null)

      if (!this.intentionalClose) {
        this.setState('disconnected')
        this.scheduleReconnect()
      }
    })

    this.ws.on('error', (error) => {
      console.error('[WS Bridge] Error:', error.message)
      this.disarmConnectWatchdog()
      this.setState('error')
      reportError('ws_bridge', {
        severity: 'warn',  // transient network errors are warns; reconnect handles them
        error,
        message: `WebSocket error: ${error.message}`,
      })
    })
  }

  disconnect(): void {
    this.intentionalClose = true
    this.disarmConnectWatchdog()
    this.stopHeartbeat()
    this.stopRainbow()
    this.clearReconnectTimer()
    this.approvalManager.cancelAll()
    this.cancelAllRemoteApprovals()
    this.ws?.close()
    this.ws = null
    this.setState('disconnected')
  }

  updateToken(token: string): void {
    this.token = token
    // Re-authenticate on the existing connection instead of tearing it down.
    // This avoids a visible 'disconnected' flicker in the UI every ~55 minutes
    // when the scheduled token refresh fires.
    if (this.ws?.readyState === WebSocket.OPEN) {
      const authMsg: Record<string, unknown> = {
        type: 'auth',
        token: this.token,
        machine_id: this.machineId,
        user_id: this.userId,
      }
      if (looksLikeCoastyApiKey(this.token)) {
        authMsg.apiKey = this.token
        authMsg.source = 'electron-oss'
      }
      this.send(authMsg)
    }
  }

  /** Wait for a remote approval response from the backend (web/phone UI).
   *  Includes a 120-second timeout to prevent indefinite hangs. */
  private waitForRemoteApproval(approvalId: string): Promise<{ approved: boolean; reason?: string }> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingRemoteApprovals.delete(approvalId)
        resolve({ approved: false, reason: 'Remote approval timed out' })
      }, 120_000)

      this.pendingRemoteApprovals.set(approvalId, {
        resolve: (result) => {
          clearTimeout(timer)
          resolve(result)
        },
      })
    })
  }

  /** Resolve a pending remote approval promise. */
  private resolveRemoteApproval(approvalId: string, result: { approved: boolean; reason?: string }): void {
    const pending = this.pendingRemoteApprovals.get(approvalId)
    if (pending) {
      this.pendingRemoteApprovals.delete(approvalId)
      pending.resolve(result)
    }
  }

  /** Clear a remote approval by resolving it as denied (e.g. when local won the race). */
  private clearRemoteApproval(approvalId: string): void {
    const pending = this.pendingRemoteApprovals.get(approvalId)
    if (pending) {
      this.pendingRemoteApprovals.delete(approvalId)
      pending.resolve({ approved: false, reason: 'Superseded by local approval' })
    }
  }

  /** Cancel all pending remote approvals (e.g. on disconnect). */
  private cancelAllRemoteApprovals(): void {
    for (const [id, pending] of this.pendingRemoteApprovals) {
      pending.resolve({ approved: false, reason: 'Disconnected' })
    }
    this.pendingRemoteApprovals.clear()
  }

  private send(data: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }

  private startHeartbeat(): void {
    // Avoid stacking timers if startHeartbeat is called twice
    // (auth_success arriving twice during reconnect, for instance).
    this.stopHeartbeat()
    this.heartbeatInterval = setInterval(() => {
      this.send({ type: 'heartbeat' })
    }, HEARTBEAT_INTERVAL_MS)
    this.armPongWatchdog()
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
    this.disarmPongWatchdog()
  }

  /**
   * Arm the pong watchdog. If no message arrives from the backend
   * within ``HEARTBEAT_PONG_TIMEOUT_MS``, the socket is presumed
   * dead and we force-close it. The close handler then schedules a
   * normal reconnect.
   *
   * Production failure modes this catches:
   *   - Laptop sleep/wake → TCP half-close (socket looks open, no data)
   *   - WiFi → LTE handoff that drops the connection silently
   *   - VPN reset
   *   - Backend container OOM-killed without sending close frame
   *
   * Without this watchdog the bridge would happily report "connected"
   * for hours while commands silently piled up unfulfilled.
   */
  private armPongWatchdog(): void {
    this.disarmPongWatchdog()
    this.pongWatchdog = setTimeout(() => {
      console.warn(
        `[WS Bridge] No message from backend in ${HEARTBEAT_PONG_TIMEOUT_MS}ms ` +
        `— presuming connection dead, force-closing socket`,
      )
      // Force-close. The 'close' event handler will schedule a
      // reconnect (subject to MAX_RECONNECT_ATTEMPTS).
      try {
        this.ws?.terminate?.()
      } catch { /* terminate may not exist on all WS impls */ }
      try {
        this.ws?.close()
      } catch { /* already closed */ }
    }, HEARTBEAT_PONG_TIMEOUT_MS)
  }

  private disarmPongWatchdog(): void {
    if (this.pongWatchdog) {
      clearTimeout(this.pongWatchdog)
      this.pongWatchdog = null
    }
  }

  /**
   * Reset the pong watchdog. Called from the message handler on
   * EVERY incoming message — proof the connection is alive. Cheap
   * to call (just clearTimeout + setTimeout).
   */
  private resetPongWatchdog(): void {
    if (this.pongWatchdog) {
      this.armPongWatchdog()
    }
  }

  /**
   * Arm the initial-connect watchdog. Fires if the WS hasn't reached
   * the 'open' state within ``CONNECT_TIMEOUT_MS``. On expiry we
   * force-close the socket; the 'close' handler then runs the normal
   * reconnect chain (subject to MAX_RECONNECT_ATTEMPTS).
   *
   * Production failure modes this catches:
   *   - macOS signed-bundle TLS handshake quirk (the symptom that
   *     surfaced as "stuck in working" on packaged builds before this
   *     watchdog existed)
   *   - Strict corporate proxy that accepts the SYN but never finishes
   *     the TLS exchange
   *   - DNS pointed at a black-holed IP
   *   - Captive portal silently dropping the request
   *
   * The pong watchdog can't help here — it only arms after 'open'.
   */
  private armConnectWatchdog(): void {
    this.disarmConnectWatchdog()
    this.connectWatchdog = setTimeout(() => {
      console.warn(
        `[WS Bridge] Initial connect did not complete in ${CONNECT_TIMEOUT_MS}ms ` +
        `— force-closing stalled socket so the reconnect chain can take over`,
      )
      try {
        this.ws?.terminate?.()
      } catch { /* terminate may not exist on all WS impls */ }
      try {
        this.ws?.close()
      } catch { /* already closed */ }
    }, CONNECT_TIMEOUT_MS)
  }

  private disarmConnectWatchdog(): void {
    if (this.connectWatchdog) {
      clearTimeout(this.connectWatchdog)
      this.connectWatchdog = null
    }
  }

  /**
   * Register the callback that fires when this bridge has given
   * up on the current credentials — used to drive the auth layer
   * into ``signalSessionDead`` so the renderer signs out.
   */
  setFatalAuthCallback(fn: (reason: 'auth-rejected' | 'reconnect-exhausted') => void): void {
    this.onFatalAuth = fn
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private scheduleReconnect(): void {
    // ── Reconnect budget ──────────────────────────────────────────
    //
    // Production fault tolerance means retries have a budget.
    // Without one, a broken setup (revoked token, dead backend,
    // network permanently misconfigured) would loop forever and
    // leave the user staring at "connecting" with no actionable
    // feedback. The budget here exhausts after MAX_RECONNECT_ATTEMPTS
    // failed attempts (~2.5 min at the 15s cap), at which point we
    // fire the fatal-auth callback so the renderer signs out and
    // the user gets a fresh sign-in chance.
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `[WS Bridge] Reconnect budget exhausted (${MAX_RECONNECT_ATTEMPTS} attempts) ` +
        `— declaring connection fatally broken and signing out`,
      )
      this.intentionalClose = true  // don't re-enter scheduleReconnect from a future close event
      this.setState('auth_error')   // App.tsx watches this and signs out
      reportError('ws_bridge', {
        message: `WS reconnect budget exhausted after ${MAX_RECONNECT_ATTEMPTS} attempts`,
      })
      try {
        this.onFatalAuth?.('reconnect-exhausted')
      } catch (err) {
        console.error('[WS Bridge] onFatalAuth callback threw:', err)
      }
      return
    }

    // Cap backoff at 15s so the overlay reconnects quickly when the backend comes up
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 15000)
    this.reconnectAttempts++
    console.log(
      `[WS Bridge] Reconnecting in ${delay}ms ` +
      `(attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`,
    )

    this.reconnectTimer = setTimeout(() => {
      this.connect()
    }, delay)
  }

  private setState(state: ConnectionState): void {
    this.state = state
    // Notify all renderer windows
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('connection-state-changed', state)
    })
  }
}
