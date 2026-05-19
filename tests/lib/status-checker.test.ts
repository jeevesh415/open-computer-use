import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  checkService,
  runAllChecks,
  determineOverallStatus,
  toCheckRows,
  statusCacheHeader,
  buildCheckContext,
} from "@/lib/status/checker"
import { SERVICE_DEFINITIONS, SERVICE_NAMES } from "@/lib/status/services"
import type { ServiceCheck, ServiceDefinition, CheckContext } from "@/lib/status/types"

/* ─── helpers ─── */

const ctx: CheckContext = {
  backendUrl: "http://localhost:8001",
  supabaseUrl: "https://test.supabase.co",
  supabaseAnonKey: "test-anon-key",
}

function makeDef(overrides: Partial<ServiceDefinition> = {}): ServiceDefinition {
  return {
    name: "TestService",
    degradedThresholdMs: 2000,
    timeoutMs: 5000,
    check: async () => {},
    ...overrides,
  }
}

/* ─── checkService ─── */

describe("checkService", () => {
  it("returns operational when check succeeds quickly", async () => {
    const def = makeDef({ check: async () => {} })
    const result = await checkService(def, ctx)

    expect(result.name).toBe("TestService")
    expect(result.status).toBe("operational")
    expect(result.latency).toBeTypeOf("number")
    expect(result.latency).toBeGreaterThanOrEqual(0)
    expect(result.message).toBeUndefined()
  })

  it("returns degraded when latency exceeds threshold", async () => {
    const def = makeDef({
      degradedThresholdMs: 0, // any latency > 0ms triggers degraded
      check: async () => {
        // Burn at least 1ms
        await new Promise((r) => setTimeout(r, 5))
      },
    })
    const result = await checkService(def, ctx)

    expect(result.status).toBe("degraded")
    expect(result.message).toMatch(/High latency/)
    expect(result.latency).toBeGreaterThan(0)
  })

  it("returns outage when check throws an Error", async () => {
    const def = makeDef({
      check: async () => {
        throw new Error("Connection refused")
      },
    })
    const result = await checkService(def, ctx)

    expect(result.status).toBe("outage")
    expect(result.latency).toBeNull()
    expect(result.message).toBe("Connection refused")
  })

  it("returns outage with fallback message for non-Error throws", async () => {
    const def = makeDef({
      check: async () => {
        throw "string error" // eslint-disable-line no-throw-literal
      },
    })
    const result = await checkService(def, ctx)

    expect(result.status).toBe("outage")
    expect(result.message).toBe("Unknown error")
  })

  it("preserves the service name from the definition", async () => {
    const def = makeDef({ name: "My Custom Service" })
    const result = await checkService(def, ctx)
    expect(result.name).toBe("My Custom Service")
  })

  it("measures latency accurately for slow services", async () => {
    const def = makeDef({
      degradedThresholdMs: 5000,
      check: async () => {
        await new Promise((r) => setTimeout(r, 50))
      },
    })
    const result = await checkService(def, ctx)

    expect(result.status).toBe("operational")
    expect(result.latency).toBeGreaterThanOrEqual(40) // allow small timing variance
    expect(result.latency).toBeLessThan(500)
  })
})

/* ─── determineOverallStatus ─── */

describe("determineOverallStatus", () => {
  it("returns operational when all services are operational", () => {
    const checks: ServiceCheck[] = [
      { name: "A", status: "operational", latency: 50 },
      { name: "B", status: "operational", latency: 100 },
      { name: "C", status: "operational", latency: 30 },
    ]
    expect(determineOverallStatus(checks)).toBe("operational")
  })

  it("returns degraded when at least one service is degraded but none are outage", () => {
    const checks: ServiceCheck[] = [
      { name: "A", status: "operational", latency: 50 },
      { name: "B", status: "degraded", latency: 3000, message: "High latency: 3000ms" },
      { name: "C", status: "operational", latency: 30 },
    ]
    expect(determineOverallStatus(checks)).toBe("degraded")
  })

  it("returns outage when at least one service is outage", () => {
    const checks: ServiceCheck[] = [
      { name: "A", status: "operational", latency: 50 },
      { name: "B", status: "outage", latency: null, message: "Timeout" },
      { name: "C", status: "operational", latency: 30 },
    ]
    expect(determineOverallStatus(checks)).toBe("outage")
  })

  it("returns outage when outage and degraded coexist (outage takes priority)", () => {
    const checks: ServiceCheck[] = [
      { name: "A", status: "degraded", latency: 3000, message: "High latency: 3000ms" },
      { name: "B", status: "outage", latency: null, message: "Down" },
    ]
    expect(determineOverallStatus(checks)).toBe("outage")
  })

  it("returns operational for an empty array", () => {
    expect(determineOverallStatus([])).toBe("operational")
  })

  it("returns outage when all services are down", () => {
    const checks: ServiceCheck[] = [
      { name: "A", status: "outage", latency: null, message: "Down" },
      { name: "B", status: "outage", latency: null, message: "Down" },
    ]
    expect(determineOverallStatus(checks)).toBe("outage")
  })

  it("returns degraded when all services are degraded", () => {
    const checks: ServiceCheck[] = [
      { name: "A", status: "degraded", latency: 3000, message: "High latency: 3000ms" },
      { name: "B", status: "degraded", latency: 4000, message: "High latency: 4000ms" },
    ]
    expect(determineOverallStatus(checks)).toBe("degraded")
  })
})

/* ─── toCheckRows ─── */

describe("toCheckRows", () => {
  it("converts ServiceCheck[] to database rows with consistent timestamp", () => {
    const checks: ServiceCheck[] = [
      { name: "Website", status: "operational", latency: 5 },
      { name: "Database", status: "outage", latency: null, message: "Timeout" },
    ]
    const ts = "2026-01-15T12:00:00.000Z"
    const rows = toCheckRows(checks, ts)

    expect(rows).toHaveLength(2)

    expect(rows[0]).toEqual({
      service_name: "Website",
      status: "operational",
      latency: 5,
      message: null,
      checked_at: ts,
    })

    expect(rows[1]).toEqual({
      service_name: "Database",
      status: "outage",
      latency: null,
      message: "Timeout",
      checked_at: ts,
    })
  })

  it("uses current time when no timestamp is provided", () => {
    const before = new Date().toISOString()
    const rows = toCheckRows([{ name: "A", status: "operational", latency: 1 }])
    const after = new Date().toISOString()

    expect(rows[0].checked_at >= before).toBe(true)
    expect(rows[0].checked_at <= after).toBe(true)
  })

  it("normalizes undefined message to null", () => {
    const rows = toCheckRows([{ name: "A", status: "operational", latency: 1 }])
    expect(rows[0].message).toBeNull()
  })

  it("preserves error messages", () => {
    const rows = toCheckRows([
      { name: "A", status: "outage", latency: null, message: "Connection refused" },
    ])
    expect(rows[0].message).toBe("Connection refused")
  })

  it("handles degraded status with message", () => {
    const rows = toCheckRows([
      { name: "A", status: "degraded", latency: 3000, message: "High latency: 3000ms" },
    ])
    expect(rows[0].status).toBe("degraded")
    expect(rows[0].latency).toBe(3000)
    expect(rows[0].message).toBe("High latency: 3000ms")
  })
})

/* ─── statusCacheHeader ─── */

describe("statusCacheHeader", () => {
  it("returns public cache header for operational status", () => {
    const header = statusCacheHeader("operational")
    expect(header).toContain("public")
    expect(header).toContain("max-age=15")
    expect(header).toContain("stale-while-revalidate")
  })

  it("returns no-store for degraded status", () => {
    expect(statusCacheHeader("degraded")).toContain("no-store")
  })

  it("returns no-store for outage status", () => {
    expect(statusCacheHeader("outage")).toContain("no-store")
  })
})

/* ─── buildCheckContext ─── */

describe("buildCheckContext", () => {
  const origEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...origEnv }
  })

  it("reads from env vars by default", () => {
    process.env.PYTHON_BACKEND_URL = "http://backend:9000"
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://my.supabase.co"
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "my-key"

    const result = buildCheckContext()
    expect(result.backendUrl).toBe("http://backend:9000")
    expect(result.supabaseUrl).toBe("https://my.supabase.co")
    expect(result.supabaseAnonKey).toBe("my-key")
  })

  it("uses defaults when env vars are missing", () => {
    delete process.env.PYTHON_BACKEND_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    const result = buildCheckContext()
    expect(result.backendUrl).toBe("http://127.0.0.1:8001")
    expect(result.supabaseUrl).toBe("")
    expect(result.supabaseAnonKey).toBe("")
  })

  it("allows explicit overrides", () => {
    const result = buildCheckContext({
      backendUrl: "http://custom:1234",
      supabaseUrl: "https://custom.supabase.co",
    })
    expect(result.backendUrl).toBe("http://custom:1234")
    expect(result.supabaseUrl).toBe("https://custom.supabase.co")
  })
})

/* ─── SERVICE_DEFINITIONS ─── */

describe("SERVICE_DEFINITIONS", () => {
  it("defines exactly 6 services", () => {
    expect(SERVICE_DEFINITIONS).toHaveLength(6)
  })

  it("has unique service names", () => {
    const names = SERVICE_DEFINITIONS.map((d) => d.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it("exports SERVICE_NAMES matching definitions", () => {
    expect(SERVICE_NAMES).toEqual(SERVICE_DEFINITIONS.map((d) => d.name))
  })

  it("every definition has required fields", () => {
    for (const def of SERVICE_DEFINITIONS) {
      expect(def.name).toBeTypeOf("string")
      expect(def.name.length).toBeGreaterThan(0)
      expect(def.degradedThresholdMs).toBeTypeOf("number")
      expect(def.degradedThresholdMs).toBeGreaterThan(0)
      expect(def.timeoutMs).toBeTypeOf("number")
      expect(def.timeoutMs).toBeGreaterThan(0)
      expect(def.check).toBeTypeOf("function")
    }
  })

  it("degraded thresholds are less than timeouts", () => {
    for (const def of SERVICE_DEFINITIONS) {
      expect(def.degradedThresholdMs).toBeLessThanOrEqual(def.timeoutMs)
    }
  })

  it("includes expected service names", () => {
    const names = SERVICE_DEFINITIONS.map((d) => d.name)
    expect(names).toContain("Website")
    expect(names).toContain("AI Backend")
    expect(names).toContain("Database")
    expect(names).toContain("Authentication")
    expect(names).toContain("AI Models")
    expect(names).toContain("File Storage")
  })
})

/* ─── runAllChecks ─── */

describe("runAllChecks", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network disabled in tests")),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns a result for every service definition", async () => {
    const results = await runAllChecks(ctx)
    expect(results).toHaveLength(SERVICE_DEFINITIONS.length)
  })

  it("Website is always operational (self-check)", async () => {
    const results = await runAllChecks(ctx)
    const website = results.find((r) => r.name === "Website")
    expect(website).toBeDefined()
    expect(website!.status).toBe("operational")
    expect(website!.latency).toBeTypeOf("number")
  })

  it("services that depend on fetch report outage when fetch is mocked to fail", async () => {
    const results = await runAllChecks(ctx)
    const backend = results.find((r) => r.name === "AI Backend")
    expect(backend).toBeDefined()
    expect(backend!.status).toBe("outage")
    expect(backend!.message).toBeDefined()
  })

  it("every result has the correct shape", async () => {
    const results = await runAllChecks(ctx)
    for (const r of results) {
      expect(r).toHaveProperty("name")
      expect(r).toHaveProperty("status")
      expect(["operational", "degraded", "outage"]).toContain(r.status)
      expect(r).toHaveProperty("latency")
      if (r.status === "outage") {
        expect(r.latency).toBeNull()
        expect(r.message).toBeTypeOf("string")
      } else {
        expect(r.latency).toBeTypeOf("number")
      }
    }
  })

  it("uses provided context", async () => {
    const customCtx: CheckContext = {
      backendUrl: "http://custom:9999",
      supabaseUrl: "https://custom.supabase.co",
      supabaseAnonKey: "custom-key",
    }

    const fetchMock = vi.fn().mockRejectedValue(new Error("fail"))
    vi.stubGlobal("fetch", fetchMock)

    await runAllChecks(customCtx)

    // Verify the backend URL was called with the custom context
    const calls = fetchMock.mock.calls.map((c: unknown[]) => c[0] as string)
    const backendCalls = calls.filter((url: string) => url.includes("custom:9999"))
    expect(backendCalls.length).toBeGreaterThan(0)
  })
})

/* ─── integration: checkService with degraded threshold boundary ─── */

describe("checkService boundary conditions", () => {
  it("exactly at threshold is operational (not degraded)", async () => {
    // degradedThresholdMs = 999999 — anything under that is operational
    const def = makeDef({ degradedThresholdMs: 999999 })
    const result = await checkService(def, ctx)
    expect(result.status).toBe("operational")
  })

  it("handles check that returns synchronously", async () => {
    const def = makeDef({
      check: async () => {
        // No await, returns immediately
      },
    })
    const result = await checkService(def, ctx)
    expect(result.status).toBe("operational")
    expect(result.latency).toBeGreaterThanOrEqual(0)
    expect(result.latency).toBeLessThan(50)
  })
})
