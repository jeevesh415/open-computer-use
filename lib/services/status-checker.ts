/**
 * Background status checker — runs every 60 seconds on ECS to populate
 * the status_checks table for the uptime history bars on /status.
 */

import { createClient } from "@supabase/supabase-js"

const CHECK_INTERVAL_MS = 60_000 // 1 minute
let intervalId: ReturnType<typeof setInterval> | null = null

interface CheckResult {
  service_name: string
  status: "operational" | "degraded" | "outage"
  latency: number | null
  message: string | null
  checked_at: string
}

async function checkService(
  name: string,
  fn: () => Promise<void>
): Promise<CheckResult> {
  const start = Date.now()
  const now = new Date().toISOString()
  try {
    await fn()
    return { service_name: name, status: "operational", latency: Date.now() - start, message: null, checked_at: now }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    return { service_name: name, status: "outage", latency: null, message: msg, checked_at: now }
  }
}

async function runChecks() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE
  const backendUrl = process.env.PYTHON_BACKEND_URL || "http://127.0.0.1:8001"
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""

  if (!supabaseUrl) return

  // Service role client for persistence (may be null if not configured)
  const supabase = supabaseServiceRole
    ? createClient(supabaseUrl, supabaseServiceRole, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null

  const checks = await Promise.all([
    checkService("Website", async () => {
      // Self-check: if this code is running, the frontend server is up
    }),

    checkService("AI Backend", async () => {
      const res = await fetch(`${backendUrl}/api/health`, {
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.status !== "healthy") throw new Error("Unhealthy")
    }),

    checkService("Database", async () => {
      if (supabase) {
        const { error } = await supabase.from("users").select("id").limit(1)
        if (error) throw new Error(error.message)
      } else {
        // Fall back to REST API ping
        const res = await fetch(`${supabaseUrl}/rest/v1/`, {
          headers: { apikey: anonKey },
          signal: AbortSignal.timeout(5000),
        })
        if (res.status >= 500) throw new Error(`HTTP ${res.status}`)
      }
    }),

    checkService("Authentication", async () => {
      const res = await fetch(`${supabaseUrl}/auth/v1/health`, {
        headers: { apikey: anonKey },
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    }),

    checkService("AI Models", async () => {
      const res = await fetch(`${backendUrl}/api/ready`, {
        signal: AbortSignal.timeout(10000),
      })
      const data = await res.json()
      if (data.models === "error") throw new Error("Model provider unreachable")
      if (data.status !== "ready" && data.models !== "available")
        throw new Error(data.status || "Not ready")
    }),

    checkService("File Storage", async () => {
      const res = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
        signal: AbortSignal.timeout(5000),
      })
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`)
    }),
  ])

  if (supabase) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("status_checks").insert(checks)
    if (error) {
      console.error("[StatusChecker] Failed to insert checks:", error.message)
    }
  }
}

export function startStatusChecker() {
  if (intervalId) return

  // Run first check after 10s delay (let the server finish starting)
  setTimeout(() => {
    runChecks().catch((e) => console.error("[StatusChecker] Error:", e))
  }, 10_000)

  // Then run every 60 seconds
  intervalId = setInterval(() => {
    runChecks().catch((e) => console.error("[StatusChecker] Error:", e))
  }, CHECK_INTERVAL_MS)

  console.log(`[StatusChecker] Scheduled every ${CHECK_INTERVAL_MS / 1000}s`)
}

export function stopStatusChecker() {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
    console.log("[StatusChecker] Stopped")
  }
}
