import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { SERVICE_NAMES } from "@/lib/status"
import type { ServiceStatus } from "@/lib/status"

const HISTORY_DAYS = 7
const PAGE_SIZE = 1000

export async function GET() {
  // Cast to `any` — `status_checks` is not in the generated Database types
  const supabase = createServiceClient() as any

  if (!supabase) {
    return NextResponse.json(
      { services: [], has_data: false },
      { headers: { "Cache-Control": "no-store" } },
    )
  }

  try {
    const cutoff = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString()

    // Aggregate per service → per date as we paginate
    const serviceDays = new Map<
      string,
      Map<string, { op: number; degraded: number; outage: number; latencies: number[] }>
    >()

    let offset = 0
    let totalFetched = 0

    // Paginate — Supabase PostgREST caps at 1000 rows per request
    while (true) {
      const { data: rows, error } = await supabase
        .from("status_checks")
        .select("service_name, status, latency, checked_at")
        .gte("checked_at", cutoff)
        .order("checked_at", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1)

      if (error) {
        console.error("[Status History] Query failed:", error.message)
        break
      }

      if (!rows || rows.length === 0) break

      for (const row of rows) {
        const date = (row.checked_at as string).split("T")[0]
        let dayMap = serviceDays.get(row.service_name)
        if (!dayMap) {
          dayMap = new Map()
          serviceDays.set(row.service_name, dayMap)
        }
        let day = dayMap.get(date)
        if (!day) {
          day = { op: 0, degraded: 0, outage: 0, latencies: [] }
          dayMap.set(date, day)
        }

        if (row.status === "operational") day.op++
        else if (row.status === "degraded") day.degraded++
        else day.outage++

        if (row.latency != null) day.latencies.push(row.latency as number)
      }

      totalFetched += rows.length
      if (rows.length < PAGE_SIZE) break
      offset += PAGE_SIZE
      if (totalFetched >= 100_000) break // safety cap
    }

    if (totalFetched === 0) {
      // No data at all — run a live check and seed the DB
      const { runAllChecks, toCheckRows } = await import("@/lib/status")
      const checks = await runAllChecks()
      const seedRows = toCheckRows(checks)
      supabase.from("status_checks").insert(seedRows).then(() => {}).catch(() => {})

      const today = new Date().toISOString().split("T")[0]
      const services = checks.map((c) => ({
        service_name: c.name,
        days: Array.from({ length: HISTORY_DAYS }, (_, idx) => {
          const d = new Date()
          d.setDate(d.getDate() - (HISTORY_DAYS - 1 - idx))
          const dateStr = d.toISOString().split("T")[0]
          if (dateStr === today) {
            return {
              date: dateStr,
              status: c.status,
              checks: 1,
              operational_count: c.status === "operational" ? 1 : 0,
              avg_latency: c.latency,
            }
          }
          return { date: dateStr, status: "operational" as const, checks: 0, operational_count: 0, avg_latency: null }
        }),
        uptime_percent: 100,
      }))

      return NextResponse.json(
        { services, has_data: true },
        { headers: { "Cache-Control": "no-store" } },
      )
    }

    // Build 7-day response for all canonical services
    const today = new Date()
    const services = []

    const serviceNamesWithData = new Set(serviceDays.keys())
    for (const name of SERVICE_NAMES) serviceNamesWithData.add(name)

    for (const serviceName of serviceNamesWithData) {
      const dayMap = serviceDays.get(serviceName)
      const days = []
      let totalChecks = 0
      let totalOp = 0

      for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
        const d = new Date(today)
        d.setDate(d.getDate() - i)
        const dateStr = d.toISOString().split("T")[0]
        const data = dayMap?.get(dateStr)

        if (data) {
          const checks = data.op + data.degraded + data.outage
          const nonOpRatio = checks > 0 ? (checks - data.op) / checks : 0

          let status: ServiceStatus = "operational"
          if (data.outage > 0 && nonOpRatio > 0.3) status = "outage"
          else if ((data.degraded > 0 || data.outage > 0) && nonOpRatio > 0.1) status = "degraded"

          const avgLatency =
            data.latencies.length > 0
              ? Math.round(data.latencies.reduce((a, b) => a + b, 0) / data.latencies.length)
              : null

          days.push({ date: dateStr, status, checks, operational_count: data.op, avg_latency: avgLatency })
          totalChecks += checks
          totalOp += data.op
        } else {
          days.push({ date: dateStr, status: "operational" as ServiceStatus, checks: 0, operational_count: 0, avg_latency: null })
        }
      }

      const uptimePercent = totalChecks > 0
        ? parseFloat(((totalOp / totalChecks) * 100).toFixed(2))
        : 100

      services.push({ service_name: serviceName, days, uptime_percent: uptimePercent })
    }

    return NextResponse.json(
      { services, has_data: true },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } },
    )
  } catch (err) {
    console.error("[Status History] Error:", err)
    return NextResponse.json(
      { services: [], has_data: false },
      { headers: { "Cache-Control": "no-store" } },
    )
  }
}
