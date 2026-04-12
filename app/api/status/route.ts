import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const PYTHON_BACKEND_URL =
  process.env.PYTHON_BACKEND_URL || "http://127.0.0.1:8001"

interface ServiceCheck {
  name: string
  status: "operational" | "degraded" | "outage"
  latency: number | null
  message?: string
}

async function checkService(
  name: string,
  fn: () => Promise<void>
): Promise<ServiceCheck> {
  const start = Date.now()
  try {
    await fn()
    return { name, status: "operational", latency: Date.now() - start }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    return { name, status: "outage", latency: null, message: msg }
  }
}

export async function GET() {
  const checks = await Promise.all([
    // 1. Website / Frontend
    checkService("Website", async () => {
      // If this endpoint is responding, the frontend is up
    }),

    // 2. AI Backend
    checkService("AI Backend", async () => {
      const res = await fetch(`${PYTHON_BACKEND_URL}/api/health`, {
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.status !== "healthy") throw new Error("Unhealthy")
    }),

    // 3. Database (Supabase)
    checkService("Database", async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      if (!url) throw new Error("Supabase URL not configured")
      const res = await fetch(`${url}/rest/v1/`, {
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
        },
        signal: AbortSignal.timeout(5000),
      })
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`)
    }),

    // 4. Authentication
    checkService("Authentication", async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      if (!url) throw new Error("Supabase URL not configured")
      const res = await fetch(`${url}/auth/v1/health`, {
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
        },
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    }),

    // 5. AI Models (readiness check — verifies Bedrock/model provider connectivity)
    checkService("AI Models", async () => {
      const res = await fetch(`${PYTHON_BACKEND_URL}/api/ready`, {
        signal: AbortSignal.timeout(10000),
      })
      const data = await res.json()
      if (data.models === "error") throw new Error("Model provider unreachable")
      if (data.status !== "ready" && data.models !== "available")
        throw new Error(data.status || "Not ready")
    }),

    // 6. File Storage (Supabase Storage)
    checkService("File Storage", async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      if (!url) throw new Error("Supabase URL not configured")
      const res = await fetch(`${url}/storage/v1/bucket`, {
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""}`,
        },
        signal: AbortSignal.timeout(5000),
      })
      // 200 = buckets listed, 400 = no auth but storage responding, 401/403 = storage is up but auth needed (still operational)
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`)
    }),
  ])

  // Persistence is handled by the backend's periodic_status_check (main.py).
  // This endpoint only returns the current live check results.

  const allOperational = checks.every((c) => c.status === "operational")
  const hasOutage = checks.some((c) => c.status === "outage")

  const overall = allOperational
    ? "operational"
    : hasOutage
      ? "outage"
      : "degraded"

  return NextResponse.json(
    {
      overall,
      timestamp: new Date().toISOString(),
      services: checks,
    },
    {
      headers: {
        "Cache-Control": allOperational
          ? "public, max-age=15, s-maxage=15, stale-while-revalidate=10"
          : "no-store, no-cache, must-revalidate",
      },
    }
  )
}
