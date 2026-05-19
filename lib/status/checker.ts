/**
 * Core health-check execution logic.
 *
 * This is the **only** place that runs service checks. All consumers
 * (API routes, cron, background checker) call `runAllChecks()`.
 */

import type {
  CheckContext,
  ServiceCheck,
  ServiceCheckRow,
  ServiceDefinition,
  ServiceStatus,
} from "./types"
import { SERVICE_DEFINITIONS } from "./services"

/**
 * Build a `CheckContext` from environment variables with explicit fallbacks.
 */
export function buildCheckContext(overrides?: Partial<CheckContext>): CheckContext {
  return {
    backendUrl: overrides?.backendUrl ?? process.env.PYTHON_BACKEND_URL ?? "http://127.0.0.1:8001",
    supabaseUrl: overrides?.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    supabaseAnonKey: overrides?.supabaseAnonKey ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  }
}

/**
 * Execute a single service's health check and return a `ServiceCheck`.
 *
 * - If the check succeeds but latency exceeds the degraded threshold → `"degraded"`
 * - If the check throws → `"outage"`
 * - Otherwise → `"operational"`
 */
export async function checkService(
  definition: ServiceDefinition,
  ctx: CheckContext,
): Promise<ServiceCheck> {
  const start = Date.now()
  try {
    await definition.check(ctx)
    const latency = Date.now() - start
    const status: ServiceStatus =
      latency > definition.degradedThresholdMs ? "degraded" : "operational"
    return {
      name: definition.name,
      status,
      latency,
      ...(status === "degraded" ? { message: `High latency: ${latency}ms` } : {}),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return { name: definition.name, status: "outage", latency: null, message }
  }
}

/**
 * Run health checks for all registered services in parallel.
 */
export async function runAllChecks(ctx?: CheckContext): Promise<ServiceCheck[]> {
  const resolvedCtx = ctx ?? buildCheckContext()
  return Promise.all(SERVICE_DEFINITIONS.map((def) => checkService(def, resolvedCtx)))
}

/**
 * Derive the overall system status from individual service check results.
 *
 * - All operational → `"operational"`
 * - At least one outage → `"outage"`
 * - At least one degraded (but no outages) → `"degraded"`
 */
export function determineOverallStatus(checks: ServiceCheck[]): ServiceStatus {
  const hasOutage = checks.some((c) => c.status === "outage")
  if (hasOutage) return "outage"

  const hasDegraded = checks.some((c) => c.status === "degraded")
  if (hasDegraded) return "degraded"

  return "operational"
}

/**
 * Convert `ServiceCheck[]` to rows for the `status_checks` table.
 */
export function toCheckRows(checks: ServiceCheck[], checkedAt?: string): ServiceCheckRow[] {
  const ts = checkedAt ?? new Date().toISOString()
  return checks.map((c) => ({
    service_name: c.name,
    status: c.status,
    latency: c.latency,
    message: c.message ?? null,
    checked_at: ts,
  }))
}

/**
 * Build the cache header based on the overall status.
 * Operational → short public cache. Any issue → no cache.
 */
export function statusCacheHeader(overall: ServiceStatus): string {
  return overall === "operational"
    ? "public, max-age=15, s-maxage=15, stale-while-revalidate=10"
    : "no-store, no-cache, must-revalidate"
}
