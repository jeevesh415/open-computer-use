import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { runAllChecks, toCheckRows } from "@/lib/status"

const CRON_SECRET = process.env.CRON_SECRET

export async function GET(request: Request) {
  // Always require auth — refuse if CRON_SECRET is not configured at all
  const authHeader = request.headers.get("authorization")
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const checks = await runAllChecks()
  const now = new Date().toISOString()
  const rows = toCheckRows(checks, now)

  // Persist to database (best-effort)
  const supabase = createServiceClient()
  if (supabase) {
    const { error } = await (supabase as any).from("status_checks").insert(rows)
    if (error) {
      console.error("[Status Cron] Failed to persist checks:", error.message)
    }
  }

  return NextResponse.json({
    ok: true,
    timestamp: now,
    checks: checks.map((c) => ({ service: c.name, status: c.status })),
  })
}
