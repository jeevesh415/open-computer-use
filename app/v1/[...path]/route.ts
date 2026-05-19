/**
 * Public Coasty API proxy — /v1/* (canonical)
 *
 * This is the marketing-friendly URL surface for the public API. Customers
 * call https://coasty.ai/v1/predict, /v1/sessions, etc. (or the api.coasty.ai
 * subdomain when it's set up at the edge).
 *
 * The handler is a thin pass-through to the FastAPI backend's /v1/* router
 * (mounted in backend/main.py). Auth is X-API-Key (or Authorization: Bearer)
 * — handled by the backend's get_api_key_context dependency, NOT by Next.js.
 *
 * The legacy /api/v1/cua/* alias remains live (see app/api/v1/cua/...) until
 * the legacy-key sunset date in API_KEY_LEGACY_SUNSET_DATE (2026-11-01).
 *
 * Limits enforced here (Cloudflare and ALB also enforce upstream):
 *  * 15MB body limit (a screenshot + metadata fits in 4-8MB; cap at 15MB)
 *  * 90s upstream fetch timeout (must finish before Cloudflare's ~100s)
 *  * 300s maxDuration (Vercel/Next.js function-level timeout)
 */

import { NextRequest, NextResponse } from "next/server"

const PYTHON_BACKEND_URL =
  process.env.PYTHON_BACKEND_URL || "http://127.0.0.1:8001"

// Reject bodies larger than this. 15MB is enough for a 1280x720 JPEG-65
// screenshot plus metadata + reasonable trajectory history. Bigger bodies
// almost always mean misuse (e.g. user pasting a 4K PNG by accident).
const MAX_BODY_BYTES = 15 * 1024 * 1024

// Hop-by-hop headers we must NOT forward back to the client. These are
// connection-specific and break under HTTP/2 stream multiplexing.
const HOP_BY_HOP = new Set([
  "transfer-encoding",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "upgrade",
])

async function proxyToBackend(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params

  // Defensive: refuse path traversal attempts in the catch-all segment.
  // Next.js dynamic routes already filter out leading slashes, but a path
  // segment containing ".." would let the request escape the /v1/ namespace
  // when joined naively. We don't trust the join — explicitly reject the
  // segment if any component looks suspicious.
  for (const seg of path) {
    if (seg === "" || seg === "." || seg === ".." || seg.includes("/") || seg.includes("\\")) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_PATH",
            message: "Invalid path segment.",
            type: "validation_error",
          },
        },
        { status: 400 },
      )
    }
  }

  const backendPath = `/v1/${path.join("/")}`

  // Build target URL, preserving query params.
  const url = new URL(backendPath, PYTHON_BACKEND_URL)
  req.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value)
  })

  // Forward auth + content-type headers. We deliberately do NOT forward
  // arbitrary client headers — opening that surface lets the caller pass
  // X-User-ID or X-Internal-Key and trick the backend's middleware. Keep
  // the proxy minimal.
  const headers: Record<string, string> = {
    "Content-Type": req.headers.get("Content-Type") || "application/json",
  }

  // Pass through X-API-Key (canonical).
  const apiKey = req.headers.get("X-API-Key")
  if (apiKey) {
    headers["X-API-Key"] = apiKey
  }
  // Also pass through Authorization: Bearer ... — accepted as an API-key
  // alternative by the backend dependency (sk-coasty-* / cua_sk_* tokens
  // detected by prefix). Supabase JWTs would be rejected by the backend
  // since /v1/* skips the InternalAPIKeyMiddleware path.
  const authz = req.headers.get("Authorization")
  if (authz) {
    headers["Authorization"] = authz
  }

  // Idempotency-Key passthrough — backend stores the result for 24h and
  // dedupes by this key.
  const idemp = req.headers.get("Idempotency-Key")
  if (idemp) {
    headers["Idempotency-Key"] = idemp
  }

  const fetchOptions: RequestInit = {
    method: req.method,
    headers,
  }

  // Forward body for non-GET/HEAD requests. Reject oversized bodies BEFORE
  // forwarding (don't waste backend bandwidth on requests we'd kill anyway).
  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      const contentLength = req.headers.get("content-length")
      if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
        return NextResponse.json(
          {
            error: {
              code: "PAYLOAD_TOO_LARGE",
              message: `Request body exceeds ${MAX_BODY_BYTES / 1024 / 1024}MB limit`,
              type: "validation_error",
            },
          },
          { status: 413 },
        )
      }
      const body = await req.text()
      if (body.length > MAX_BODY_BYTES) {
        return NextResponse.json(
          {
            error: {
              code: "PAYLOAD_TOO_LARGE",
              message: `Request body exceeds ${MAX_BODY_BYTES / 1024 / 1024}MB limit`,
              type: "validation_error",
            },
          },
          { status: 413 },
        )
      }
      if (body) {
        fetchOptions.body = body
      }
    } catch {
      // No body
    }
  }

  try {
    // 90s timeout — must finish before Cloudflare's ~100s proxy timeout
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 90_000)

    const response = await fetch(url.toString(), {
      ...fetchOptions,
      signal: controller.signal,
    })

    clearTimeout(timeout)

    // Stream the response back, preserving status and headers.
    const responseHeaders = new Headers()
    response.headers.forEach((value, key) => {
      const lower = key.toLowerCase()
      if (!HOP_BY_HOP.has(lower)) {
        responseHeaders.set(key, value)
      }
    })

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    })
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "AbortError"
    return NextResponse.json(
      {
        error: {
          code: isTimeout ? "PREDICTION_TIMEOUT" : "SERVICE_UNAVAILABLE",
          message: isTimeout
            ? "Request timed out. The AI model may be under heavy load — please retry."
            : "API service temporarily unavailable",
          type: "server_error",
        },
      },
      { status: isTimeout ? 504 : 503 },
    )
  }
}

export const GET = proxyToBackend
export const POST = proxyToBackend
export const PUT = proxyToBackend
export const PATCH = proxyToBackend
export const DELETE = proxyToBackend

// Allow long-running requests (sessions, predictions can take time)
export const maxDuration = 300
