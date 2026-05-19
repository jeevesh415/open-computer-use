/**
 * Background status checker — runs every 60 seconds on ECS to populate
 * the status_checks table for the uptime history bars on /status.
 */

import { createClient } from "@supabase/supabase-js"
import { runAllChecks, toCheckRows, buildCheckContext } from "@/lib/status"

const CHECK_INTERVAL_MS = 60_000
let intervalId: ReturnType<typeof setInterval> | null = null

async function runAndPersist() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE

  if (!supabaseUrl) return

  const ctx = buildCheckContext()
  const checks = await runAllChecks(ctx)
  const rows = toCheckRows(checks)

  if (supabaseServiceRole) {
    const supabase = createClient(supabaseUrl, supabaseServiceRole, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error } = await supabase.from("status_checks").insert(rows)
    if (error) {
      console.error("[StatusChecker] Failed to insert checks:", error.message)
    }
  }
}

export function startStatusChecker() {
  if (intervalId) return

  // Run first check after 10s delay (let the server finish starting)
  setTimeout(() => {
    runAndPersist().catch((e) => console.error("[StatusChecker] Error:", e))
  }, 10_000)

  intervalId = setInterval(() => {
    runAndPersist().catch((e) => console.error("[StatusChecker] Error:", e))
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
