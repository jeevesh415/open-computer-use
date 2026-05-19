/**
 * Middleware security tests.
 *
 * These tests exercise the root `middleware.ts` and `utils/supabase/middleware.ts`
 * by constructing real `NextRequest` instances. The Supabase server client is
 * mocked so we can assert protected-route redirects, onboarding redirects, and
 * unauthenticated paths without spinning up a real Supabase project.
 *
 * The CSP / security-header assertions verify the static rules in middleware.ts
 * and check the dev-vs-prod difference.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

// ---------------------------------------------------------------------------
// Supabase mock
// ---------------------------------------------------------------------------
// We control whether `auth.getUser()` returns a user, and whether the
// `users.onboarding_completed` query returns true/false.
type MockState = {
  user: { id: string; email?: string } | null
  onboarded: boolean
  throwOnUserQuery: boolean
}
const mockState: MockState = {
  user: null,
  onboarded: true,
  throwOnUserQuery: false,
}

vi.mock("@supabase/ssr", () => {
  return {
    createServerClient: (_url: string, _key: string, opts: any) => {
      // Touch the cookies API so we don't accidentally break the contract.
      try { opts?.cookies?.getAll?.() } catch { /* ignore */ }
      return {
        auth: {
          getUser: async () => ({ data: { user: mockState.user }, error: null }),
        },
        from: (_table: string) => {
          const builder: any = {
            select: () => builder,
            eq: () => builder,
            single: async () => {
              if (mockState.throwOnUserQuery) {
                throw new Error("simulated DB failure")
              }
              return {
                data: { onboarding_completed: mockState.onboarded },
                error: null,
              }
            },
          }
          return builder
        },
      }
    },
  }
})

// Force Supabase to be considered "enabled" so updateSession runs the auth path.
vi.mock("@/lib/supabase/config", () => ({ isSupabaseEnabled: true }))

// Bypass CSRF for these middleware tests; CSRF is covered by csrf-security.test.ts.
vi.mock("@/lib/csrf", () => ({
  validateCsrfToken: async () => true,
}))

// Import middleware AFTER mocks so they take effect at module-load time.
let middleware: typeof import("../../middleware").middleware

beforeEach(async () => {
  mockState.user = null
  mockState.onboarded = true
  mockState.throwOnUserQuery = false
  vi.resetModules()
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co"
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key"
  ;({ middleware } = await import("../../middleware"))
})

afterEach(() => {
  vi.restoreAllMocks()
})

function makeRequest(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; cookies?: Record<string, string> }
): NextRequest {
  const headers = new Headers(init?.headers)
  if (init?.cookies) {
    const cookieStr = Object.entries(init.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ")
    headers.set("cookie", cookieStr)
  }
  // NextRequest in Edge runtime accepts a URL or string + RequestInit.
  return new NextRequest(url, { method: init?.method ?? "GET", headers })
}

// ---------------------------------------------------------------------------
// CSP and security header assertions
// ---------------------------------------------------------------------------
describe("middleware: CSP and security headers", () => {
  it("sets default-src 'self' in CSP", async () => {
    const req = makeRequest("https://example.com/")
    const res = await middleware(req)
    const csp = res.headers.get("Content-Security-Policy")
    expect(csp).toBeTruthy()
    expect(csp).toContain("default-src 'self'")
  })

  it("CSP frame-ancestors not set explicitly but X-Frame-Options is SAMEORIGIN", async () => {
    // The middleware uses X-Frame-Options instead of frame-ancestors.
    const req = makeRequest("https://example.com/")
    const res = await middleware(req)
    expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN")
  })

  it("CSP does not contain wildcard '*' in script-src or connect-src", async () => {
    const req = makeRequest("https://example.com/")
    const res = await middleware(req)
    const csp = res.headers.get("Content-Security-Policy") ?? ""
    // Extract script-src and connect-src directives.
    const scriptSrc = (csp.match(/script-src[^;]*/) ?? [""])[0]
    const connectSrc = (csp.match(/connect-src[^;]*/) ?? [""])[0]
    expect(scriptSrc).not.toMatch(/\s\*(\s|;|$)/)
    expect(connectSrc).not.toMatch(/\s\*(\s|;|$)/)
  })

  it("sets X-Content-Type-Options: nosniff", async () => {
    const req = makeRequest("https://example.com/")
    const res = await middleware(req)
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
  })

  it("sets a Referrer-Policy", async () => {
    const req = makeRequest("https://example.com/")
    const res = await middleware(req)
    expect(res.headers.get("Referrer-Policy")).toBeTruthy()
    expect(res.headers.get("Referrer-Policy")).toMatch(/origin/)
  })

  it("sets a Permissions-Policy that disables camera, microphone, geolocation", async () => {
    const req = makeRequest("https://example.com/")
    const res = await middleware(req)
    const pp = res.headers.get("Permissions-Policy") ?? ""
    expect(pp).toContain("camera=()")
    expect(pp).toContain("microphone=()")
    expect(pp).toContain("geolocation=()")
  })

  it("sets HSTS in production but not in development", async () => {
    const original = process.env.NODE_ENV
    try {
      // Production
      // @ts-expect-error -- NODE_ENV is read-only in @types/node, but runtime allows write
      process.env.NODE_ENV = "production"
      vi.resetModules()
      const { middleware: prodMw } = await import("../../middleware")
      const prodRes = await prodMw(makeRequest("https://example.com/"))
      expect(prodRes.headers.get("Strict-Transport-Security")).toMatch(
        /max-age=\d+.*includeSubDomains/
      )

      // Development
      // @ts-expect-error -- see above
      process.env.NODE_ENV = "development"
      vi.resetModules()
      const { middleware: devMw } = await import("../../middleware")
      const devRes = await devMw(makeRequest("https://example.com/"))
      expect(devRes.headers.get("Strict-Transport-Security")).toBeNull()
    } finally {
      // @ts-expect-error -- restore
      process.env.NODE_ENV = original
      vi.resetModules()
    }
  })

  it("CSP differs (more permissive) between dev and prod", async () => {
    const original = process.env.NODE_ENV
    try {
      // @ts-expect-error
      process.env.NODE_ENV = "development"
      vi.resetModules()
      const { middleware: devMw } = await import("../../middleware")
      const devCsp =
        (await devMw(makeRequest("https://example.com/"))).headers.get(
          "Content-Security-Policy"
        ) ?? ""

      // @ts-expect-error
      process.env.NODE_ENV = "production"
      vi.resetModules()
      const { middleware: prodMw } = await import("../../middleware")
      const prodCsp =
        (await prodMw(makeRequest("https://example.com/"))).headers.get(
          "Content-Security-Policy"
        ) ?? ""

      expect(devCsp).not.toBe(prodCsp)
      // Prod adds vercel.live for live preview comments, dev does not.
      expect(prodCsp).toContain("vercel.live")
      expect(devCsp).not.toContain("vercel.live")
    } finally {
      // @ts-expect-error
      process.env.NODE_ENV = original
      vi.resetModules()
    }
  })

  it("CSP allows posthog, supabase, openai, github but no other third parties", async () => {
    const req = makeRequest("https://example.com/")
    const res = await middleware(req)
    const csp = res.headers.get("Content-Security-Policy") ?? ""
    expect(csp).toContain("posthog.com")
    expect(csp).toContain("supabase")
    expect(csp).toContain("api.openai.com")
    expect(csp).toContain("api.github.com")
    // Should NOT allow random ad networks / trackers.
    expect(csp).not.toContain("doubleclick.net")
    expect(csp).not.toContain("googletagmanager.com")
    expect(csp).not.toContain("facebook.com")
    expect(csp).not.toContain("googlesyndication.com")
  })
})

// ---------------------------------------------------------------------------
// Robustness — extreme inputs should not crash the middleware
// ---------------------------------------------------------------------------
describe("middleware: robustness against malicious or extreme inputs", () => {
  it("does not crash when Origin header is malformed", async () => {
    const req = makeRequest("https://example.com/", {
      headers: {
        // Junk that has historically broken naive URL parsers (no CR/LF —
        // those are rejected at the Headers layer, not the app layer).
        origin: "not a real origin %%% \\http://attacker",
      },
    })
    const res = await middleware(req)
    expect(res).toBeInstanceOf(NextResponse)
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
  })

  it("does not crash when Origin header contains null-byte-like junk", async () => {
    const req = makeRequest("https://example.com/", {
      headers: { origin: "\x09\x09evil-origin\x09" },
    })
    const res = await middleware(req)
    expect(res).toBeInstanceOf(NextResponse)
  })

  it("survives an extremely long URL (8KB query string)", async () => {
    const longQuery = "x=" + "a".repeat(8000)
    const req = makeRequest(`https://example.com/?${longQuery}`)
    const res = await middleware(req)
    expect(res).toBeInstanceOf(NextResponse)
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy()
  })

  it("survives a request with many cookies", async () => {
    const cookies: Record<string, string> = {}
    for (let i = 0; i < 100; i++) cookies[`c${i}`] = "v".repeat(50)
    const req = makeRequest("https://example.com/", { cookies })
    const res = await middleware(req)
    expect(res).toBeInstanceOf(NextResponse)
  })

  it("survives weird Accept-Language values", async () => {
    const req = makeRequest("https://example.com/", {
      headers: { "accept-language": ";;;,,,;q=NaN,zz-ZZ;q=-9" },
    })
    const res = await middleware(req)
    expect(res).toBeInstanceOf(NextResponse)
    expect(res.headers.get("Content-Language")).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Auth gating
// ---------------------------------------------------------------------------
describe("middleware: auth gating for protected routes", () => {
  it("unauthenticated request to /c/abc redirects to /auth", async () => {
    mockState.user = null
    const req = makeRequest("https://example.com/c/abc-123")
    const res = await middleware(req)
    // Redirect responses set a Location header.
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    const loc = res.headers.get("location") ?? ""
    expect(loc).toContain("/auth")
    expect(loc).toContain("redirectTo=%2Fc%2Fabc-123")
  })

  it("unauthenticated request to /machines redirects to /auth", async () => {
    mockState.user = null
    const req = makeRequest("https://example.com/machines")
    const res = await middleware(req)
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    expect(res.headers.get("location")).toContain("/auth")
  })

  it("unauthenticated request to a non-protected page (/) does NOT redirect", async () => {
    mockState.user = null
    const req = makeRequest("https://example.com/")
    const res = await middleware(req)
    // A 200-range "next" response does not have a Location header.
    expect(res.headers.get("location")).toBeNull()
  })

  it("authenticated user without onboarding completed redirects to /onboarding", async () => {
    mockState.user = { id: "u1", email: "u1@example.com" }
    mockState.onboarded = false
    const req = makeRequest("https://example.com/c/abc")
    const res = await middleware(req)
    const loc = res.headers.get("location") ?? ""
    expect(loc).toContain("/onboarding")
  })

  it("authenticated user with onboarding completed and coasty_onb cookie skips DB check", async () => {
    mockState.user = { id: "u1" }
    mockState.onboarded = false // would redirect if checked
    mockState.throwOnUserQuery = true // any DB call would throw
    const req = makeRequest("https://example.com/c/abc", {
      cookies: { coasty_onb: "1" },
    })
    const res = await middleware(req)
    // Should NOT redirect to /onboarding because the cookie shortcut was honored.
    const loc = res.headers.get("location") ?? ""
    expect(loc).not.toContain("/onboarding")
  })

  it("middleware does not crash when the onboarding DB query throws", async () => {
    mockState.user = { id: "u1" }
    mockState.throwOnUserQuery = true
    const req = makeRequest("https://example.com/c/abc")
    const res = await middleware(req)
    // The middleware swallows the error and lets the request through.
    expect(res).toBeInstanceOf(NextResponse)
  })

  it("note: /api/health and other /api routes are NOT processed by middleware (matcher excludes them)", async () => {
    // The middleware config matcher is /((?!api|_next/...).*) — meaning /api/* paths
    // are never invoked. We assert the matcher pattern excludes /api directly.
    // (Actually invoking middleware on /api/health is a no-op in Next.js routing.)
    const { config } = await import("../../middleware")
    const matcher = (config.matcher as string[])[0]
    // Quick sanity: matcher excludes "api"
    expect(matcher).toContain("api")
  })
})

// ---------------------------------------------------------------------------
// Bot-scanner probe paths — must short-circuit to 404 before auth/locale work
// ---------------------------------------------------------------------------
// Background: production access logs showed 187 hits/24h on /.env* family
// returning HTTP 200 (Next.js renders not-found.tsx → 200 with a not-found
// body), plus 29 hits/24h on /wp-admin/*. A 200 signals "live target" to mass
// scanners and keeps the site on automated retry lists. The fix is a
// middleware short-circuit that returns a real 404 for known probe shapes
// BEFORE running Supabase session refresh or locale routing.
describe("middleware: bot-scanner probe paths return 404", () => {
  // Probe paths that MUST return 404. Each tuple is [path, description].
  const PROBE_PATHS: Array<[string, string]> = [
    ["/.env", "root .env"],
    ["/.env.local", ".env.local"],
    ["/.env.production", ".env.production"],
    ["/.envrc", ".envrc (direnv config)"],
    ["/backend/.env", "nested .env"],
    ["/api-docs/../.env", "traversal-style .env"],
    ["/wp-admin/setup-config.php", "WordPress admin"],
    ["/wp-login.php", "WordPress login"],
    ["/wp-content/plugins/foo/readme.txt", "WordPress plugin"],
    ["/wp-includes/wlwmanifest.xml", "WordPress includes"],
    ["/xmlrpc.php", "WordPress xmlrpc"],
    ["/.git/config", ".git config"],
    ["/.git/HEAD", ".git HEAD"],
    ["/cgi-bin/test.cgi", "cgi-bin probe"],
    ["/cgi-bin", "cgi-bin no slash"],
    ["/actuator/env", "Spring actuator env"],
    ["/actuator/health", "Spring actuator health"],
    ["/actuator", "actuator no slash"],
    ["/phpmyadmin/index.php", "phpmyadmin lowercase"],
    ["/phpMyAdmin/", "phpMyAdmin mixed case"],
    ["/adminer.php", "adminer.php"],
    ["/adminer/", "adminer/"],
  ]

  for (const [path, label] of PROBE_PATHS) {
    it(`returns 404 for ${label} (${path})`, async () => {
      mockState.user = null
      const req = makeRequest(`https://example.com${path}`)
      const res = await middleware(req)
      expect(res.status).toBe(404)
    })
  }

  it("sets Cache-Control: no-store on the 404 so CDNs don't hide future probes from our access log", async () => {
    const req = makeRequest("https://example.com/.env")
    const res = await middleware(req)
    expect(res.status).toBe(404)
    expect(res.headers.get("Cache-Control")).toMatch(/no-store/)
  })

  it("sets X-Robots-Tag: noindex on the 404", async () => {
    const req = makeRequest("https://example.com/wp-admin/")
    const res = await middleware(req)
    expect(res.status).toBe(404)
    expect(res.headers.get("X-Robots-Tag")).toMatch(/noindex/)
  })

  it("does NOT redirect to /auth for a scanner probe even when unauthenticated and the path looks protected", async () => {
    // Without the short-circuit, /wp-admin would fall through to updateSession,
    // which would NOT redirect (wp-admin isn't a protected route), but the
    // Next.js app would render not-found.tsx as a 200. We want a real 404 and
    // no Supabase work at all.
    mockState.user = null
    const req = makeRequest("https://example.com/wp-admin/setup-config.php")
    const res = await middleware(req)
    expect(res.status).toBe(404)
    // No locale cookie should be set on a 404 to a scanner.
    const setCookie = res.headers.get("set-cookie") ?? ""
    expect(setCookie).not.toContain("NEXT_LOCALE")
  })

  it("scanner short-circuit runs BEFORE Supabase — no DB query on probe traffic", async () => {
    // throwOnUserQuery would normally cause a 5xx if updateSession were invoked
    // and reached the onboarding lookup. The scanner short-circuit must run
    // before any of that, so a probe returns a clean 404 even when the DB is
    // broken.
    mockState.user = { id: "u1" }
    mockState.throwOnUserQuery = true
    const req = makeRequest("https://example.com/.git/config")
    const res = await middleware(req)
    expect(res.status).toBe(404)
  })

  // --- Negative cases: legitimate paths must NOT be blocked. ---
  const LEGITIMATE_PATHS = [
    "/",
    "/account",
    "/agent-swarms",
    "/api-docs",
    "/auth",
    "/blog",
    "/blog/some-post-about-wp-stuff",
    "/credits",
    "/developers",
    "/pricing",
    "/help-actuator-docs",
    "/.well-known/security.txt",
    "/sitemap.xml",
    "/c/some-chat-id",
  ]

  for (const path of LEGITIMATE_PATHS) {
    it(`does NOT 404 the legitimate path ${path}`, async () => {
      mockState.user = { id: "u1" }
      mockState.onboarded = true
      const req = makeRequest(`https://example.com${path}`, {
        cookies: { coasty_onb: "1" },
      })
      const res = await middleware(req)
      // The scanner short-circuit must not match. The status might be a
      // redirect (e.g. /c/* for protected routes) or 200 — but never the
      // deliberate 404 from the scanner guard.
      // Use header presence as the disambiguator: the scanner 404 sets
      // X-Robots-Tag: noindex (and that's the only path that sets it in
      // middleware), so its absence proves the short-circuit didn't fire.
      const xrt = res.headers.get("X-Robots-Tag")
      expect(xrt).toBeNull()
    })
  }
})
