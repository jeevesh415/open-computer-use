/**
 * api-routes-gauntlet.test.ts — programmatic security gauntlet for every
 * Next.js App Router API route under app/api/.
 *
 * Strategy
 * --------
 * 1. Walk app/api/** with `fs` and discover every `route.ts` file.
 * 2. Read each file's source and parse the exported HTTP method symbols
 *    (GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD).
 * 3. For each (route, method) tuple, run a static-analysis matrix:
 *      - never echoes Cookie header into the response
 *      - never console.errors a thing that includes the request body
 *      - never imports SUPABASE_SERVICE_ROLE inside a path that could leak it
 *        (we accept routes that read it server-side, but flag any path where
 *         it ends up in a JSON.stringify of the response)
 *      - never accepts client-provided user_id without server override
 *      - never returns dangerouslySetInnerHTML / raw HTML
 *      - declares Content-Type: application/json on JSON responses
 * 4. For protected routes (chat, chats, billing, schedules, files, secrets,
 *    machines, etc.) confirm that `getUser()` (or a Bearer-token verify call)
 *    is referenced in the source.
 * 5. The test surface is *static*. It does NOT execute routes. The
 *    post-deploy companion file (tests/post_deploy/test_security_api_routes_gauntlet.py)
 *    runs the live attack matrix — body size, malformed JSON, prototype
 *    pollution, etc. Static here = deterministic / no flakes / no fixtures.
 *
 * The intent is for this file to be **strict on definite issues** and
 * **soft (console.warn) on suspicious-but-not-conclusive** patterns.
 * That keeps the signal-to-noise ratio sane as the surface grows.
 *
 * Sibling files this gauntlet does NOT duplicate:
 *   - middleware-security.test.ts  (CSP, headers, auth gating)
 *   - api-proxy-security.test.ts   (INTERNAL_API_KEY plumbing for /api/chat)
 *   - csrf-security.test.ts        (CSRF token mechanics)
 *   - route-security.test.ts       (UUID validation in schedule routes)
 */
import fs from "fs"
import path from "path"
import { describe, it, expect } from "vitest"

// ---------------------------------------------------------------------------
// Discovery — walk app/api/ for every route.ts
// ---------------------------------------------------------------------------

interface DiscoveredRoute {
  /** Absolute filesystem path. */
  filePath: string
  /** "/api/foo/bar" style URL (with [param] placeholders intact). */
  urlPath: string
  /** Methods exported from this file. */
  methods: string[]
  /** Raw source text (cached so we only read once). */
  source: string
}

const REPO_ROOT = path.resolve(__dirname, "../..")
const API_ROOT = path.join(REPO_ROOT, "app", "api")

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const

function walkDir(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walkDir(p, out)
    else if (/^route\.(ts|tsx|js)$/.test(entry.name)) out.push(p)
  }
  return out
}

function fileToUrlPath(filePath: string): string {
  // .../app/api/<segments>/route.ts → "/api/<segments>"
  const rel = path.relative(API_ROOT, path.dirname(filePath))
  const segs = rel.split(path.sep).filter(Boolean)
  return "/api" + (segs.length ? "/" + segs.join("/") : "")
}

function detectExportedMethods(src: string): string[] {
  const found = new Set<string>()
  for (const m of HTTP_METHODS) {
    // Match: `export async function GET(`, `export function GET(`,
    // `export const GET =`, `export const GET: ... =`, also re-exports
    // like `export const GET = proxyToBackend`.
    const patterns: RegExp[] = [
      new RegExp(`export\\s+async\\s+function\\s+${m}\\b`),
      new RegExp(`export\\s+function\\s+${m}\\b`),
      new RegExp(`export\\s+const\\s+${m}\\b\\s*[:=]`),
      new RegExp(`export\\s*\\{[^}]*\\b${m}\\b[^}]*\\}`),
    ]
    if (patterns.some((re) => re.test(src))) found.add(m)
  }
  return [...found]
}

const routeFiles = walkDir(API_ROOT)

const ROUTES: DiscoveredRoute[] = routeFiles.map((filePath) => {
  const source = fs.readFileSync(filePath, "utf8")
  return {
    filePath,
    urlPath: fileToUrlPath(filePath),
    methods: detectExportedMethods(source),
    source,
  }
})

// Stable order for readable test names.
ROUTES.sort((a, b) => a.urlPath.localeCompare(b.urlPath))

// ---------------------------------------------------------------------------
// Sanity — discovery must find a non-trivial number of routes
// ---------------------------------------------------------------------------

describe("api-routes-gauntlet: discovery", () => {
  it("finds at least 50 route files under app/api/", () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(50)
  })

  it("every discovered route exports at least one HTTP method", () => {
    const empty = ROUTES.filter((r) => r.methods.length === 0).map((r) => r.urlPath)
    // Some routes may legitimately have no exported methods (e.g. type-only
    // helpers or Next.js dynamic-only handlers); flag as warn, not fail.
    if (empty.length) {
      // eslint-disable-next-line no-console
      console.warn(
        `[gauntlet] ${empty.length} route file(s) have no detectable HTTP method export: ${empty.join(", ")}`
      )
    }
    // We still require the *majority* to have at least one, to catch a
    // regex bug if it ever silently breaks.
    const withAny = ROUTES.filter((r) => r.methods.length > 0).length
    expect(withAny).toBeGreaterThanOrEqual(Math.floor(ROUTES.length * 0.95))
  })

  it("reports the discovered surface (informational)", () => {
    // eslint-disable-next-line no-console
    console.warn(
      `[gauntlet] discovered ${ROUTES.length} route files, ` +
        `${ROUTES.reduce((n, r) => n + r.methods.length, 0)} (route,method) tuples`
    )
    expect(ROUTES.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Static security matrix — applied per-route
// ---------------------------------------------------------------------------

/** Routes that we *expect* to perform an auth check (Supabase getUser /
 *  Bearer verify / API-key check / OSWorld key, etc.). */
const PROTECTED_PREFIXES = [
  "/api/chat",
  "/api/chats",
  "/api/billing",
  "/api/credits",
  "/api/schedules",
  "/api/files",
  "/api/secrets",
  "/api/machines",
  "/api/swarm",
  "/api/swarms",
  "/api/projects",
  "/api/onboarding",
  "/api/user-keys",
  "/api/user-key-status",
  "/api/user-preferences",
  "/api/electron",
  "/api/collaborative-rooms",
  "/api/feedback",
  "/api/subscription",
  "/api/referral",
  "/api/developers",
  "/api/discover",
  "/api/create-chat",
  "/api/update-chat-model",
  "/api/rate-limits",
  "/api/v1/cua", // public dev API (legacy alias) — auth via X-API-Key
  "/v1", // public dev API (canonical) — auth via X-API-Key / Bearer
  "/api/osworld", // auth via X-OSWorld-Key
]

/** Routes that are intentionally public (no auth gate expected). */
const PUBLIC_ALLOWED = [
  "/api/health",
  "/api/csrf",
  "/api/models",
  "/api/providers",
  "/api/locale",
  "/api/status",
  "/api/status/history",
  "/api/status/cron",
  "/api/blog/posts",
  "/api/blog/seo-pages",
  "/api/blog/revalidate",
  "/api/download",
  "/api/validate-email",
  // /api/discover lists chats marked public=true via service client — no
  // user auth, gated by the public column. Documented in the route source.
  "/api/discover",
  // /api/swarms/shared/[id] is shared-swarm read endpoint, gated by public=true.
  "/api/swarms/shared",
  // Stripe webhook authenticates via the Stripe signature header, not Supabase.
  "/api/credits/webhook",
  // Disabled feature — handler intentionally returns 404 with no auth.
  "/api/projects",
]

/**
 * Auxiliary auth signals we accept in addition to Supabase getUser/Bearer:
 *  - Stripe webhook signature validation
 *  - HMAC token validation (verifySecureToken)
 *  - Routes that handle their own access control via service-client + filter
 *    (e.g. .eq("public", true)) when the URL also matches PUBLIC_ALLOWED above.
 */
const ALT_AUTH_PATTERNS = [
  /verifySecureToken\s*\(/,            // HMAC-signed token (VNC proxy)
  /stripe\.webhooks\.constructEvent/,  // Stripe webhook signature
  /STRIPE_WEBHOOK_SECRET/,             // Stripe webhook secret usage
  /feature is disabled/i,              // route returns 404 unconditionally
]

function isProtected(urlPath: string): boolean {
  return PROTECTED_PREFIXES.some((p) => urlPath === p || urlPath.startsWith(p + "/"))
}

function isPublicAllowed(urlPath: string): boolean {
  return PUBLIC_ALLOWED.some((p) => urlPath === p || urlPath.startsWith(p + "/"))
}

/** Tracks which routes failed which checks — printed in the final summary. */
const RESULTS: Record<string, { passed: string[]; failed: string[]; warned: string[] }> = {}

function record(urlPath: string, check: string, kind: "passed" | "failed" | "warned") {
  RESULTS[urlPath] ??= { passed: [], failed: [], warned: [] }
  RESULTS[urlPath][kind].push(check)
}

// ---------------------------------------------------------------------------

describe("api-routes-gauntlet: static security matrix", () => {
  for (const route of ROUTES) {
    const { urlPath, source, methods, filePath } = route
    const fileLabel = path.relative(REPO_ROOT, filePath)

    describe(`${urlPath} (${methods.join(",") || "no-methods"})`, () => {
      // -------------------------------------------------------------------
      // 1. Doesn't echo the Cookie header into the response body.
      // -------------------------------------------------------------------
      it(`${urlPath}: does not echo Cookie header into response`, () => {
        // Pattern: NextResponse.json({ ..., cookie: ... headers.get('cookie') ...
        // Any literal `headers.get("cookie")` that flows into a `return ... json(`
        // statement is suspicious. We do a coarse check.
        const cookieRead = /headers\.get\(\s*['"]cookie['"]\s*\)/i.test(source)
        if (cookieRead) {
          // Look for: same source contains both `headers.get('cookie')` AND
          // a `NextResponse.json(...cookie...)` — too coarse to fail on, but warn.
          const echoesIntoJson =
            /NextResponse\.json\([^)]*\b(cookie|cookies)\b[^)]*\)/i.test(source)
          if (echoesIntoJson) {
            record(urlPath, "no-cookie-echo", "failed")
            throw new Error(
              `${fileLabel}: reads request cookie header AND appears to JSON-encode it back ` +
                `into a response. Inspect manually.`
            )
          }
          record(urlPath, "no-cookie-echo", "warned")
        } else {
          record(urlPath, "no-cookie-echo", "passed")
        }
        expect(true).toBe(true)
      })

      // -------------------------------------------------------------------
      // 2. console.error(error) where `error` may include request body.
      // -------------------------------------------------------------------
      it(`${urlPath}: does not console.error a value containing the raw request body`, () => {
        // Heuristic: a console.error call whose argument list mentions
        // `body`, `req.body`, `request.body` is suspicious because errors
        // shipped to logs/Sentry can leak PII / API keys / messages.
        const bad = /console\.error\([^)]*\b(body|req\.body|request\.body)\b/i.test(source)
        if (bad) {
          record(urlPath, "no-body-in-console-error", "failed")
        } else {
          record(urlPath, "no-body-in-console-error", "passed")
        }
        expect(bad).toBe(false)
      })

      // -------------------------------------------------------------------
      // 3. SUPABASE_SERVICE_ROLE never appears inside a JSON response.
      // -------------------------------------------------------------------
      it(`${urlPath}: SUPABASE_SERVICE_ROLE not leaked into response`, () => {
        // The service role key is a top-of-Supabase super-admin secret. It
        // can legitimately be read inside server code (createServiceClient),
        // but should NEVER be JSON.stringified or returned. We check for
        // patterns where the literal env var name flows into a response.
        const refsRole = /SUPABASE_SERVICE_ROLE/.test(source)
        if (!refsRole) {
          record(urlPath, "no-service-role-leak", "passed")
          return
        }
        // Any of these = clear leak:
        const leaks = [
          /NextResponse\.json\([^)]*SUPABASE_SERVICE_ROLE/,
          /JSON\.stringify\([^)]*SUPABASE_SERVICE_ROLE/,
          /return\s+new\s+Response\([^)]*SUPABASE_SERVICE_ROLE/,
        ]
        const isLeak = leaks.some((re) => re.test(source))
        if (isLeak) {
          record(urlPath, "no-service-role-leak", "failed")
        } else {
          record(urlPath, "no-service-role-leak", "passed")
        }
        expect(isLeak).toBe(false)
      })

      // -------------------------------------------------------------------
      // 4. Doesn't accept user_id from request body without server override.
      //
      //    Pattern proven safe (chat route):
      //      const body = await req.json()
      //      ...
      //      body.user_id = authData.user.id  ← server override
      //
      //    Pattern flagged unsafe:
      //      const { user_id } = await req.json()
      //      supabase.from('x').insert({ user_id, ... })
      // -------------------------------------------------------------------
      it(`${urlPath}: client-provided user_id is never trusted without server override`, () => {
        // Look for destructuring of user_id from body
        const destructuresUserId =
          /(?:const|let)\s*\{[^}]*\buser_id\b[^}]*\}\s*=\s*await\s+(?:req|request)\.json/.test(
            source
          )
        if (!destructuresUserId) {
          record(urlPath, "no-spoofed-user-id", "passed")
          return
        }
        // If destructured, must be followed by an override using auth user id.
        const hasServerOverride =
          /(?:body\.user_id|user_id)\s*=\s*authData?\.user\.id/.test(source) ||
          /(?:body\.user_id|user_id)\s*=\s*user\.id/.test(source) ||
          /(?:body\.user_id|user_id)\s*=\s*authUser\.id/.test(source)
        if (!hasServerOverride) {
          // Soft warn — many routes legitimately destructure user_id only
          // to ignore it, and we want to avoid false positives that block PRs.
          // eslint-disable-next-line no-console
          console.warn(
            `[gauntlet] ${fileLabel}: destructures user_id from request body — verify ` +
              `it is overridden with the server-verified auth.user.id before any DB write.`
          )
          record(urlPath, "no-spoofed-user-id", "warned")
        } else {
          record(urlPath, "no-spoofed-user-id", "passed")
        }
        expect(true).toBe(true)
      })

      // -------------------------------------------------------------------
      // 5. No dangerouslySetInnerHTML / raw HTML in API responses.
      //    API routes are JSON-only; HTML implies XSS reflection vector.
      // -------------------------------------------------------------------
      it(`${urlPath}: does not return dangerouslySetInnerHTML or raw HTML`, () => {
        const bad =
          /dangerouslySetInnerHTML/.test(source) ||
          /Content-Type['"]\s*:\s*['"]text\/html/i.test(source)
        if (bad) record(urlPath, "no-raw-html", "failed")
        else record(urlPath, "no-raw-html", "passed")
        expect(bad).toBe(false)
      })

      // -------------------------------------------------------------------
      // 6. JSON responses declare Content-Type: application/json
      //    (or use NextResponse.json which sets it automatically).
      // -------------------------------------------------------------------
      it(`${urlPath}: declares JSON content-type when emitting JSON`, () => {
        const usesNextResponseJson = /NextResponse\.json\(/.test(source)
        const usesResponseJson = /return\s+Response\.json\(/.test(source)
        const declaresExplicit = /['"]Content-Type['"]\s*:\s*['"]application\/json/i.test(
          source
        )
        const emitsJsonLiteral = /JSON\.stringify\([^)]+\)/.test(source)
        // If the route emits JSON literals via `new Response(JSON.stringify(...))`
        // it MUST also declare the content-type header.
        if (emitsJsonLiteral && !usesNextResponseJson && !usesResponseJson) {
          if (!declaresExplicit) {
            record(urlPath, "json-content-type", "warned")
            // eslint-disable-next-line no-console
            console.warn(
              `[gauntlet] ${fileLabel}: emits JSON.stringify but no explicit ` +
                `Content-Type: application/json header — clients may misparse.`
            )
          } else {
            record(urlPath, "json-content-type", "passed")
          }
        } else {
          record(urlPath, "json-content-type", "passed")
        }
        expect(true).toBe(true)
      })

      // -------------------------------------------------------------------
      // 7. Auth check expectation for protected routes.
      // -------------------------------------------------------------------
      if (isProtected(urlPath) && !isPublicAllowed(urlPath)) {
        it(`${urlPath}: protected route references an auth check`, () => {
          const hasGetUser = /\.auth\.getUser\s*\(/.test(source)
          const hasBearer = /verifyBearerToken\s*\(/.test(source)
          const hasApiKey = /(?:X-OSWorld-Key|X-API-Key|x-api-key|X-Internal-Key)/.test(
            source
          )
          // Catch-all proxies for /v1, /api/v1/cua, and /api/osworld delegate
          // auth to the FastAPI backend — they only need to forward an auth
          // header. Detected by the [...path] segment in the file path.
          const isCatchAllProxy = /\[\.\.\.\w+\]/.test(filePath)
          // Accept alternative auth mechanisms (HMAC tokens, Stripe webhook
          // signatures, disabled-feature stubs).
          const hasAltAuth = ALT_AUTH_PATTERNS.some((re) => re.test(source))
          const ok = hasGetUser || hasBearer || hasApiKey || isCatchAllProxy || hasAltAuth
          if (!ok) record(urlPath, "auth-check-present", "failed")
          else record(urlPath, "auth-check-present", "passed")
          expect(ok).toBe(true)
        })
      }

      // -------------------------------------------------------------------
      // 8. Per-method method-confusion check: a file should NOT export a
      //    handler that points at the same impl for both GET and a
      //    state-changing verb (POST/PUT/DELETE) WITHOUT branching on method
      //    — that's a classic source of CSRF / cache-poisoning.
      // -------------------------------------------------------------------
      it(`${urlPath}: method-confusion guard (GET vs state-changing verb)`, () => {
        // Look for the pattern `export const GET = X; export const POST = X;`
        // where X is the same identifier — only OK if X internally branches
        // on req.method.
        const aliases: Record<string, string> = {}
        for (const m of HTTP_METHODS) {
          const re = new RegExp(`export\\s+const\\s+${m}\\s*=\\s*(\\w+)`)
          const match = re.exec(source)
          if (match) aliases[m] = match[1]
        }
        const get = aliases.GET
        const stateChanging = ["POST", "PUT", "PATCH", "DELETE"]
          .map((m) => aliases[m])
          .filter(Boolean)
        if (get && stateChanging.includes(get)) {
          // Same handler aliases GET and a state-changer. Must branch on
          // req.method internally — check for that.
          const branches = /req\.method|request\.method/.test(source)
          if (!branches) {
            record(urlPath, "no-method-confusion", "failed")
            throw new Error(
              `${fileLabel}: GET and a state-changing method point at the same ` +
                `handler with no req.method branching — vulnerable to method confusion.`
            )
          }
        }
        record(urlPath, "no-method-confusion", "passed")
        expect(true).toBe(true)
      })

      // -------------------------------------------------------------------
      // 9. Prototype-pollution surface check: routes that spread req.json()
      //    directly into objects without validation are a risk vector.
      // -------------------------------------------------------------------
      it(`${urlPath}: does not spread req.json() into a model object unguarded`, () => {
        // Pattern: `{ ...await req.json() }` or `{ ...body }` where body is
        // unvalidated and immediately persisted via .insert / .upsert.
        const spreadsBody =
          /\{\s*\.\.\.\s*await\s+(?:req|request)\.json\(\)\s*[\},]/.test(source) ||
          /\{\s*\.\.\.\s*body\s*\}\s*\)/.test(source)
        if (spreadsBody) {
          // Soft warn — could be safe if downstream validates, but worth flagging.
          // eslint-disable-next-line no-console
          console.warn(
            `[gauntlet] ${fileLabel}: spreads request body into an object — ` +
              `verify __proto__ / constructor keys are stripped or validated.`
          )
          record(urlPath, "no-prototype-pollution-surface", "warned")
        } else {
          record(urlPath, "no-prototype-pollution-surface", "passed")
        }
        expect(true).toBe(true)
      })
    })
  }
})

// ---------------------------------------------------------------------------
// Final summary — printed once after all per-route tests complete.
// ---------------------------------------------------------------------------

describe("api-routes-gauntlet: summary", () => {
  it("emits per-route pass/fail/warn counts", () => {
    const totals = { passed: 0, failed: 0, warned: 0 }
    const failedRoutes: string[] = []
    const warnedRoutes: string[] = []
    for (const [url, r] of Object.entries(RESULTS)) {
      totals.passed += r.passed.length
      totals.failed += r.failed.length
      totals.warned += r.warned.length
      if (r.failed.length) failedRoutes.push(`${url}: ${r.failed.join(", ")}`)
      if (r.warned.length) warnedRoutes.push(`${url}: ${r.warned.join(", ")}`)
    }
    // eslint-disable-next-line no-console
    console.warn(
      `[gauntlet summary] routes=${Object.keys(RESULTS).length} ` +
        `passed-checks=${totals.passed} failed-checks=${totals.failed} warned-checks=${totals.warned}`
    )
    if (failedRoutes.length) {
      // eslint-disable-next-line no-console
      console.warn(`[gauntlet summary] FAILED:\n  ${failedRoutes.join("\n  ")}`)
    }
    if (warnedRoutes.length) {
      // eslint-disable-next-line no-console
      console.warn(
        `[gauntlet summary] WARNED (review):\n  ${warnedRoutes.slice(0, 30).join("\n  ")}` +
          (warnedRoutes.length > 30 ? `\n  ... +${warnedRoutes.length - 30} more` : "")
      )
    }
    // The per-route tests already enforce hard failures; this aggregator is
    // informational so we always pass.
    expect(true).toBe(true)
  })
})
