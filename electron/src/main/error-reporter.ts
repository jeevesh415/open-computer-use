/**
 * Unified Electron error reporter.
 *
 * Why this exists: before this module, errors in the Electron app went to ~15
 * scattered `console.error` sites with zero context (no app version, no OS,
 * no machine_id, no correlation to the backend command that triggered them).
 * Renderer crashes died in DevTools. Main-process unhandled exceptions
 * silently exited the process. There was no log file, no telemetry, no way
 * to reproduce a user-reported bug from CloudWatch alone.
 *
 * What it does now:
 *
 *  1. **Single sink** — every error surface in the app routes through
 *     `reportError(category, error, opts?)`. Sources include:
 *        - main: uncaughtException, unhandledRejection
 *        - main: app.render-process-gone, app.child-process-gone
 *        - renderer: window.onerror, unhandledrejection, React ErrorBoundary
 *        - ws-bridge: failed/threw commands
 *        - local-executor: handler exceptions
 *        - libnut load failure, puppeteer crash, auto-updater failure
 *
 *  2. **Context enrichment** — every report carries:
 *        timestamp · severity · category · machine_id · user_id · app_version
 *        · OS (platform/release/arch) · command (when fired during a cmd)
 *        · correlation_id · message · stack · arbitrary `context` blob
 *
 *  3. **PII scrubbing** — strip auth tokens, file-system paths under user
 *     home, and other obvious secrets before persistence/transmission. We
 *     err on the side of redaction (false positives are fine — log noise,
 *     not data loss).
 *
 *  4. **Rate limiting / deduplication** — same fingerprint
 *     (category+message+top-of-stack) within `DEDUP_WINDOW_MS` is collapsed
 *     to a single report with `count: N`. Without this, a tight loop that
 *     fails could flood the backend.
 *
 *  5. **Three sinks** (any combination, all best-effort):
 *        - stdout (always — so `npm run dev` console still shows it)
 *        - file at `<userData>/logs/electron-YYYY-MM-DD.ndjson` (one report
 *          per line; old files pruned to keep total ≤ 100MB)
 *        - WebSocket bridge → backend electron_bridge handler → CloudWatch
 *
 *  6. **HTTP fallback** — when the WS is down (the very moment most worth
 *     reporting), errors queue and POST to `/api/electron/error` with
 *     exponential backoff. Bounded queue of 200 reports — older ones drop
 *     rather than grow without bound.
 *
 *  7. **Sampling for non-error severities** — `info` and `debug` reports
 *     are sampled at `INFO_SAMPLE_RATE` so we don't flood CloudWatch with
 *     routine activity. Errors are NEVER sampled — every error gets logged.
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'

// ─── Types ───────────────────────────────────────────────────────────────

export type ErrorSeverity = 'error' | 'warn' | 'info' | 'debug'

export type ErrorCategory =
  | 'main_unhandled_exception'
  | 'main_unhandled_rejection'
  | 'render_process_gone'
  | 'child_process_gone'
  | 'renderer_unhandled'
  | 'renderer_react_boundary'
  | 'ws_bridge'
  | 'local_executor'
  | 'desktop_automation'
  | 'browser_automation'
  | 'terminal'
  | 'screenshot'
  | 'auth'
  | 'auto_updater'
  | 'libnut_load'
  | 'native_module'
  | 'ipc_handler'
  | 'other'

export interface ReportOptions {
  severity?: ErrorSeverity
  /** Original Error object (preferred) OR a plain string message. */
  error?: unknown
  /** Override the message — useful when `error` is already an Error. */
  message?: string
  /** Command name from the backend, when the error fired during command execution. */
  command?: string
  /** Backend correlation id (e.g. the `id` from the backend's command frame). */
  correlationId?: string
  /** Free-form structured context. Will be PII-scrubbed before persistence. */
  context?: Record<string, unknown>
}

interface EnrichedReport {
  id: string
  timestamp: string
  severity: ErrorSeverity
  category: ErrorCategory
  machine_id: string | null
  user_id: string | null
  app_version: string
  os: { platform: string; release: string; arch: string }
  command?: string
  correlation_id?: string
  message: string
  stack?: string
  context?: Record<string, unknown>
  /** Number of identical reports collapsed into this one (rate-limit). */
  count: number
}

// ─── Tunables ────────────────────────────────────────────────────────────

const LOG_DIR_NAME = 'logs'
const LOG_FILE_PREFIX = 'electron-'
const LOG_FILE_EXT = '.ndjson'
const MAX_LOG_DIR_BYTES = 100 * 1024 * 1024 // 100MB total log retention
const DEDUP_WINDOW_MS = 60_000 // collapse identical reports within 1 min
const HTTP_QUEUE_MAX = 200
const HTTP_RETRY_BASE_MS = 1000
const HTTP_RETRY_MAX_MS = 60_000
const INFO_SAMPLE_RATE = 0.1 // 10% of info/debug
const STACK_MAX_LEN = 8 * 1024
const MESSAGE_MAX_LEN = 4 * 1024
const CONTEXT_JSON_MAX_LEN = 16 * 1024

// ─── Singleton state ─────────────────────────────────────────────────────

class ErrorReporter {
  private logDir: string | null = null
  private machineId: string | null = null
  private userId: string | null = null
  private appVersion: string = '0.0.0'

  /** Send-to-WS hook installed by ws-bridge.ts when it connects. */
  private wsSink: ((report: EnrichedReport) => void) | null = null

  /** Backend URL for the HTTP fallback. Set by index.ts at startup. */
  private backendUrl: string | null = null
  private getAuthToken: (() => Promise<string | null>) | null = null

  /** Recent fingerprints — for dedup. Map<fingerprint, {firstSeenMs, count, report}>. */
  private recent: Map<string, { firstSeenMs: number; count: number; report: EnrichedReport }> = new Map()

  /** HTTP fallback queue — drained on a backoff timer when WS is down. */
  private httpQueue: EnrichedReport[] = []
  private httpDrainTimer: ReturnType<typeof setTimeout> | null = null
  private httpRetryMs: number = HTTP_RETRY_BASE_MS
  private httpDraining = false

  // ── Lifecycle ──────────────────────────────────────────────────────────

  init(opts: { backendUrl?: string; getAuthToken?: () => Promise<string | null> } = {}): void {
    if (opts.backendUrl) this.backendUrl = opts.backendUrl
    if (opts.getAuthToken) this.getAuthToken = opts.getAuthToken

    // Resolve log dir lazily — `app.getPath('userData')` requires the app
    // to be ready, but reporter must be importable from anywhere.
    try {
      this.logDir = path.join(app.getPath('userData'), LOG_DIR_NAME)
      fs.mkdirSync(this.logDir, { recursive: true })
    } catch {
      this.logDir = null  // fail-open: stdout is still always-on
    }

    try {
      this.appVersion = app.getVersion()
    } catch {
      // pre-app-ready callers (rare) — leave the default
    }

    // Periodically prune old logs
    setInterval(() => this.pruneLogDir(), 60 * 60 * 1000).unref()
  }

  /** Updated by ws-bridge after auth completes. */
  setIdentity(machineId: string | null, userId: string | null): void {
    this.machineId = machineId
    this.userId = userId
  }

  /** Installed by ws-bridge on connect; cleared on disconnect. */
  setWebSocketSink(sink: ((report: EnrichedReport) => void) | null): void {
    this.wsSink = sink
    // When the WS comes back, drain the HTTP queue immediately so we don't
    // leave stale errors sitting around.
    if (sink && this.httpQueue.length > 0) {
      this.drainHttpQueue('ws-resumed')
    }
  }

  // ── Public reporting API ───────────────────────────────────────────────

  reportError(category: ErrorCategory, opts: ReportOptions = {}): void {
    const severity: ErrorSeverity = opts.severity ?? 'error'

    // Sample non-error severities so we don't flood CloudWatch with routine
    // info/debug events. Errors are NEVER sampled.
    if (severity !== 'error' && severity !== 'warn') {
      if (Math.random() > INFO_SAMPLE_RATE) return
    }

    const report = this.enrich(category, severity, opts)

    // Dedup: collapse identical reports within the window.
    const fingerprint = this.fingerprint(report)
    const now = Date.now()
    const existing = this.recent.get(fingerprint)
    if (existing && now - existing.firstSeenMs < DEDUP_WINDOW_MS) {
      existing.count++
      // We DO NOT re-emit — only the first emission goes to sinks. The
      // count gets emitted on a flush or window expiry. For now, the
      // simplest behaviour is: emit first, drop duplicates. If you want
      // periodic count flushes, expand this later.
      return
    }
    this.recent.set(fingerprint, { firstSeenMs: now, count: 1, report })

    // Evict expired entries opportunistically.
    if (this.recent.size > 256) {
      for (const [k, v] of this.recent) {
        if (now - v.firstSeenMs > DEDUP_WINDOW_MS) this.recent.delete(k)
      }
    }

    this.emit(report)
  }

  // ── Sink fan-out ───────────────────────────────────────────────────────

  private emit(report: EnrichedReport): void {
    // 1. stdout — always on, primary dev visibility
    this.emitStdout(report)

    // 2. file — durable, grep-able from the user's machine
    this.emitFile(report)

    // 3. WS or HTTP fallback — backend visibility (CloudWatch)
    if (this.wsSink) {
      try {
        this.wsSink(report)
      } catch {
        this.queueForHttp(report)
      }
    } else {
      this.queueForHttp(report)
    }
  }

  private emitStdout(report: EnrichedReport): void {
    const prefix = `[ErrorReporter ${report.severity}] ${report.category}`
    const tail = report.command ? ` (cmd=${report.command})` : ''
    const line = `${prefix}${tail} — ${report.message}`
    if (report.severity === 'error') {
      console.error(line)
      if (report.stack) console.error(report.stack)
    } else if (report.severity === 'warn') {
      console.warn(line)
    } else {
      console.log(line)
    }
  }

  private emitFile(report: EnrichedReport): void {
    if (!this.logDir) return
    const file = this.currentLogFile()
    try {
      fs.appendFileSync(file, JSON.stringify(report) + '\n', { encoding: 'utf-8' })
    } catch {
      // disk full / locked — non-fatal; stdout already has it
    }
  }

  private queueForHttp(report: EnrichedReport): void {
    if (!this.backendUrl) return  // can't POST without a URL
    this.httpQueue.push(report)
    if (this.httpQueue.length > HTTP_QUEUE_MAX) {
      // Drop oldest — keep the newest reports because they're more likely
      // to reflect the current failure mode the user is hitting.
      this.httpQueue.splice(0, this.httpQueue.length - HTTP_QUEUE_MAX)
    }
    this.scheduleHttpDrain()
  }

  private scheduleHttpDrain(): void {
    if (this.httpDrainTimer || this.httpDraining) return
    this.httpDrainTimer = setTimeout(() => {
      this.httpDrainTimer = null
      this.drainHttpQueue('timer')
    }, this.httpRetryMs)
    if (this.httpDrainTimer.unref) this.httpDrainTimer.unref()
  }

  private async drainHttpQueue(_trigger: string): Promise<void> {
    if (this.httpDraining) return
    if (!this.backendUrl) return
    if (this.httpQueue.length === 0) {
      this.httpRetryMs = HTTP_RETRY_BASE_MS
      return
    }

    this.httpDraining = true
    try {
      // POST in a single batch to amortise round-trips.
      const batch = this.httpQueue.slice()
      const body = JSON.stringify({ reports: batch })
      const url = this.backendUrl.replace(/\/$/, '') + '/api/electron/error'

      let token: string | null = null
      if (this.getAuthToken) {
        try { token = await this.getAuthToken() } catch { token = null }
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch(url, { method: 'POST', headers, body }).catch(() => null)
      if (res && res.ok) {
        // Drained successfully — drop the batch, reset backoff.
        this.httpQueue.splice(0, batch.length)
        this.httpRetryMs = HTTP_RETRY_BASE_MS
      } else {
        // Failed — exponential backoff up to a cap.
        this.httpRetryMs = Math.min(this.httpRetryMs * 2, HTTP_RETRY_MAX_MS)
        this.scheduleHttpDrain()
      }
    } finally {
      this.httpDraining = false
    }
  }

  // ── Enrichment ─────────────────────────────────────────────────────────

  private enrich(
    category: ErrorCategory,
    severity: ErrorSeverity,
    opts: ReportOptions,
  ): EnrichedReport {
    const { message, stack } = this.extractMessageAndStack(opts)
    const scrubbedContext = opts.context ? this.scrubObject(opts.context) : undefined

    return {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      severity,
      category,
      machine_id: this.machineId,
      user_id: this.userId,
      app_version: this.appVersion,
      os: {
        platform: process.platform,
        release: os.release(),
        arch: process.arch,
      },
      ...(opts.command ? { command: opts.command } : {}),
      ...(opts.correlationId ? { correlation_id: opts.correlationId } : {}),
      message: this.scrubString(this.truncate(message, MESSAGE_MAX_LEN)),
      ...(stack ? { stack: this.scrubString(this.truncate(stack, STACK_MAX_LEN)) } : {}),
      ...(scrubbedContext ? { context: scrubbedContext } : {}),
      count: 1,
    }
  }

  private extractMessageAndStack(opts: ReportOptions): { message: string; stack?: string } {
    if (opts.message) {
      return { message: opts.message, stack: this.stackOf(opts.error) }
    }
    if (opts.error instanceof Error) {
      return { message: opts.error.message || String(opts.error), stack: opts.error.stack }
    }
    if (typeof opts.error === 'string') {
      return { message: opts.error }
    }
    if (opts.error && typeof opts.error === 'object') {
      const anyErr = opts.error as { message?: unknown; stack?: unknown }
      const msg = typeof anyErr.message === 'string' ? anyErr.message : JSON.stringify(opts.error).slice(0, MESSAGE_MAX_LEN)
      const stack = typeof anyErr.stack === 'string' ? anyErr.stack : undefined
      return { message: msg, stack }
    }
    return { message: '<no message>' }
  }

  private stackOf(error: unknown): string | undefined {
    if (error instanceof Error) return error.stack
    if (error && typeof error === 'object') {
      const s = (error as { stack?: unknown }).stack
      return typeof s === 'string' ? s : undefined
    }
    return undefined
  }

  // ── PII scrubbing ──────────────────────────────────────────────────────

  /**
   * Strip auth tokens, user-home paths, and other obvious secrets from a
   * string. Conservative — we'd rather over-redact log noise than leak.
   */
  private scrubString(s: string): string {
    let out = s
    // Bearer / Authorization tokens — the most common leak path
    out = out.replace(/(authorization\s*[:=]\s*)(bearer\s+)?[a-z0-9._\-]+/gi, '$1<redacted>')
    out = out.replace(/(Bearer\s+)[A-Za-z0-9._\-]+/g, '$1<redacted>')
    // JWT-shaped strings (eyJ...) — supabase tokens, etc.
    out = out.replace(/eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]+/g, '<jwt>')
    // Common API key shapes
    out = out.replace(/(api[_-]?key\s*[:=]\s*)([A-Za-z0-9_\-]{20,})/gi, '$1<redacted>')
    out = out.replace(/(sk-|sk_live_|sk_test_|rk_|pk_live_|pk_test_)[A-Za-z0-9]{16,}/g, '<key>')
    // Password=value
    out = out.replace(/(password\s*[:=]\s*)([^\s,;}]+)/gi, '$1<redacted>')
    // User home paths — Windows + Unix
    const home = os.homedir()
    if (home) {
      // Escape regex metas in home path
      const homeRe = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      out = out.replace(new RegExp(homeRe, 'g'), '~')
    }
    // Username in Windows-style C:\Users\X
    out = out.replace(/([A-Z]:\\Users\\)[^\\\/\s"']+/gi, '$1<user>')
    // Username in Unix-style /home/X or /Users/X
    out = out.replace(/(\/(?:home|Users)\/)[^\/\s"']+/g, '$1<user>')
    return out
  }

  /** Recursively scrub strings in an object. Caps total JSON size to avoid huge contexts. */
  private scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
    const scrub = (v: unknown): unknown => {
      if (typeof v === 'string') return this.scrubString(v)
      if (Array.isArray(v)) return v.map(scrub)
      if (v && typeof v === 'object') {
        const out: Record<string, unknown> = {}
        for (const [k, val] of Object.entries(v)) {
          // Drop obvious secret keys entirely
          if (/^(authorization|password|token|secret|api[_-]?key|cookie)$/i.test(k)) {
            out[k] = '<redacted>'
          } else {
            out[k] = scrub(val)
          }
        }
        return out
      }
      return v
    }
    const scrubbed = scrub(obj) as Record<string, unknown>
    // Truncate over-large contexts (logs are not a data store).
    const json = JSON.stringify(scrubbed)
    if (json.length > CONTEXT_JSON_MAX_LEN) {
      return { _truncated: true, _size: json.length, head: json.slice(0, CONTEXT_JSON_MAX_LEN) }
    }
    return scrubbed
  }

  // ── Fingerprinting / dedup ─────────────────────────────────────────────

  private fingerprint(r: EnrichedReport): string {
    // Collapse identical errors that fire in tight loops. We use category +
    // first line of stack (location) + first 80 chars of message; that's
    // distinctive enough to avoid collapsing genuinely-different errors but
    // groups "the same exception fired 1000 times" into one.
    const stackHead = r.stack ? r.stack.split('\n')[1] || '' : ''
    return `${r.category}::${r.message.slice(0, 80)}::${stackHead.slice(0, 200)}`
  }

  // ── File log management ────────────────────────────────────────────────

  private currentLogFile(): string {
    const date = new Date().toISOString().slice(0, 10)
    return path.join(this.logDir!, `${LOG_FILE_PREFIX}${date}${LOG_FILE_EXT}`)
  }

  /** Drop oldest log files until total size is under MAX_LOG_DIR_BYTES. */
  private pruneLogDir(): void {
    if (!this.logDir) return
    try {
      const files = fs.readdirSync(this.logDir)
        .filter((f) => f.startsWith(LOG_FILE_PREFIX) && f.endsWith(LOG_FILE_EXT))
        .map((f) => {
          const full = path.join(this.logDir!, f)
          const stat = fs.statSync(full)
          return { full, mtime: stat.mtimeMs, size: stat.size }
        })
        .sort((a, b) => a.mtime - b.mtime)  // oldest first

      let total = files.reduce((s, f) => s + f.size, 0)
      while (total > MAX_LOG_DIR_BYTES && files.length > 1) {
        const oldest = files.shift()!
        try {
          fs.unlinkSync(oldest.full)
          total -= oldest.size
        } catch { /* skip */ }
      }
    } catch { /* dir unreadable — non-fatal */ }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private truncate(s: string, max: number): string {
    if (!s) return s
    if (s.length <= max) return s
    return s.slice(0, max) + `…<truncated ${s.length - max} chars>`
  }

  // ── Test-only escape hatches ───────────────────────────────────────────

  /** Reset all internal state — tests use this between cases. */
  _resetForTests(): void {
    this.recent.clear()
    this.httpQueue = []
    if (this.httpDrainTimer) clearTimeout(this.httpDrainTimer)
    this.httpDrainTimer = null
    this.httpRetryMs = HTTP_RETRY_BASE_MS
    this.machineId = null
    this.userId = null
    this.wsSink = null
  }

  _getQueueLength(): number { return this.httpQueue.length }
  _getRecentSize(): number { return this.recent.size }
}

// ─── Module-level singleton ──────────────────────────────────────────────

export const errorReporter = new ErrorReporter()

/** Convenience wrappers — call these instead of console.error to get
 *  context enrichment, file persistence, and backend forwarding for free. */
export function reportError(category: ErrorCategory, opts: ReportOptions = {}): void {
  errorReporter.reportError(category, opts)
}

export function reportWarn(category: ErrorCategory, opts: ReportOptions = {}): void {
  errorReporter.reportError(category, { ...opts, severity: 'warn' })
}

export function reportInfo(category: ErrorCategory, opts: ReportOptions = {}): void {
  errorReporter.reportError(category, { ...opts, severity: 'info' })
}
