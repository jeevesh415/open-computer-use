/**
 * dev-prod-parity.test.ts — frontend counterpart to
 * backend/tests/test_dev_prod_parity.py.
 *
 * The bug class is "dev passes, prod fails" caused by code branches like:
 *
 *     if (process.env.NODE_ENV === "development") {
 *       return await skipTheStrictThing()
 *     }
 *
 * The schedule-DELETE backend bug ran on the same shape — `if settings.DEBUG`
 * on the Python side. This file enumerates every analogous frontend branch
 * and pins the strict (production) behavior so a regression cannot ship.
 *
 * Audit method
 * ============
 * Run a content search across the repo for the regex
 * `NODE_ENV|isDev|isLocal|isProd` over `.ts` and `.tsx` files (excluding
 * test/build dirs).
 *
 * Then we sort each hit into one of:
 *
 *   * Safe — dev affordance only (e.g. extra console.log, dev-only debug
 *     route that 403s in prod, perf-monitor that skips in prod).
 *   * Risk — could mask a prod-only failure path. Listed in
 *     KNOWN_DEV_BYPASSES below with a justification + a dedicated test.
 *   * Bug — actively wrong; fixed in the same PR as this test.
 *
 * As of writing, every hit is Safe — see the audit comments below for the
 * one-line justification on each.
 *
 * Where these tests overlap with `middleware-security.test.ts` (HSTS, CSP)
 * the assertions are intentionally duplicated here. That suite uses a
 * `try/finally` that mutates `process.env.NODE_ENV` — the duplication keeps
 * the parity story self-contained: if HSTS-in-prod regresses, this single
 * file fails and the cause is obvious.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

// ---------------------------------------------------------------------------
// Allowlist: every frontend dev-mode bypass we have classified.
//
// Adding a new entry requires editing this file — that's the point. Code
// review on this allowlist is the gate that prevents the bug class from
// silently growing.
// ---------------------------------------------------------------------------
type DevBypass = {
  where: string // file:line
  what: string
  why_safe: string
}

export const KNOWN_DEV_BYPASSES_FRONTEND: Record<string, DevBypass> = {
  middleware_csp_dev_relaxes_script_src: {
    where: "middleware.ts:107-117",
    what: "isDev → CSP omits vercel.live, umami.is, etc.",
    why_safe:
      "Dev CSP is STRICTER, not laxer (it has fewer allowed origins). " +
      "The prod path adds analytics origins that the prod app actually " +
      "uses. There is no scenario where dev permits something prod blocks. " +
      "Pinned by `prod CSP contains vercel.live, dev does not`.",
  },
  middleware_hsts_dev_omitted: {
    where: "middleware.ts:124-126",
    what: "if (!isDev) set Strict-Transport-Security",
    why_safe:
      "HSTS only matters over HTTPS — dev runs over http://localhost where " +
      "HSTS would lock the developer's browser into HTTPS for a domain that " +
      "can't serve it. The prod path always sets HSTS; pinned by the test " +
      "below.",
  },
  api_debug_machine_cleanup_dev_only_route: {
    where: "app/api/debug/machine-cleanup/route.ts:21",
    what: "if (NODE_ENV !== 'development') return 403",
    why_safe:
      "Inverse of the bug class — the route IS the strict path in prod " +
      "(it returns 403). Adding a route that 403s in prod cannot mask a " +
      "prod failure. Pinned by the test below.",
  },
  ollama_disabled_in_production: {
    where: "lib/models/data/ollama.ts:39-44",
    what: "shouldEnableOllama: NODE_ENV !== 'production'",
    why_safe:
      "Local Ollama models are never reachable from a prod container — " +
      "skipping detection in prod prevents 60s of timeout per cold start. " +
      "Models are an additive feature; no auth or state-changing path " +
      "depends on Ollama being detected.",
  },
  performance_monitor_dev_only: {
    where: "app/hooks/use-performance-monitor.ts:10",
    what: "if (NODE_ENV !== 'development') return",
    why_safe:
      "Pure observability tool that emits dev-time perf marks. No auth, " +
      "data, or state-changing logic depends on it.",
  },
  layout_analytics_skipped_in_dev: {
    where: "app/layout.tsx:209",
    what: "{!isDev ? <Script>analytics</Script> : ...}",
    why_safe:
      "Analytics scripts only load in prod. No auth or data path depends " +
      "on them; skipping in dev avoids polluting prod analytics with " +
      "dev events.",
  },
  auto_secrets_oss_only_dev_persistence: {
    where: "lib/auto-secrets.ts:151",
    what: "if (NODE_ENV === 'production' && VERCEL) refuse to write .env.local",
    why_safe:
      "The whole module only runs when isOssMode() is true, AND this " +
      "secondary guard refuses the actual .env.local write in managed prod. " +
      "Belt-and-suspenders — pinned by tests/lib/auto-secrets.test.ts.",
  },
  api_baseurl_dev_uses_localhost: {
    where: "lib/api.ts:75,120,159,181",
    what: "isDev ? 'http://localhost:3000' : derived URL",
    why_safe:
      "These are auth-redirect URLs. Dev uses localhost because the dev " +
      "server runs there; prod uses the live origin. The redirect target " +
      "is for a code that was sent to the user's email — not a security " +
      "boundary that varies between envs.",
  },
  permissions_dev_only_logging: {
    where: "electron/src/main/permissions.ts:61",
    what: "if (NODE_ENV === 'development') console.log(...)",
    why_safe:
      "Pure dev-time observability. The prod path returns the same " +
      "PermissionStatus object; the dev branch only adds a log line.",
  },
  supabase_middleware_secure_cookie_only_in_prod: {
    where: "utils/supabase/middleware.ts:136",
    what: "secure: NODE_ENV === 'production'",
    why_safe:
      "Cookies marked Secure are NOT sent over HTTP — required in prod " +
      "(HTTPS only) and impossible in dev (localhost = HTTP). The dev " +
      "path is intentionally LAXER; this can't mask a prod failure since " +
      "the cookie does flow correctly in prod.",
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeRequest(
  url: string,
  init?: { method?: string; headers?: Record<string, string> }
): NextRequest {
  return new NextRequest(url, {
    method: init?.method ?? "GET",
    headers: new Headers(init?.headers),
  })
}

// Mock Supabase + CSRF for the middleware so we don't need real services.
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: null, error: null }) }),
      }),
    }),
  }),
}))
vi.mock("@/lib/supabase/config", () => ({ isSupabaseEnabled: true }))
vi.mock("@/lib/csrf", () => ({ validateCsrfToken: async () => true }))

// ---------------------------------------------------------------------------
// CSRF handling
// ---------------------------------------------------------------------------
describe("middleware: CSRF strict path runs regardless of NODE_ENV", () => {
  // Note the difference vs. backend: the Next.js middleware does NOT have a
  // `if (NODE_ENV === 'development') skip CSRF` branch — CSRF is enforced
  // unconditionally on POST/PUT/PATCH/DELETE. We pin that absence below.
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  for (const env of ["production", "development", "test"] as const) {
    it(`enforces CSRF on state-changing requests when NODE_ENV=${env}`, async () => {
      const original = process.env.NODE_ENV
      try {
        // @ts-expect-error -- NODE_ENV is read-only in @types/node, mutable at runtime
        process.env.NODE_ENV = env
        // For this assertion we want the validateCsrfToken to FAIL so we
        // see the 403. Re-mock for this single test.
        vi.doMock("@/lib/csrf", () => ({
          validateCsrfToken: async () => false,
        }))
        vi.resetModules()
        const { middleware } = await import("../../middleware")

        const req = makeRequest("https://example.com/api/x", {
          method: "POST",
          // No csrf cookie / header — the strict path should reject.
        })
        const res = await middleware(req)
        expect(res.status).toBe(403)
        const body = await res.text()
        expect(body).toBe("Invalid CSRF token")
      } finally {
        // @ts-expect-error
        process.env.NODE_ENV = original
        vi.resetModules()
        vi.doUnmock("@/lib/csrf")
      }
    })
  }
})

// ---------------------------------------------------------------------------
// HSTS
// ---------------------------------------------------------------------------
describe("middleware: HSTS only set in production", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("sets Strict-Transport-Security in prod", async () => {
    const original = process.env.NODE_ENV
    try {
      // @ts-expect-error
      process.env.NODE_ENV = "production"
      vi.resetModules()
      const { middleware } = await import("../../middleware")
      const res = await middleware(makeRequest("https://example.com/"))
      expect(res.headers.get("Strict-Transport-Security")).toMatch(
        /max-age=\d+;\s*includeSubDomains/
      )
    } finally {
      // @ts-expect-error
      process.env.NODE_ENV = original
      vi.resetModules()
    }
  })

  it("omits Strict-Transport-Security in dev (localhost has no HTTPS)", async () => {
    const original = process.env.NODE_ENV
    try {
      // @ts-expect-error
      process.env.NODE_ENV = "development"
      vi.resetModules()
      const { middleware } = await import("../../middleware")
      const res = await middleware(makeRequest("https://example.com/"))
      expect(res.headers.get("Strict-Transport-Security")).toBeNull()
    } finally {
      // @ts-expect-error
      process.env.NODE_ENV = original
      vi.resetModules()
    }
  })
})

// ---------------------------------------------------------------------------
// CSP
// ---------------------------------------------------------------------------
describe("middleware: CSP applied to every response", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  for (const env of ["production", "development", "test"] as const) {
    it(`sets Content-Security-Policy when NODE_ENV=${env}`, async () => {
      const original = process.env.NODE_ENV
      try {
        // @ts-expect-error
        process.env.NODE_ENV = env
        vi.resetModules()
        const { middleware } = await import("../../middleware")
        const res = await middleware(makeRequest("https://example.com/"))
        const csp = res.headers.get("Content-Security-Policy")
        expect(csp).toBeTruthy()
        expect(csp).toContain("default-src 'self'")
      } finally {
        // @ts-expect-error
        process.env.NODE_ENV = original
        vi.resetModules()
      }
    })
  }

  it("dev CSP does NOT include vercel.live (prod-only origin)", async () => {
    const original = process.env.NODE_ENV
    try {
      // @ts-expect-error
      process.env.NODE_ENV = "development"
      vi.resetModules()
      const { middleware } = await import("../../middleware")
      const res = await middleware(makeRequest("https://example.com/"))
      const csp = res.headers.get("Content-Security-Policy") ?? ""
      expect(csp).not.toContain("vercel.live")
    } finally {
      // @ts-expect-error
      process.env.NODE_ENV = original
      vi.resetModules()
    }
  })

  it("prod CSP includes vercel.live and analytics.umami.is", async () => {
    const original = process.env.NODE_ENV
    try {
      // @ts-expect-error
      process.env.NODE_ENV = "production"
      vi.resetModules()
      const { middleware } = await import("../../middleware")
      const res = await middleware(makeRequest("https://example.com/"))
      const csp = res.headers.get("Content-Security-Policy") ?? ""
      expect(csp).toContain("vercel.live")
      expect(csp).toContain("analytics.umami.is")
    } finally {
      // @ts-expect-error
      process.env.NODE_ENV = original
      vi.resetModules()
    }
  })

  it("baseline security headers present regardless of NODE_ENV", async () => {
    const original = process.env.NODE_ENV
    try {
      for (const env of ["production", "development", "test"] as const) {
        // @ts-expect-error
        process.env.NODE_ENV = env
        vi.resetModules()
        const { middleware } = await import("../../middleware")
        const res = await middleware(makeRequest("https://example.com/"))
        expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN")
        expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
        expect(res.headers.get("Referrer-Policy")).toBe(
          "strict-origin-when-cross-origin"
        )
        expect(res.headers.get("Permissions-Policy")).toContain("camera=()")
      }
    } finally {
      // @ts-expect-error
      process.env.NODE_ENV = original
      vi.resetModules()
    }
  })
})

// ---------------------------------------------------------------------------
// Dev-only debug routes are 403 in prod
// ---------------------------------------------------------------------------
describe("dev-only debug routes refuse prod traffic", () => {
  it("/api/debug/machine-cleanup returns 403 when NODE_ENV=production", async () => {
    const original = process.env.NODE_ENV
    try {
      // @ts-expect-error
      process.env.NODE_ENV = "production"

      // Mock Supabase clients so the route reaches the env check.
      vi.doMock("@/lib/supabase/server", () => ({
        createClient: async () => ({
          auth: {
            getUser: async () => ({
              data: { user: { id: "u1", email: "u1@example.com" } },
              error: null,
            }),
          },
        }),
      }))
      vi.doMock("@/lib/supabase/service", () => ({
        createServiceClient: () => null, // not reached because we 403 first
      }))
      vi.resetModules()

      const { GET } = await import("../../app/api/debug/machine-cleanup/route")
      const req = new NextRequest("https://example.com/api/debug/machine-cleanup")
      const res = await GET(req)
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toContain("development")
    } finally {
      // @ts-expect-error
      process.env.NODE_ENV = original
      vi.doUnmock("@/lib/supabase/server")
      vi.doUnmock("@/lib/supabase/service")
      vi.resetModules()
    }
  })
})

// ---------------------------------------------------------------------------
// Allowlist documentation guard
// ---------------------------------------------------------------------------
describe("dev-bypass allowlist documentation", () => {
  it("known dev bypasses count matches expected", () => {
    // If you legitimately add or remove a frontend dev-bypass, edit this
    // EXPECTED constant in the same PR. The change must surface in the
    // diff so code review can audit it.
    const EXPECTED = 10
    const actual = Object.keys(KNOWN_DEV_BYPASSES_FRONTEND).length
    expect(actual).toBe(EXPECTED)
  })

  it("every entry has where/what/why_safe", () => {
    for (const [name, entry] of Object.entries(KNOWN_DEV_BYPASSES_FRONTEND)) {
      expect(entry.where, `${name}: missing where`).toBeTruthy()
      expect(entry.what, `${name}: missing what`).toBeTruthy()
      expect(entry.why_safe, `${name}: missing why_safe`).toBeTruthy()
      expect(entry.where, `${name}: where must be file:line`).toMatch(/:/)
    }
  })
})

// ---------------------------------------------------------------------------
// Helper: lib/utils.ts isDev export reflects current NODE_ENV
// ---------------------------------------------------------------------------
describe("lib/utils.isDev mirrors NODE_ENV at module load time", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("isDev=true when NODE_ENV=development", async () => {
    const original = process.env.NODE_ENV
    try {
      // @ts-expect-error
      process.env.NODE_ENV = "development"
      vi.resetModules()
      const { isDev } = await import("@/lib/utils")
      expect(isDev).toBe(true)
    } finally {
      // @ts-expect-error
      process.env.NODE_ENV = original
      vi.resetModules()
    }
  })

  it("isDev=false when NODE_ENV=production", async () => {
    const original = process.env.NODE_ENV
    try {
      // @ts-expect-error
      process.env.NODE_ENV = "production"
      vi.resetModules()
      const { isDev } = await import("@/lib/utils")
      expect(isDev).toBe(false)
    } finally {
      // @ts-expect-error
      process.env.NODE_ENV = original
      vi.resetModules()
    }
  })
})
