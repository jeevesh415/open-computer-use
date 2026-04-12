/**
 * Catch-all proxy for OSWorld evaluation API → Python backend.
 *
 * Authenticates via X-OSWorld-Key header (dedicated OSWorld API key,
 * separate from the internal API key). No Supabase auth required.
 *
 * Usage: OSWorld client calls /api/osworld/session
 *        → this route forwards to Python backend /api/osworld/session
 */

import { NextRequest, NextResponse } from "next/server"

const PYTHON_BACKEND_URL =
  process.env.PYTHON_BACKEND_URL || "http://127.0.0.1:8001"
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || ""

async function proxyToBackend(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  // Authenticate via dedicated OSWorld API key
  const osworldKey = req.headers.get("X-OSWorld-Key")
  if (!osworldKey) {
    return NextResponse.json(
      { error: "Missing X-OSWorld-Key header" },
      { status: 401 },
    )
  }

  const { path } = await params
  const backendPath = `/api/osworld/${path.join("/")}`

  // Build target URL, preserving query params
  const url = new URL(backendPath, PYTHON_BACKEND_URL)
  req.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value)
  })

  // Forward with internal key + OSWorld key
  const headers: Record<string, string> = {
    "Content-Type": req.headers.get("Content-Type") || "application/json",
    "X-OSWorld-Key": osworldKey,
    ...(INTERNAL_API_KEY && { "X-Internal-Key": INTERNAL_API_KEY }),
  }

  const fetchOptions: RequestInit = {
    method: req.method,
    headers,
  }

  // Forward body for non-GET requests
  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      const body = await req.json()
      fetchOptions.body = JSON.stringify(body)
    } catch {
      // No body or non-JSON body
    }
  }

  try {
    const response = await fetch(url.toString(), fetchOptions)

    // Stream the response back
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
  } catch {
    return NextResponse.json(
      { error: "Failed to connect to backend service" },
      { status: 503 },
    )
  }
}

export const GET = proxyToBackend
export const POST = proxyToBackend
export const DELETE = proxyToBackend

export const maxDuration = 7200
