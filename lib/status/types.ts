/**
 * Shared types for the status monitoring system.
 * Single source of truth — used by API routes, background checkers, and the UI.
 */

export type ServiceStatus = "operational" | "degraded" | "outage"

export interface ServiceCheck {
  name: string
  status: ServiceStatus
  latency: number | null
  message?: string
}

/** Row shape for the `status_checks` Supabase table */
export interface ServiceCheckRow {
  service_name: string
  status: ServiceStatus
  latency: number | null
  message: string | null
  checked_at: string
}

export interface StatusResponse {
  overall: ServiceStatus
  timestamp: string
  services: ServiceCheck[]
}

export interface DayStatus {
  date: string
  status: ServiceStatus
  checks: number
  operational_count: number
  avg_latency: number | null
}

export interface ServiceHistory {
  service_name: string
  days: DayStatus[]
  uptime_percent: number
}

export interface HistoryResponse {
  services: ServiceHistory[]
  has_data: boolean
}

export interface ServiceDefinition {
  name: string
  /** Latency (ms) above which the service is considered degraded (not down, just slow) */
  degradedThresholdMs: number
  /** Timeout for the health check request */
  timeoutMs: number
  check: (ctx: CheckContext) => Promise<void>
}

export interface CheckContext {
  backendUrl: string
  supabaseUrl: string
  supabaseAnonKey: string
}
