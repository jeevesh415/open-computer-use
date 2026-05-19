import { NextResponse } from 'next/server'

// Security headers — middleware.ts excludes /api/* from its matcher, so route
// handlers under /api must set these directly.
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
} as const

export async function GET() {
  try {
    const healthStatus = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV,
    }

    return NextResponse.json(healthStatus, { headers: SECURITY_HEADERS })
  } catch (error) {
    return NextResponse.json(
      {
        status: "unhealthy",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString()
      },
      { status: 500, headers: SECURITY_HEADERS }
    )
  }
} 