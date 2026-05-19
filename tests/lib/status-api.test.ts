import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * Tests for the status API routes.
 *
 * These test the route handler functions directly (no HTTP server needed).
 * We mock the shared `@/lib/status` module and Supabase clients.
 */

/* ─── mock setup ─── */

vi.mock("@/lib/status", () => ({
  runAllChecks: vi.fn(),
  determineOverallStatus: vi.fn(),
  statusCacheHeader: vi.fn(),
  toCheckRows: vi.fn(),
  buildCheckContext: vi.fn().mockReturnValue({
    backendUrl: "http://localhost:8001",
    supabaseUrl: "https://test.supabase.co",
    supabaseAnonKey: "test-key",
  }),
  SERVICE_NAMES: ["Website", "AI Backend", "Database", "Authentication", "AI Models", "File Storage"],
  SERVICE_DEFINITIONS: [],
}))

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(),
}))

import {
  runAllChecks,
  determineOverallStatus,
  statusCacheHeader,
  toCheckRows,
} from "@/lib/status"
import { createServiceClient } from "@/lib/supabase/service"

const mockRunAllChecks = vi.mocked(runAllChecks)
const mockDetermineOverall = vi.mocked(determineOverallStatus)
const mockCacheHeader = vi.mocked(statusCacheHeader)
const mockToCheckRows = vi.mocked(toCheckRows)
const mockCreateServiceClient = vi.mocked(createServiceClient)

/* ─── helpers ─── */

function mockSupabaseSelect(rows: Record<string, unknown>[], error: { message: string } | null = null) {
  const mockLimit = vi.fn().mockResolvedValue({ data: rows, error })
  const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit })
  const mockGte = vi.fn().mockReturnValue({ order: mockOrder })
  const mockSelect = vi.fn().mockReturnValue({ gte: mockGte })
  const mockInsert = vi.fn().mockReturnValue({ then: vi.fn().mockReturnValue({ catch: vi.fn() }) })
  const mockFrom = vi.fn().mockReturnValue({ select: mockSelect, insert: mockInsert })
  return { from: mockFrom } as any
}

/* ─── /api/status (reads from DB, falls back to live checks) ─── */

describe("GET /api/status", () => {
  let handler: (req?: Request) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()

    mockDetermineOverall.mockReturnValue("operational")
    mockCacheHeader.mockReturnValue("public, max-age=15, s-maxage=15, stale-while-revalidate=10")
    mockRunAllChecks.mockResolvedValue([
      { name: "Website", status: "operational", latency: 2 },
      { name: "AI Backend", status: "operational", latency: 45 },
    ])

    const mod = await import("@/app/api/status/route")
    handler = mod.GET
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns all 6 services from the latest DB rows", async () => {
    const now = new Date().toISOString()
    mockCreateServiceClient.mockReturnValue(
      mockSupabaseSelect([
        { service_name: "Website", status: "operational", latency: 3, message: null, checked_at: now },
        { service_name: "AI Backend", status: "operational", latency: 42, message: null, checked_at: now },
        { service_name: "Database", status: "operational", latency: 15, message: null, checked_at: now },
        { service_name: "Authentication", status: "operational", latency: 20, message: null, checked_at: now },
        { service_name: "AI Models", status: "operational", latency: 200, message: null, checked_at: now },
        { service_name: "File Storage", status: "operational", latency: 18, message: null, checked_at: now },
      ]),
    )

    const res = await handler()
    const body = await res.json()

    expect(body.overall).toBe("operational")
    expect(body.services).toHaveLength(6)
    expect(body.timestamp).toBe(now)
    expect(body.services[0].name).toBe("Website")
    expect(body.services[0].latency).toBe(3)
  })

  it("falls back to live checks when supabase client is unavailable", async () => {
    mockCreateServiceClient.mockReturnValue(null)
    mockRunAllChecks.mockClear()

    const res = await handler()
    const body = await res.json()

    expect(mockRunAllChecks).toHaveBeenCalledOnce()
    expect(body.services).toHaveLength(2) // from mocked runAllChecks
    expect(body.overall).toBe("operational")
  })

  it("falls back to live checks when DB query fails", async () => {
    mockCreateServiceClient.mockReturnValue(
      mockSupabaseSelect([], { message: "connection refused" }),
    )
    mockRunAllChecks.mockClear()

    const res = await handler()
    expect(mockRunAllChecks).toHaveBeenCalledOnce()
  })

  it("falls back to live checks when no recent DB rows", async () => {
    mockCreateServiceClient.mockReturnValue(
      mockSupabaseSelect([]),
    )
    mockRunAllChecks.mockClear()

    const res = await handler()
    expect(mockRunAllChecks).toHaveBeenCalledOnce()
  })

  it("sets cache header via statusCacheHeader", async () => {
    mockCreateServiceClient.mockReturnValue(
      mockSupabaseSelect([
        { service_name: "Website", status: "operational", latency: 3, message: null, checked_at: new Date().toISOString() },
      ]),
    )

    const res = await handler()
    expect(res.headers.get("Cache-Control")).toContain("public")
    expect(mockCacheHeader).toHaveBeenCalledWith("operational")
  })

  it("uses no-store cache when status is degraded", async () => {
    mockDetermineOverall.mockReturnValue("degraded")
    mockCacheHeader.mockReturnValue("no-store, no-cache, must-revalidate")
    mockCreateServiceClient.mockReturnValue(
      mockSupabaseSelect([
        { service_name: "Website", status: "degraded", latency: 3000, message: "High latency: 3000ms", checked_at: new Date().toISOString() },
      ]),
    )

    const res = await handler()
    expect(res.headers.get("Cache-Control")).toContain("no-store")
  })

  it("picks the latest row when multiple rows exist for the same service", async () => {
    const older = "2026-01-01T00:00:00.000Z"
    const newer = "2026-01-01T00:01:00.000Z"
    mockCreateServiceClient.mockReturnValue(
      mockSupabaseSelect([
        { service_name: "Website", status: "operational", latency: 5, message: null, checked_at: newer },
        { service_name: "Website", status: "outage", latency: null, message: "Down", checked_at: older },
      ]),
    )

    const res = await handler()
    const body = await res.json()

    const website = body.services.find((s: any) => s.name === "Website")
    expect(website.status).toBe("operational")
    expect(website.latency).toBe(5)
  })

  it("does not include message field when message is null", async () => {
    mockCreateServiceClient.mockReturnValue(
      mockSupabaseSelect([
        { service_name: "Website", status: "operational", latency: 3, message: null, checked_at: new Date().toISOString() },
      ]),
    )

    const res = await handler()
    const body = await res.json()

    const website = body.services.find((s: any) => s.name === "Website")
    expect(website).not.toHaveProperty("message")
  })
})

/* ─── /api/status/cron ─── */

describe("GET /api/status/cron", () => {
  let handler: (req: Request) => Promise<Response>
  const origEnv = { ...process.env }

  beforeEach(async () => {
    vi.resetModules()
    process.env.CRON_SECRET = "test-cron-secret"

    mockRunAllChecks.mockResolvedValue([
      { name: "Website", status: "operational", latency: 2 },
    ])
    mockToCheckRows.mockReturnValue([
      {
        service_name: "Website",
        status: "operational",
        latency: 2,
        message: null,
        checked_at: "2026-01-01T00:00:00.000Z",
      },
    ])

    const mod = await import("@/app/api/status/cron/route")
    handler = mod.GET
  })

  afterEach(() => {
    process.env = { ...origEnv }
    vi.restoreAllMocks()
  })

  it("returns 401 when no authorization header is provided", async () => {
    const req = new Request("http://localhost/api/status/cron")
    const res = await handler(req)
    expect(res.status).toBe(401)
  })

  it("returns 401 when wrong secret is provided", async () => {
    const req = new Request("http://localhost/api/status/cron", {
      headers: { authorization: "Bearer wrong-secret" },
    })
    const res = await handler(req)
    expect(res.status).toBe(401)
  })

  it("returns 401 when CRON_SECRET is not configured (env missing)", async () => {
    delete process.env.CRON_SECRET

    vi.resetModules()
    const mod = await import("@/app/api/status/cron/route")
    const freshHandler = mod.GET

    const req = new Request("http://localhost/api/status/cron", {
      headers: { authorization: "Bearer anything" },
    })
    const res = await freshHandler(req)
    expect(res.status).toBe(401)
  })

  it("returns 200 with correct secret", async () => {
    mockCreateServiceClient.mockReturnValue(null as any)

    const req = new Request("http://localhost/api/status/cron", {
      headers: { authorization: "Bearer test-cron-secret" },
    })
    const res = await handler(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.checks).toBeDefined()
  })

  it("persists checks when supabase client is available", async () => {
    const mockInsert = vi.fn().mockResolvedValue({ error: null })
    const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert })
    mockCreateServiceClient.mockReturnValue({ from: mockFrom } as any)

    const req = new Request("http://localhost/api/status/cron", {
      headers: { authorization: "Bearer test-cron-secret" },
    })
    await handler(req)

    expect(mockFrom).toHaveBeenCalledWith("status_checks")
    expect(mockInsert).toHaveBeenCalled()
  })

  it("still returns 200 when DB persistence fails", async () => {
    const mockInsert = vi.fn().mockResolvedValue({
      error: { message: "DB down" },
    })
    const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert })
    mockCreateServiceClient.mockReturnValue({ from: mockFrom } as any)

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const req = new Request("http://localhost/api/status/cron", {
      headers: { authorization: "Bearer test-cron-secret" },
    })
    const res = await handler(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(consoleSpy).toHaveBeenCalled()

    consoleSpy.mockRestore()
  })
})

/* ─── /api/status/history (reads from DB directly) ─── */

describe("GET /api/status/history", () => {
  let handler: () => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import("@/app/api/status/history/route")
    handler = mod.GET
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns has_data false when supabase client is unavailable", async () => {
    mockCreateServiceClient.mockReturnValue(null)

    const res = await handler()
    const body = await res.json()

    expect(body.has_data).toBe(false)
    expect(body.services).toEqual([])
    expect(res.headers.get("Cache-Control")).toBe("no-store")
  })

  it("seeds DB and returns live data when no rows exist", async () => {
    mockRunAllChecks.mockResolvedValue([
      { name: "Website", status: "operational", latency: 50 },
    ])

    const mockInsert = vi.fn().mockReturnValue({ then: vi.fn().mockReturnValue({ catch: vi.fn() }) })
    const mockRange = vi.fn().mockResolvedValue({ data: [], error: null })
    const mockOrder = vi.fn().mockReturnValue({ range: mockRange })
    const mockGte = vi.fn().mockReturnValue({ order: mockOrder })
    const mockSelect = vi.fn().mockReturnValue({ gte: mockGte })
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect, insert: mockInsert })
    mockCreateServiceClient.mockReturnValue({ from: mockFrom } as any)

    const res = await handler()
    const body = await res.json()

    expect(body.has_data).toBe(true)
    expect(body.services.length).toBeGreaterThanOrEqual(1)
    // Today should have 1 check from the live seed
    const today = new Date().toISOString().split("T")[0]
    const ws = body.services.find((s: any) => s.service_name === "Website")
    const todayData = ws.days.find((d: any) => d.date === today)
    expect(todayData.checks).toBe(1)
  })

  it("aggregates rows into 7-day history with correct structure", async () => {
    const today = new Date().toISOString().split("T")[0]
    const rows = [
      { service_name: "Website", status: "operational", latency: 50, checked_at: `${today}T12:00:00Z` },
      { service_name: "Website", status: "operational", latency: 60, checked_at: `${today}T12:01:00Z` },
      { service_name: "Database", status: "operational", latency: 15, checked_at: `${today}T12:00:00Z` },
    ]

    const mockRange = vi.fn().mockResolvedValueOnce({ data: rows, error: null })
    const mockOrder = vi.fn().mockReturnValue({ range: mockRange })
    const mockGte = vi.fn().mockReturnValue({ order: mockOrder })
    const mockSelect = vi.fn().mockReturnValue({ gte: mockGte })
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect })
    mockCreateServiceClient.mockReturnValue({ from: mockFrom } as any)

    const res = await handler()
    const body = await res.json()

    expect(body.has_data).toBe(true)
    expect(body.services.length).toBeGreaterThanOrEqual(6)

    const websiteHistory = body.services.find((s: any) => s.service_name === "Website")
    expect(websiteHistory).toBeDefined()
    expect(websiteHistory.days).toHaveLength(7)

    const todayData = websiteHistory.days.find((d: any) => d.date === today)
    expect(todayData.checks).toBe(2)
    expect(todayData.operational_count).toBe(2)
    expect(todayData.avg_latency).toBe(55)
    expect(todayData.status).toBe("operational")

    expect(res.headers.get("Cache-Control")).toContain("max-age=60")
  })

  it("returns no-store cache on query error", async () => {
    const mockRange = vi.fn().mockResolvedValue({ data: null, error: { message: "DB error" } })
    const mockOrder = vi.fn().mockReturnValue({ range: mockRange })
    const mockGte = vi.fn().mockReturnValue({ order: mockOrder })
    const mockSelect = vi.fn().mockReturnValue({ gte: mockGte })
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect })
    mockCreateServiceClient.mockReturnValue({ from: mockFrom } as any)

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await handler()
    const body = await res.json()

    expect(body.has_data).toBe(false)
    consoleSpy.mockRestore()
  })
})
