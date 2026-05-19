// SERVER ONLY: do not import from client components.
//
// This module reads server-only secrets (`INTERNAL_API_KEY`,
// `PYTHON_BACKEND_URL`, and — via `./oss-mode` — `COASTY_API_KEY`) and signs
// outbound HTTP requests with them. Any leak of this file's symbols into the
// client bundle would expose those secrets to the browser. The
// `server-only` npm package isn't installed in this repo, so we enforce the
// invariant the same way `lib/oss-mode.ts` and `lib/coasty-client.ts` do:
//
//   1. This banner comment, scanned by code review.
//   2. A runtime guard at the bottom of the file that throws if `window` is
//      defined when the module is evaluated.
//
// ─── Phase 2 status: DORMANT ────────────────────────────────────────────────
//
// No file in this repo imports this module yet. It is the canonical helper
// every Next.js API proxy route under `app/api/**/route.ts` will eventually
// call. Phase 2 lands the surface review-ably without changing runtime
// behaviour; a separate migration agent will switch each route over to
// `forwardToBackend()` in Phase 3.
//
// ─── What this helper does ──────────────────────────────────────────────────
//
//   * Production mode (`isOssMode() === false`): forwards the incoming
//     `/api/...` request to the local FastAPI backend at
//     `process.env.PYTHON_BACKEND_URL` exactly as today's bespoke proxy
//     routes do (see `app/api/chat/route.ts` and
//     `app/api/v1/cua/[...path]/route.ts`).
//
//   * OSS mode (`isOssMode() === true`): rewrites the path via `PATH_MAP`
//     (e.g. `/api/chats/abc/messages` → `/v1/chats/abc/messages`), drops the
//     internal API key, and signs the request with `X-API-Key:
//     COASTY_API_KEY` instead. Mirrors the header convention in
//     `mcp/src/client.ts` and `lib/coasty-client.ts`.
//
//   * Streams the upstream body straight through. SSE chunks (text/event-stream)
//     arrive at the client at the same cadence they leave the upstream. We
//     never buffer with `await resp.text()` on the success path.
//
// ─── Runtime requirement ────────────────────────────────────────────────────
//
// This helper builds a `Response`; the calling route file is responsible for
// declaring `export const runtime = "nodejs"` so streaming bodies and
// `duplex: "half"` fetch are supported. The Edge runtime won't handle the
// long-running CUA SSE loops we forward.

import type { NextRequest } from "next/server"
import { getCoastyApiBaseUrl, isOssMode, requireCoastyApiKey } from "./oss-mode"

// ─── Public types ────────────────────────────────────────────────────────────

/**
 * Auth scheme to apply on the outbound (upstream) request.
 *
 * Defaults to `"internal"` in production mode and `"api-key"` in OSS mode.
 * The default is computed inside `forwardToBackend()`; pass a value here to
 * override it for routes that don't follow the convention (e.g. a pass-through
 * proxy that already has an `X-API-Key` from the inbound request).
 */
export type AuthMode = "internal" | "bearer" | "api-key" | "none"

/**
 * Per-request options for `forwardToBackend()`. All fields optional;
 * defaults are documented per-field.
 */
export interface ForwardOptions {
  /**
   * Override target path. If omitted, derived from `req.nextUrl.pathname`
   * — kept as-is in production mode, mapped through `mapApiPathToV1()` in
   * OSS mode.
   *
   * Example: pass `"/api/chat/"` (with the trailing slash the FastAPI
   * backend wants) when the inbound path is `/api/chat`.
   */
  path?: string

  /** HTTP method override. Defaults to `req.method`. */
  method?: string

  /**
   * Auth scheme to apply on the outbound request. Defaults to `"internal"`
   * in production mode, `"api-key"` in OSS mode. Pass `"none"` for routes
   * the caller has already authenticated some other way.
   */
  auth?: AuthMode

  /**
   * If `true`, body is treated as a stream — `req.body` is forwarded as a
   * `ReadableStream` with `duplex: "half"`. If `false` (default), body is
   * read as text and forwarded as-is. Set to `true` for `/api/files`
   * multipart uploads, large binary payloads, or any case where buffering
   * the request would risk OOM.
   *
   * Auto-defaults to `true` when `Content-Type` starts with
   * `multipart/form-data`.
   */
  passthroughBody?: boolean

  /**
   * Max body size in bytes for the *buffered* path (i.e. when
   * `passthroughBody === false`). Defaults to 15 MB to mirror
   * `app/api/v1/cua/[...path]/route.ts`. Streamed bodies are not capped
   * here — apply caps upstream of this helper if you need them.
   */
  maxBodyBytes?: number

  /**
   * Per-request timeout in ms. Defaults to 90_000 (90 s, matching the
   * Cloudflare edge cap) for normal requests, or 600_000 (10 min) when the
   * upstream returns a streaming response (long-running CUA SSE loops).
   */
  timeoutMs?: number

  /** Extra headers to add to the upstream request. */
  extraHeaders?: Record<string, string>

  /**
   * Pre-built outbound body. Use this when the route has already consumed
   * the inbound body (`await req.json()`, `await req.text()`) — perhaps to
   * mutate / authorize fields — and now needs to forward the result. When
   * provided, the inbound `req.body` is ignored and `passthroughBody` /
   * `maxBodyBytes` checks are skipped on the request side (the caller is
   * responsible for any size validation).
   *
   * Pass a string for JSON or text payloads. Pass a `ReadableStream` to
   * forward raw bytes through (`duplex: "half"` is set automatically).
   */
  body?: string | ReadableStream<Uint8Array>

  /**
   * Test-only: inject an alternate `fetch` implementation. Defaults to
   * global `fetch`. Mirrors the testability convention of
   * `mcp/src/client.ts` and `lib/coasty-client.ts`.
   *
   * @internal
   */
  __fetch?: typeof fetch
}

/**
 * Structured router error. Used internally to build typed JSON error
 * responses; not thrown to callers — `forwardToBackend()` always returns a
 * `Response`.
 */
export interface RouterError extends Error {
  status: number
  code: string
}

// ─── Path mapping table ──────────────────────────────────────────────────────

/**
 * One row in the api → v1 path-translation table. `oss === null` means the
 * route has no public coasty.ai equivalent (Supabase-only, Stripe-only,
 * admin-only, etc.). Order matters in `PATH_MAP` — first match wins, so
 * more specific prefixes must come before broader ones.
 */
type PathMapEntry = {
  /** Inbound prefix on this Next.js app (always starts with `/api/`). */
  apiPrefix: string
  /**
   * Outbound v1 prefix on coasty.ai. `null` = no OSS equivalent; caller
   * receives 501 NOT_AVAILABLE_IN_OSS_MODE.
   */
  oss: { prefix: string } | null
  /**
   * `"prefix"` matches the entry as a path prefix (covers subtree).
   * `"exact"` matches only when `apiPath === apiPrefix` (used for routes
   * where sibling subpaths have different mapping rules — e.g.
   * `/api/credits/balance` is exact because `/api/credits/checkout` has a
   * different rule).
   */
  match: "prefix" | "exact"
  /** Free-form note kept in source for reviewers; ignored at runtime. */
  note?: string
}

/**
 * Single source of truth for `/api/*` → `/v1/*` rewrites. Verified against
 * `lib/openapi/coasty-v1.ts`:
 *
 *   * Present in spec: `/v1/predict`, `/v1/sessions`, `/v1/ground`,
 *     `/v1/ocr`, `/v1/parse`, `/v1/models`, `/v1/usage`, `/v1/keys`,
 *     `/v1/health`, `/v1/machines`, `/v1/schedules`, `/v1/triggers`,
 *     `/v1/chat`, `/v1/chats`, `/v1/files`, `/v1/credits`, `/v1/swarms`
 *     (the latter five added in Round 2, May 2026 — Beta).
 *
 *   * NOT in spec (so `oss: null` here): `/v1/screenshots`, `/v1/search`,
 *     `/v1/electron`, `/v1/osworld`. These remain hosted-only: screenshot
 *     storage and Google Custom Search are infra-coupled, electron bridge
 *     is a websocket relay, OSWorld is the benchmark harness. OSS mode
 *     hits these as 501s and the caller is expected to surface a
 *     "self-host this feature or upgrade to coasty.ai hosted" message.
 *
 * TODO Phase 2.5: revisit `/api/screenshots` and `/api/search` once the
 * backend team decides whether to publicize them. When a /v1/* path
 * appears in the spec, replace its `oss: null` with `{ prefix: "/v1/..." }`.
 */
const PATH_MAP: ReadonlyArray<PathMapEntry> = [
  // ── More specific prefixes first ──────────────────────────────────────────
  // Stripe / cron — never proxyable.
  { apiPrefix: "/api/credits/checkout", oss: null, match: "prefix" },
  { apiPrefix: "/api/credits/webhook", oss: null, match: "prefix" },
  { apiPrefix: "/api/credits/auto-refill", oss: null, match: "prefix" },
  // The one credits sub-route that's safe to forward (read-only balance).
  // In spec (Beta) since 2026-05.
  { apiPrefix: "/api/credits/balance", oss: { prefix: "/v1/credits" }, match: "exact" },
  { apiPrefix: "/api/credits", oss: null, match: "prefix" },

  // Local-only / admin / supabase-only routes — `oss: null` so the caller
  // returns 501 in OSS mode.
  { apiPrefix: "/api/csrf", oss: null, match: "prefix", note: "local-only, never proxied" },
  { apiPrefix: "/api/auth", oss: null, match: "prefix", note: "Supabase-only" },
  { apiPrefix: "/api/blog", oss: null, match: "prefix", note: "Supabase-only" },
  { apiPrefix: "/api/secrets", oss: null, match: "prefix", note: "BYOK disabled in OSS" },
  { apiPrefix: "/api/developers", oss: null, match: "prefix", note: "API key minting — link to coasty.ai/developers" },
  { apiPrefix: "/api/status", oss: null, match: "prefix", note: "admin/cron" },

  // ── First-party hosted features now in spec (Beta since 2026-05) ─────────
  // /api/chat → /v1/chat (SSE streaming chat). In spec (Beta) since 2026-05.
  { apiPrefix: "/api/chat", oss: { prefix: "/v1/chat" }, match: "prefix" },
  // /api/chats → /v1/chats (CRUD over saved chats + messages). In spec (Beta) since 2026-05.
  { apiPrefix: "/api/chats", oss: { prefix: "/v1/chats" }, match: "prefix" },
  // /api/files → /v1/files (multipart upload, list, delete). In spec (Beta) since 2026-05.
  { apiPrefix: "/api/files", oss: { prefix: "/v1/files" }, match: "prefix" },
  // /api/swarm{,s} → /v1/swarms (multi-machine orchestration). In spec (Beta) since 2026-05.
  { apiPrefix: "/api/swarm", oss: { prefix: "/v1/swarms" }, match: "prefix" },
  { apiPrefix: "/api/swarms", oss: { prefix: "/v1/swarms" }, match: "prefix" },
  // TODO Phase 2.5: spec needs /v1/screenshots (lookup by SHA256 id).
  { apiPrefix: "/api/screenshots", oss: null, match: "prefix" },
  // TODO Phase 2.5: spec needs /v1/search (Google Custom Search wrapper).
  { apiPrefix: "/api/search", oss: null, match: "prefix" },
  // electron and osworld are coupled to hosted infra (websocket bridge,
  // benchmark harness). Unlikely to be exposed publicly.
  { apiPrefix: "/api/electron", oss: null, match: "prefix" },
  { apiPrefix: "/api/osworld", oss: null, match: "prefix" },

  // ── In-spec mappings ──────────────────────────────────────────────────────
  // /api/models → /v1/models (model catalog).
  { apiPrefix: "/api/models", oss: { prefix: "/v1/models" }, match: "prefix" },
  // /api/schedules{,/...} → /v1/schedules (covers subtree incl. triggers).
  { apiPrefix: "/api/schedules", oss: { prefix: "/v1/schedules" }, match: "prefix" },
  // /api/machines{,/...} → /v1/machines (full machine subtree).
  { apiPrefix: "/api/machines", oss: { prefix: "/v1/machines" }, match: "prefix" },
] as const

/**
 * Returns the OSS-mode (`/v1/...`) equivalent of an incoming `/api/...`
 * path, or `null` if the route has no public coasty.ai equivalent.
 *
 * Pure function — no I/O, no env reads. Safe to unit test.
 *
 * @param apiPath A pathname starting with `/api/`. Trailing slashes and
 *   query strings should be stripped before calling — the function only
 *   looks at the path component.
 * @returns The mapped `/v1/...` path, or `null` if no mapping exists.
 */
export function mapApiPathToV1(apiPath: string): string | null {
  // Defensive: only handle /api/ paths. Anything else is a programming error
  // by the caller.
  if (!apiPath.startsWith("/api/") && apiPath !== "/api") return null

  for (const entry of PATH_MAP) {
    const matches =
      entry.match === "exact"
        ? apiPath === entry.apiPrefix
        : apiPath === entry.apiPrefix ||
          apiPath.startsWith(entry.apiPrefix + "/") ||
          apiPath.startsWith(entry.apiPrefix + "?")
    if (!matches) continue
    if (entry.oss === null) return null
    // Replace just the prefix; preserve everything after.
    const suffix = apiPath.slice(entry.apiPrefix.length)
    return entry.oss.prefix + suffix
  }
  return null
}

/**
 * `true` iff `apiPath` has a defined OSS-mode (`/v1/...`) equivalent in the
 * `PATH_MAP`. Pure function — no I/O.
 */
export function hasOssEquivalent(apiPath: string): boolean {
  return mapApiPathToV1(apiPath) !== null
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PYTHON_BACKEND_URL_DEFAULT = "http://127.0.0.1:8001"
const DEFAULT_TIMEOUT_MS = 90_000
const STREAMING_TIMEOUT_MS = 600_000
const DEFAULT_MAX_BODY_BYTES = 15 * 1024 * 1024 // 15 MB

/**
 * Headers to strip from the *outbound* (upstream) request. Cookies and
 * Origin/Host/Referer are tied to the inbound origin and meaningless on the
 * upstream call; auth in OSS mode is via `X-API-Key`, never cookies.
 */
const STRIP_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  "cookie",
  "host",
  "origin",
  "referer",
  // Inbound auth headers — replaced by the auth scheme below.
  "authorization",
  "x-api-key",
  "x-internal-key",
  // Hop-by-hop headers — Node fetch fills these.
  "connection",
  "keep-alive",
  "transfer-encoding",
  // Length is recomputed by Node fetch from the actual body bytes.
  "content-length",
])

/**
 * Headers to strip from the *upstream* response before returning to the
 * client. Node will set its own `Server` / `Date`, and `Connection` /
 * `Transfer-Encoding` are hop-by-hop (RFC 7230 §6.1).
 */
const STRIP_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
  "server",
  "date",
  "connection",
  "keep-alive",
  "transfer-encoding",
])

// ─── Error helpers ───────────────────────────────────────────────────────────

function jsonError(
  status: number,
  code: string,
  message: string,
  type: "validation_error" | "server_error" | "authentication_error" = "server_error",
): Response {
  return new Response(JSON.stringify({ error: { code, message, type } }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

// ─── Header builders ─────────────────────────────────────────────────────────

function buildOutboundHeaders(
  req: NextRequest,
  oss: boolean,
  auth: AuthMode,
  extraHeaders: Record<string, string> | undefined,
): Headers {
  const out = new Headers()

  // Forward incoming headers minus the strip-list.
  req.headers.forEach((value, key) => {
    if (STRIP_REQUEST_HEADERS.has(key.toLowerCase())) return
    out.set(key, value)
  })

  // Apply auth scheme.
  if (auth === "internal") {
    const internalKey = process.env.INTERNAL_API_KEY || ""
    if (internalKey) out.set("X-Internal-Key", internalKey)
  } else if (auth === "bearer") {
    const incoming = req.headers.get("authorization")
    if (incoming) out.set("Authorization", incoming)
  } else if (auth === "api-key") {
    if (oss) {
      // OSS mode: always sign with the server-side COASTY_API_KEY. We
      // intentionally do NOT trust an inbound X-API-Key header — that
      // would let a client bypass our quota / billing.
      const key = requireCoastyApiKey()
      out.set("X-API-Key", key)
      out.set("Authorization", `Bearer ${key}`)
    } else {
      // Production mode: legacy behaviour from
      // app/api/v1/cua/[...path]/route.ts — pass through whatever the
      // client sent.
      const incoming = req.headers.get("x-api-key")
      if (incoming) out.set("X-API-Key", incoming)
    }
  }
  // auth === "none" → no auth header injected.

  // OSS mode telemetry tag (mirrors mcp/src/client.ts).
  if (oss) {
    out.set("X-Coasty-Source", "web-oss")
  }

  // Caller-supplied extras override anything above.
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) out.set(k, v)
  }

  return out
}

function copyResponseHeaders(upstream: Response): Headers {
  const out = new Headers()
  upstream.headers.forEach((value, key) => {
    if (STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) return
    out.set(key, value)
  })
  return out
}

// ─── Streaming detection ─────────────────────────────────────────────────────

function isStreamingResponse(req: NextRequest, upstream: Response): boolean {
  const ct = upstream.headers.get("content-type") || ""
  if (ct.toLowerCase().includes("text/event-stream")) return true
  if (ct.toLowerCase().includes("stream")) return true
  // Caller hint — set on the request when the route knows it's SSE before
  // the first byte arrives (rare; useful for unit tests).
  if (req.headers.get("x-coasty-streaming") === "true") return true
  return false
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Forward an incoming Next.js request to either the local FastAPI backend
 * (production mode) or coasty.ai/v1/* (OSS mode). Returns a `Response` that
 * streams the upstream body straight through — never buffered.
 *
 * The calling route file is responsible for `export const runtime = "nodejs"`
 * — Edge runtime cannot handle streaming bodies with `duplex: "half"`.
 *
 * Errors:
 *
 *   * 501 `NOT_AVAILABLE_IN_OSS_MODE` — OSS mode + path has no /v1 mapping.
 *   * 503 `UPSTREAM_UNREACHABLE` — network error reaching the upstream.
 *   * 504 `UPSTREAM_TIMEOUT` — request exceeded `timeoutMs`.
 *   * 413 `PAYLOAD_TOO_LARGE` — buffered body exceeded `maxBodyBytes`.
 *
 * Other status codes are pass-through from the upstream.
 */
export async function forwardToBackend(
  req: NextRequest,
  opts: ForwardOptions = {},
): Promise<Response> {
  const fetchImpl = opts.__fetch ?? fetch
  const oss = isOssMode()
  const auth: AuthMode = opts.auth ?? (oss ? "api-key" : "internal")
  const method = opts.method ?? req.method
  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES

  // ── Resolve target path ────────────────────────────────────────────────
  const inboundPath = req.nextUrl.pathname
  let targetPath: string
  if (opts.path) {
    targetPath = opts.path
  } else if (oss) {
    const mapped = mapApiPathToV1(inboundPath)
    if (mapped === null) {
      return jsonError(
        501,
        "NOT_AVAILABLE_IN_OSS_MODE",
        "This endpoint requires self-hosted mode.",
        "validation_error",
      )
    }
    targetPath = mapped
  } else {
    // Production mode: keep the /api/... path verbatim — that's what the
    // FastAPI backend serves on.
    targetPath = inboundPath
  }

  // ── Build target URL with query string passthrough ─────────────────────
  const baseUrl = oss ? getCoastyApiBaseUrl() : (process.env.PYTHON_BACKEND_URL || PYTHON_BACKEND_URL_DEFAULT)
  const url = new URL(targetPath, baseUrl)
  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v))

  // ── Headers ────────────────────────────────────────────────────────────
  const outboundHeaders = buildOutboundHeaders(req, oss, auth, opts.extraHeaders)

  // ── Body handling ──────────────────────────────────────────────────────
  const isBodyMethod = method !== "GET" && method !== "HEAD"
  const contentType = req.headers.get("content-type") || ""
  const isMultipart = contentType.toLowerCase().startsWith("multipart/form-data")
  const passthroughBody = opts.passthroughBody ?? isMultipart

  let outboundBody: BodyInit | undefined = undefined
  let needsDuplex = false

  if (isBodyMethod && opts.body !== undefined) {
    // Caller-supplied body wins — typically because the route already
    // consumed `req.body` to mutate / authorize fields. Skip both the
    // buffered `req.text()` read (the underlying stream is already drained)
    // and the size cap (caller's responsibility).
    if (typeof opts.body === "string") {
      outboundBody = opts.body
    } else {
      outboundBody = opts.body
      needsDuplex = true
    }
  } else if (isBodyMethod) {
    // Defensive Content-Length check (only for buffered path; streamed
    // bodies bypass this — caps belong upstream).
    if (!passthroughBody) {
      const cl = req.headers.get("content-length")
      if (cl) {
        const n = parseInt(cl, 10)
        if (Number.isFinite(n) && n > maxBodyBytes) {
          return jsonError(
            413,
            "PAYLOAD_TOO_LARGE",
            `Request body exceeds ${maxBodyBytes} byte limit`,
            "validation_error",
          )
        }
      }
      let text: string
      try {
        text = await req.text()
      } catch {
        text = ""
      }
      if (text.length > maxBodyBytes) {
        return jsonError(
          413,
          "PAYLOAD_TOO_LARGE",
          `Request body exceeds ${maxBodyBytes} byte limit`,
          "validation_error",
        )
      }
      if (text.length > 0) outboundBody = text
    } else {
      // Streaming body. `req.body` is a ReadableStream<Uint8Array>; pass
      // straight through. `duplex: "half"` is required by Node 18+'s
      // fetch when the body is a stream (https://nodejs.org/api/fetch.html).
      if (req.body) {
        outboundBody = req.body
        needsDuplex = true
      }
    }
  }

  // ── Timeout / abort ────────────────────────────────────────────────────
  // We can't know up-front whether the response will stream, so we use the
  // longer ceiling when the caller hasn't specified — most routes can
  // afford the extra slack, and bursty SSE loops actually need it.
  const baseTimeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort("timeout"), baseTimeout)
  // Compose with the inbound request's abort signal so a client disconnect
  // tears down the upstream call promptly.
  const onInboundAbort = () => {
    try {
      controller.abort("inbound-abort")
    } catch {
      /* ignore */
    }
  }
  if (req.signal.aborted) {
    clearTimeout(timer)
    return jsonError(499, "CLIENT_DISCONNECTED", "Client disconnected before upstream call.", "server_error")
  }
  req.signal.addEventListener("abort", onInboundAbort, { once: true })

  // ── Fire the request ───────────────────────────────────────────────────
  // `RequestInit` doesn't yet declare `duplex` in lib.dom.d.ts; it's a
  // valid Node 18+ fetch init key. Cast through Record to avoid an
  // explicit `any`.
  const init: RequestInit = {
    method,
    headers: outboundHeaders,
    body: outboundBody,
    signal: controller.signal,
  }
  if (needsDuplex) {
    ;(init as RequestInit & { duplex?: "half" }).duplex = "half"
  }

  let upstream: Response
  try {
    upstream = await fetchImpl(url.toString(), init)
  } catch (err: unknown) {
    clearTimeout(timer)
    req.signal.removeEventListener("abort", onInboundAbort)
    const isAbort = err instanceof Error && err.name === "AbortError"
    if (isAbort) {
      const reason = controller.signal.reason
      if (reason === "inbound-abort") {
        return jsonError(499, "CLIENT_DISCONNECTED", "Client disconnected.", "server_error")
      }
      return jsonError(
        504,
        "UPSTREAM_TIMEOUT",
        `Upstream request timed out after ${baseTimeout}ms.`,
        "server_error",
      )
    }
    return jsonError(
      503,
      "UPSTREAM_UNREACHABLE",
      oss
        ? "coasty.ai is not reachable. Check your connection."
        : "Local backend is not reachable. Check that the FastAPI server is running.",
      "server_error",
    )
  }

  // The body might still be streaming after fetch returns headers. We keep
  // the timer alive for streaming responses up to STREAMING_TIMEOUT_MS so a
  // stuck SSE connection eventually unblocks; for non-streaming responses
  // the timer is moot once we've handed the body off and clearing it is
  // harmless.
  clearTimeout(timer)
  const streaming = isStreamingResponse(req, upstream)
  let streamingTimer: ReturnType<typeof setTimeout> | undefined
  if (streaming) {
    const streamMs = opts.timeoutMs ?? STREAMING_TIMEOUT_MS
    streamingTimer = setTimeout(() => controller.abort("stream-timeout"), streamMs)
  }

  // ── Build response ─────────────────────────────────────────────────────
  const responseHeaders = copyResponseHeaders(upstream)
  if (streaming) {
    // Belt + braces for nginx / Cloudflare passthrough — these may not be
    // set by the upstream and matter a lot for SSE responsiveness.
    responseHeaders.set("Cache-Control", "no-cache, no-transform")
    responseHeaders.set("Connection", "keep-alive")
    responseHeaders.set("X-Accel-Buffering", "no")
  }

  // Wire up cleanup on the response stream so timers / inbound listeners
  // are dropped when the client finishes reading or cancels.
  let body: ReadableStream<Uint8Array> | null = upstream.body
  if (body && (streamingTimer || true)) {
    const upstreamBody = body
    body = new ReadableStream<Uint8Array>({
      start(streamController) {
        const reader = upstreamBody.getReader()
        const cleanup = () => {
          if (streamingTimer) clearTimeout(streamingTimer)
          req.signal.removeEventListener("abort", onInboundAbort)
        }
        const pump = async (): Promise<void> => {
          try {
            for (;;) {
              const { done, value } = await reader.read()
              if (done) {
                streamController.close()
                cleanup()
                return
              }
              if (req.signal.aborted || controller.signal.aborted) {
                try {
                  reader.cancel()
                } catch {
                  /* ignore */
                }
                streamController.close()
                cleanup()
                return
              }
              streamController.enqueue(value)
            }
          } catch (err) {
            try {
              reader.cancel()
            } catch {
              /* ignore */
            }
            try {
              streamController.error(err)
            } catch {
              /* ignore */
            }
            cleanup()
          }
        }
        void pump()
      },
      cancel() {
        try {
          controller.abort("response-cancel")
        } catch {
          /* ignore */
        }
        if (streamingTimer) clearTimeout(streamingTimer)
        req.signal.removeEventListener("abort", onInboundAbort)
      },
    })
  } else {
    // No body (e.g. 204) — still need to drop listeners.
    req.signal.removeEventListener("abort", onInboundAbort)
  }

  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  })
}

// Runtime guard: if this module somehow ends up evaluated in a browser
// context (bad bundling, accidental client import), throw immediately so
// the failure is loud and the env reads above never have a chance to
// expose secrets via a build-time inline.
if (typeof window !== "undefined") {
  throw new Error(
    "lib/api-router.ts was imported in a client environment. " +
      "This module is server-only and reads server-only secrets " +
      "(INTERNAL_API_KEY, COASTY_API_KEY). Move the import to a server " +
      "component, route handler, or server action.",
  )
}
