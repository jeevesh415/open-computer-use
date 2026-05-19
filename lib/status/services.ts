/**
 * Service definitions — the single source of truth for which services are
 * monitored and how each one is health-checked.
 *
 * Every consumer (API route, cron job, background checker) imports this list
 * instead of copy-pasting check logic.
 */

import type { ServiceDefinition } from "./types"

export const SERVICE_DEFINITIONS: ServiceDefinition[] = [
  {
    name: "Website",
    degradedThresholdMs: 3000,
    timeoutMs: 5000,
    check: async () => {
      // Self-check: if this code is executing, the frontend process is alive.
      // This can never report "outage" from within itself, but it anchors the
      // service list so the UI always shows the same six rows and the latency
      // value still captures internal overhead.
    },
  },

  {
    name: "AI Backend",
    degradedThresholdMs: 2000,
    timeoutMs: 5000,
    check: async ({ backendUrl }) => {
      const res = await fetch(`${backendUrl}/api/health`, {
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.status !== "healthy") throw new Error("Unhealthy")
    },
  },

  {
    name: "Database",
    degradedThresholdMs: 2000,
    timeoutMs: 5000,
    check: async ({ supabaseUrl, supabaseAnonKey }) => {
      if (!supabaseUrl) throw new Error("Supabase URL not configured")
      const res = await fetch(`${supabaseUrl}/rest/v1/`, {
        headers: { apikey: supabaseAnonKey },
        signal: AbortSignal.timeout(5000),
      })
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`)
    },
  },

  {
    name: "Authentication",
    degradedThresholdMs: 2000,
    timeoutMs: 5000,
    check: async ({ supabaseUrl, supabaseAnonKey }) => {
      if (!supabaseUrl) throw new Error("Supabase URL not configured")
      const res = await fetch(`${supabaseUrl}/auth/v1/health`, {
        headers: { apikey: supabaseAnonKey },
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    },
  },

  {
    name: "AI Models",
    degradedThresholdMs: 5000,
    timeoutMs: 10000,
    check: async ({ backendUrl }) => {
      const res = await fetch(`${backendUrl}/api/ready`, {
        signal: AbortSignal.timeout(10000),
      })
      const data = await res.json()
      if (data.models === "error") throw new Error("Model provider unreachable")
      if (data.status !== "ready" && data.models !== "available")
        throw new Error(data.status || "Not ready")
    },
  },

  {
    name: "File Storage",
    degradedThresholdMs: 2000,
    timeoutMs: 5000,
    check: async ({ supabaseUrl, supabaseAnonKey }) => {
      if (!supabaseUrl) throw new Error("Supabase URL not configured")
      const res = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
        signal: AbortSignal.timeout(5000),
      })
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`)
    },
  },
]

/** Ordered list of service names (used for deterministic UI rendering) */
export const SERVICE_NAMES = SERVICE_DEFINITIONS.map((s) => s.name)
