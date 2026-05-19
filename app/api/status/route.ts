import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import {
  determineOverallStatus,
  statusCacheHeader,
  SERVICE_NAMES,
  runAllChecks,
} from "@/lib/status"
import type { ServiceCheck, ServiceStatus } from "@/lib/status"

export const dynamic = "force-dynamic"

export async function GET() {
  // Cast to `any` — `status_checks` is not in the generated Database types
  const supabase = createServiceClient() as any

  // If DB is unavailable, fall back to live checks
  if (!supabase) {
    const checks = await runAllChecks()
    const overall = determineOverallStatus(checks)
    return NextResponse.json(
      { overall, timestamp: new Date().toISOString(), services: checks },
      { headers: { "Cache-Control": statusCacheHeader(overall) } },
    )
  }

  // Read the most recent check per service from the last 5 minutes
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const { data: rows, error } = await supabase
    .from("status_checks")
    .select("service_name, status, latency, message, checked_at")
    .gte("checked_at", fiveMinAgo)
    .order("checked_at", { ascending: false })
    .limit(50)

  // If DB query fails or returns no recent data, fall back to live checks and seed DB
  if (error || !rows || rows.length === 0) {
    const { toCheckRows } = await import("@/lib/status")
    const checks = await runAllChecks()
    const overall = determineOverallStatus(checks)

    // Seed the DB so history starts accumulating
    if (supabase) {
      supabase.from("status_checks").insert(toCheckRows(checks)).then(() => {}).catch(() => {})
    }

    return NextResponse.json(
      { overall, timestamp: new Date().toISOString(), services: checks },
      { headers: { "Cache-Control": statusCacheHeader(overall) } },
    )
  }

  // Pick the latest row per service
  const latestByService = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    if (!latestByService.has(row.service_name)) {
      latestByService.set(row.service_name, row)
    }
  }

  const services: ServiceCheck[] = SERVICE_NAMES.map((name) => {
    const row = latestByService.get(name)
    if (!row) {
      return { name, status: "operational" as ServiceStatus, latency: null, message: "No recent check data" }
    }
    return {
      name,
      status: row.status as ServiceStatus,
      latency: row.latency,
      ...(row.message ? { message: row.message } : {}),
    }
  })

  const overall = determineOverallStatus(services)
  const timestamp = rows[0].checked_at

  return NextResponse.json(
    { overall, timestamp, services },
    { headers: { "Cache-Control": statusCacheHeader(overall) } },
  )
}
