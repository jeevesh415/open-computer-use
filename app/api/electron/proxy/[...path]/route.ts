/**
 * Catch-all proxy for Electron desktop app → Python backend.
 *
 * The Electron app sends Bearer token auth (not cookies). This route:
 * 1. Verifies the Bearer JWT against Supabase
 * 2. Forwards the request to the Python backend with X-Internal-Key
 *
 * Usage: Electron calls /api/electron/proxy/chats/create
 *        → this route strips the prefix and forwards to Python /api/chats/create
 */

import { NextRequest, NextResponse } from "next/server"
import { verifyBearerToken } from "@/lib/supabase/bearer-auth"

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || "http://127.0.0.1:8001"
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || ""

async function proxyToBackend(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  // Authenticate via Bearer token
  const { user, error } = await verifyBearerToken(req)
  if (!user) {
    return NextResponse.json({ error: error || "Unauthorized" }, { status: 401 })
  }

  const { path } = await params
  let backendPath = `/api/${path.join("/")}`
  // Preserve trailing slash from the original request — FastAPI requires it
  // for routes defined as @router.post("/") and will 307 redirect without it.
  if (req.nextUrl.pathname.endsWith("/")) {
    backendPath += "/"
  }

  // Build the target URL, preserving query params
  const url = new URL(backendPath, PYTHON_BACKEND_URL)
  req.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value)
  })

  // Forward headers, replacing auth with internal key + verified user ID
  const headers: Record<string, string> = {
    "Content-Type": req.headers.get("Content-Type") || "application/json",
    "X-User-ID": user.id,
    ...(INTERNAL_API_KEY && { "X-Internal-Key": INTERNAL_API_KEY }),
    ...(req.headers.get("Accept") && { "Accept": req.headers.get("Accept")! }),
  }

  // Read body once for non-GET requests (needed for potential redirect retry)
  let bodyString: string | undefined
  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      const body = await req.json()
      // Enforce verified user_id so clients can't spoof it
      body.user_id = user.id
      bodyString = JSON.stringify(body)
    } catch {
      // No body or non-JSON body
    }
  }

  try {
    // Disable automatic redirect following — some Node.js versions drop the
    // POST body on 307/308 redirects. We handle redirects manually instead.
    const response = await fetch(url.toString(), {
      method: req.method,
      headers,
      body: bodyString,
      redirect: "manual",
    })

    // Handle FastAPI's trailing-slash redirects (307/308) manually to ensure
    // the POST body and auth headers are preserved.
    if (response.status === 307 || response.status === 308) {
      const location = response.headers.get("Location")
      if (location) {
        // Resolve relative Location against the original URL
        const redirectUrl = new URL(location, url)
        // Re-send query params if the redirect URL doesn't have them
        url.searchParams.forEach((value, key) => {
          if (!redirectUrl.searchParams.has(key)) {
            redirectUrl.searchParams.set(key, value)
          }
        })

        const redirectResponse = await fetch(redirectUrl.toString(), {
          method: req.method,
          headers,
          body: bodyString,
          redirect: "manual",
        })

        return streamResponse(redirectResponse)
      }
    }

    return streamResponse(response)
  } catch {
    return NextResponse.json(
      { error: "Failed to connect to backend service" },
      { status: 503 },
    )
  }
}

/** Stream a backend response back to the client, preserving status and headers. */
function streamResponse(response: Response) {
  const responseHeaders = new Headers()
  response.headers.forEach((value, key) => {
    if (!["transfer-encoding", "connection"].includes(key.toLowerCase())) {
      responseHeaders.set(key, value)
    }
  })
  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  })
}

export const GET = proxyToBackend
export const POST = proxyToBackend
export const PATCH = proxyToBackend
export const DELETE = proxyToBackend
export const PUT = proxyToBackend
