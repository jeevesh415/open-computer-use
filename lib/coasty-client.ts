// SERVER ONLY: do not import from client components.
//
// This module reads `process.env.COASTY_API_KEY` (via `./oss-mode`) and
// signs every outbound HTTP request with it. Any leak of this file's
// symbols into the client bundle would expose that secret to the browser.
// We enforce the invariant via the banner above plus a runtime guard at
// the bottom of the file (mirroring `lib/oss-mode.ts`).
//
// Phase 1 status: DORMANT.
// No other file in this repo imports this module yet. It exists as the
// canonical Coasty REST client for OSS mode and will be wired into the
// chat / VM provisioning paths in subsequent phases. Keeping it dormant
// behind a clean boundary lets us land the surface review-ably without
// changing runtime behavior.
//
// Design choices, mirrored 1:1 from `mcp/src/client.ts:1-29`:
//
//   * Plain global fetch, zero deps. Node 18+ / Next.js 15 ship it; avoiding
//     axios / undici / node-fetch keeps the bundle small and the supply
//     chain narrow.
//   * AbortController timeout. The Coasty backend caps long-running calls
//     at ~90 s (Cloudflare's edge ceiling). We mirror that here so a stuck
//     call doesn't tie up a request handler indefinitely.
//   * Idempotency-Key passthrough — only set when the caller explicitly
//     asks for it, so we don't accidentally cache POSTs that aren't
//     idempotent on the server.
//   * Structured CoastyError envelope. Every non-2xx response is parsed
//     into the shape from `mcp/src/errors.ts` and thrown. Callers
//     (eventually a route handler) decide whether to translate that into
//     an HTTP response, an SSE error event, or a tool result.
//   * No retry policy. The client of THIS client owns retries — Next.js
//     route handlers have their own surrounding controls and we'd rather
//     surface a fast 5xx with a useful Retry-After than silently re-hit
//     the API.

import { getCoastyApiBaseUrl, requireCoastyApiKey } from "./oss-mode"

/**
 * Structured error envelope thrown by `CoastyClient` on non-2xx responses.
 *
 * Mirrors the Coasty backend error envelope (`{ error: { code, message,
 * type, request_id } }`) plus the HTTP status and the raw parsed body for
 * debugging. Same shape as `mcp/src/errors.ts:CoastyError`.
 */
export type CoastyError = {
  /** HTTP status code from the response (e.g. 401, 422, 500). */
  status: number
  /** Stable string code from the backend envelope, or `HTTP_<status>` fallback. */
  code: string
  /** Human-readable message suitable for surfacing to operators. */
  message: string
  /** Optional error class hint from the backend (e.g. "validation_error"). */
  type?: string
  /** Server-side request id — include in support tickets for fast triage. */
  requestId?: string
  /** Raw parsed body, or `{ raw: <text> }` for non-JSON responses. */
  raw?: unknown
}

/**
 * Per-request options. All fields are optional; defaults are inherited
 * from the `CoastyClient` instance config.
 */
export type RequestOptions = {
  /** Extra headers. Authorization / X-API-Key are handled internally. */
  headers?: Record<string, string>
  /** Override the per-request timeout (ms). Defaults to client `timeoutMs`. */
  timeoutMs?: number
  /** Idempotency-Key shorthand — sets the header iff defined. */
  idempotencyKey?: string
  /** Query params. `undefined` / `null` entries are skipped. */
  query?: Record<string, string | number | boolean | undefined | null>
  /** Caller-supplied AbortSignal. Composed with the timeout signal. */
  signal?: AbortSignal
}

type ClientOptions = {
  /** Coasty API key. Falls back to `requireCoastyApiKey()` when omitted. */
  apiKey?: string
  /** Base URL. Falls back to `getCoastyApiBaseUrl()` when omitted. */
  baseUrl?: string
  /** Default per-request timeout (ms). Defaults to 90_000 (matches edge cap). */
  timeoutMs?: number
  /** User-Agent string. Defaults to `"open-computer-use-web/1.0"`. */
  userAgent?: string
}

const DEFAULT_TIMEOUT_MS = 90_000
const DEFAULT_USER_AGENT = "open-computer-use-web/1.0"

/**
 * Thin HTTP wrapper around the public Coasty REST API.
 *
 * Mirrors `mcp/src/client.ts:CoastyClient` precisely, adapted for use
 * inside Next.js server-side code (route handlers, server actions, server
 * components). Constructed-once-and-reused via `getDefaultCoastyClient()`,
 * or instantiated directly when you need a non-default API key (e.g.
 * acting on behalf of a different tenant in admin tooling).
 *
 * SECURITY: server-only. Holds the COASTY_API_KEY in memory.
 */
export class CoastyClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly userAgent: string

  constructor(opts: ClientOptions = {}) {
    this.apiKey = opts.apiKey ?? requireCoastyApiKey()
    this.baseUrl = (opts.baseUrl ?? getCoastyApiBaseUrl()).replace(/\/+$/, "")
    this.timeoutMs =
      typeof opts.timeoutMs === "number" && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
        ? Math.floor(opts.timeoutMs)
        : DEFAULT_TIMEOUT_MS
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT
  }

  /** GET <path>. */
  async get<T = unknown>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>("GET", path, undefined, opts)
  }

  /** POST <path> with optional JSON body. */
  async post<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return this.request<T>("POST", path, body, opts)
  }

  /** PATCH <path> with optional JSON body. */
  async patch<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return this.request<T>("PATCH", path, body, opts)
  }

  /** DELETE <path>. */
  async delete<T = unknown>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>("DELETE", path, undefined, opts)
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    opts: RequestOptions = {},
  ): Promise<T> {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`
    const url = new URL(normalizedPath, this.baseUrl)
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v === undefined || v === null) continue
        url.searchParams.set(k, String(v))
      }
    }

    const headers: Record<string, string> = {
      "X-API-Key": this.apiKey,
      "User-Agent": this.userAgent,
      "X-Coasty-Source": "web-oss",
      Accept: "application/json",
      ...(opts.headers ?? {}),
    }
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey
    if (body !== undefined) headers["Content-Type"] = "application/json"

    const timeoutMs = opts.timeoutMs ?? this.timeoutMs
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    // Compose caller signal with our timeout signal: aborting either
    // aborts the fetch.
    let externalAbortHandler: (() => void) | undefined
    if (opts.signal) {
      if (opts.signal.aborted) {
        clearTimeout(timer)
        throw new Error(
          `Coasty API request aborted before send (${method} ${normalizedPath})`,
        )
      }
      externalAbortHandler = () => controller.abort()
      opts.signal.addEventListener("abort", externalAbortHandler, { once: true })
    }

    let resp: Response
    try {
      resp = await fetch(url.toString(), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
    } catch (err: unknown) {
      clearTimeout(timer)
      if (opts.signal && externalAbortHandler) {
        opts.signal.removeEventListener("abort", externalAbortHandler)
      }
      const isAbort = err instanceof Error && err.name === "AbortError"
      if (isAbort) {
        throw new Error(
          `Coasty API request timed out after ${timeoutMs}ms (${method} ${normalizedPath})`,
        )
      }
      throw new Error(
        `Coasty API request failed (${method} ${normalizedPath}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
    clearTimeout(timer)
    if (opts.signal && externalAbortHandler) {
      opts.signal.removeEventListener("abort", externalAbortHandler)
    }

    const text = await resp.text()
    let parsed: unknown = undefined
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        // Non-JSON body. Pass through as raw text in the error envelope below.
        parsed = { raw: text }
      }
    }

    if (!resp.ok) {
      const env = (parsed as Record<string, unknown> | undefined)?.["error"] as
        | Record<string, unknown>
        | undefined
      const err: CoastyError = {
        status: resp.status,
        code: String(env?.["code"] ?? `HTTP_${resp.status}`),
        message: String(
          env?.["message"] ??
            (typeof parsed === "object" && parsed !== null && "raw" in parsed
              ? String((parsed as { raw: unknown }).raw).slice(0, 500)
              : resp.statusText),
        ),
        type: typeof env?.["type"] === "string" ? (env["type"] as string) : undefined,
        requestId:
          (typeof env?.["request_id"] === "string"
            ? (env["request_id"] as string)
            : undefined) ??
          resp.headers.get("X-Coasty-Request-Id") ??
          undefined,
        raw: parsed,
      }
      throw err
    }

    return parsed as T
  }
}

/**
 * Type guard for the structured `CoastyError` envelope thrown by
 * `CoastyClient`. Use in catch blocks to distinguish API errors (HTTP
 * status + structured envelope) from transport errors (network /
 * timeout) that surface as plain `Error`.
 */
export function isCoastyError(e: unknown): e is CoastyError {
  return (
    typeof e === "object" &&
    e !== null &&
    "status" in e &&
    "code" in e &&
    "message" in e &&
    typeof (e as { status: unknown }).status === "number"
  )
}

let _defaultClient: CoastyClient | undefined

/**
 * Returns a process-wide singleton `CoastyClient` constructed from
 * environment variables. Memoized so we don't re-read env / re-validate
 * the API key on every call.
 *
 * SECURITY: server-only — the returned client holds the COASTY_API_KEY in
 * memory.
 */
export function getDefaultCoastyClient(): CoastyClient {
  if (!_defaultClient) _defaultClient = new CoastyClient()
  return _defaultClient
}

// Runtime guard: if this module somehow ends up evaluated in a browser
// context (bad bundling, accidental client import), throw immediately so
// the failure is loud and the API key reads above never have a chance to
// expose secrets via a build-time inline.
if (typeof window !== "undefined") {
  throw new Error(
    "lib/coasty-client.ts was imported in a client environment. " +
      "This module is server-only and reads server-only secrets " +
      "(COASTY_API_KEY). Move the import to a server component, route " +
      "handler, or server action.",
  )
}
