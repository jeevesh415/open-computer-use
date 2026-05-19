/**
 * Anti-regression: scan every Next.js API route under `app/api/**\/route.ts`
 * (and `app/v1/**\/route.ts`) for proxy `fetch()` calls into the Python
 * backend, and assert that the surrounding handler forwards the auth headers
 * we depend on:
 *
 *   * `X-Internal-Key`  — tells `backend/app/core/middleware.py` to skip
 *     CSRF + identifies the request as same-origin frontend → backend.
 *   * `X-User-ID`       — identifies the verified Supabase user to the
 *     backend so it can scope queries (and so backend tools can resolve
 *     credits, machines, schedules, etc.).
 *
 * # Background
 *
 * In production the backend `CSRFMiddleware` rejects state-changing requests
 * (POST/PUT/PATCH/DELETE) that don't carry one of:
 *
 *   1. `Authorization: Bearer ...` (Electron desktop app)
 *   2. `X-API-Key`                  (public CUA API)
 *   3. `X-Internal-Key`             (Next.js → backend proxy, post-fix)
 *   4. `X-CSRF-Token`               (legacy double-submit cookie path)
 *
 * Every Next.js proxy under `app/api/**` is the SAME-ORIGIN web hop. The
 * browser-facing leg has no CSRF risk (same origin); the server-to-server
 * leg uses the secret `INTERNAL_API_KEY`. If a route forgets to forward
 * `X-Internal-Key`, the request lands on backend CSRF middleware, fails the
 * skip checks above, and surfaces in production as the literal user-visible
 * body `{"error": "CSRF token missing"}` — the schedule-deletion bug fixed
 * at `backend/app/core/middleware.py:441-468`.
 *
 * Locally `DEBUG=true` masks this because the backend bypasses CSRF
 * entirely in dev. That's why the bug shape is "works locally, breaks
 * deployed".
 *
 * # What this test enforces
 *
 * For every `app/api/**\/route.ts` file (plus `app/v1/**\/route.ts`):
 *
 *   1. Find every `fetch(...)` call whose target involves
 *      `PYTHON_BACKEND_URL` (whether by template literal, `new URL()` with
 *      that base, or via a helper that uses the constant).
 *   2. For each match, assert the file ALSO contains the literal header
 *      strings `X-Internal-Key` and `X-User-ID`.
 *
 * Routes that legitimately do NOT forward those headers (e.g. the public
 * CUA API, which authenticates via `X-API-Key` and is skipped by the
 * backend `InternalAPIKeyMiddleware` for the `/v1` namespace) are listed
 * in `EXEMPT_ROUTES` with a one-line justification each.
 *
 * # Deliberate scope choices
 *
 *   * We grep at the file level (not call-site level). A handler may have
 *     a downstream `await fetch(${PYTHON_BACKEND_URL}/api/electron/...)`
 *     inside a long body but the header constant lives near the fetch in
 *     the same file. This is good enough — a route file forgetting both
 *     header names entirely is the failure mode we care about.
 *   * The `INTERNAL_API_KEY && { 'X-Internal-Key': ... }` pattern is the
 *     accepted shape: locally `INTERNAL_API_KEY` is empty, the spread
 *     drops the header, and the backend middleware no-ops because
 *     `DEBUG=True` bypasses CSRF anyway. We don't enforce a particular
 *     spread vs assignment shape; we only check the literal string is in
 *     the file.
 *   * We DO check that header strings appear in their canonical form
 *     (`'X-Internal-Key'` and `'X-User-ID'`) since the backend reads
 *     headers case-insensitively but typos like `X-User-Id` would still
 *     work — we standardise on the canonical capitalisation to keep grep
 *     attacks (and code-review) sane.
 */

import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const REPO_ROOT = resolve(__dirname, "..", "..")
const SCAN_ROOTS = ["app/api", "app/v1"].map((d) => join(REPO_ROOT, d))

// Routes exempt from the X-Internal-Key + X-User-ID requirement. Each entry
// MUST come with a one-line justification — adding a route here without one
// fails the meta-self-check at the bottom of this file.
//
// Path is relative to repo root, normalized to forward slashes.
const EXEMPT_ROUTES: { path: string; reason: string }[] = [
  {
    path: "app/api/v1/cua/[...path]/route.ts",
    reason:
      "Public CUA API (legacy alias). Authenticates via X-API-Key; backend " +
      "InternalAPIKeyMiddleware skips the /api/v1/cua/* namespace. " +
      "Forwarding X-Internal-Key here would be a SECURITY BUG: it would " +
      "elevate untrusted public-API callers to internal-trust requests.",
  },
  {
    path: "app/v1/[...path]/route.ts",
    reason:
      "Public CUA API (canonical /v1/* path). Authenticates via X-API-Key " +
      "or Authorization: Bearer sk-coasty-*. Same SECURITY rationale as the " +
      "legacy alias above — never forward X-Internal-Key here.",
  },
  {
    path: "app/api/osworld/[...path]/route.ts",
    reason:
      "OSWorld evaluation harness authenticates via dedicated X-OSWorld-Key " +
      "header (no Supabase user context). Forwards X-Internal-Key (so " +
      "backend CSRFMiddleware passes) but intentionally omits X-User-ID " +
      "since the harness operates without a per-user identity.",
  },
]

type Hit = {
  file: string
  line: number
  snippet: string
}

function* walk(dir: string): Generator<string> {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (
        entry === "node_modules" ||
        entry === ".next" ||
        entry === ".turbo" ||
        entry === "dist" ||
        entry === "build" ||
        entry === ".git"
      )
        continue
      yield* walk(full)
    } else if (st.isFile() && entry === "route.ts") {
      yield full
    }
  }
}

/** Find every `fetch(...)` call in the file that targets the Python backend.
 *
 *  We accept any of these surface shapes (in order of frequency in this repo):
 *    1. `fetch(\`${PYTHON_BACKEND_URL}/...\`, ...)`           — most routes
 *    2. `fetch(upstreamUrl.toString(), ...)`                  — files route
 *    3. `fetch(url.toString(), ...)`                          — proxy routes
 *    4. `fetch(backendUrl, ...)`                              — schedules route
 *    5. `fetch(buildBackendUrl(...), ...)`                    — teams route
 *
 *  Detection is fuzzy on purpose — we want to catch new routes that follow
 *  the same patterns. False positives are caught by the EXEMPT_ROUTES list.
 */
function findBackendFetchCalls(content: string): Hit[] {
  const hits: Hit[] = []
  // Single-pass regex over the whole file, line numbers derived from offset.
  const patterns = [
    // 1. `fetch(... PYTHON_BACKEND_URL ...)` — the most common shape, even
    //    when wrapped over multiple lines. We allow up to 200 chars between
    //    `fetch(` and `PYTHON_BACKEND_URL` to tolerate template-literal prefixes.
    /\bfetch\s*\([^)]{0,200}PYTHON_BACKEND_URL/g,
    // 2/3. `fetch(<varname>.toString(), ...)` — covers `upstreamUrl`, `url`,
    //      etc.  Requires the file to ALSO reference PYTHON_BACKEND_URL
    //      somewhere; we filter on that below to avoid matching unrelated
    //      `.toString()` fetches.
    /\bfetch\s*\(\s*[A-Za-z_$][\w$]*\.toString\(\)/g,
    // 4. `fetch(<varname>, ...)` for plain string variables built from
    //    PYTHON_BACKEND_URL.  Same file-level filter as above.
    /\bfetch\s*\(\s*backendUrl[\s,)]/g,
    // 5. `fetch(buildBackendUrl(...), ...)` — schedules teams pattern.
    /\bfetch\s*\(\s*buildBackendUrl\s*\(/g,
  ]

  // File-level guard: only count shape 2/3/4/5 hits if the file references
  // PYTHON_BACKEND_URL anywhere — otherwise we're matching public-API
  // proxies (which use a different env var or pass-through pattern).
  const filePresumesBackend = /PYTHON_BACKEND_URL/.test(content)

  const seen = new Set<number>() // dedupe by character offset

  for (let i = 0; i < patterns.length; i++) {
    const re = patterns[i]
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      // Shapes 2..5 require file-level PYTHON_BACKEND_URL presence so we
      // don't pick up unrelated public-API or third-party fetches.
      if (i > 0 && !filePresumesBackend) continue

      if (seen.has(m.index)) continue
      seen.add(m.index)

      const before = content.slice(0, m.index)
      const line = (before.match(/\n/g)?.length ?? 0) + 1
      // Snippet: the rest of the matched line, trimmed.
      const lineEnd = content.indexOf("\n", m.index)
      const snippet = content
        .slice(m.index, lineEnd === -1 ? undefined : lineEnd)
        .trim()
      hits.push({ file: "", line, snippet })
    }
  }
  return hits
}

function fileContains(content: string, literal: string): boolean {
  // We allow either single- or double-quoted forms; the backend reads
  // headers case-insensitively but we standardise on the canonical form.
  return (
    content.includes(`"${literal}"`) ||
    content.includes(`'${literal}'`) ||
    content.includes(`\`${literal}\``)
  )
}

describe("proxy routes forward X-Internal-Key + X-User-ID (anti-regression for the schedule-DELETE CSRF bug)", () => {
  it("EXEMPT_ROUTES entries are well-formed", () => {
    for (const entry of EXEMPT_ROUTES) {
      expect(entry.path, "exempt entry must have a path").toBeTruthy()
      expect(entry.reason.length, `exempt entry for ${entry.path} must have a justification`).toBeGreaterThan(20)
      // Resolves to an existing file.
      const abs = join(REPO_ROOT, entry.path)
      const exists = (() => {
        try {
          return statSync(abs).isFile()
        } catch {
          return false
        }
      })()
      expect(exists, `exempt route file does not exist: ${entry.path}`).toBe(true)
    }
  })

  it("every proxy route forwards both X-Internal-Key and X-User-ID (or is documented EXEMPT)", () => {
    const violations: { file: string; missing: string[]; hits: Hit[] }[] = []
    let routesScanned = 0
    let routesProxying = 0

    for (const root of SCAN_ROOTS) {
      for (const file of walk(root)) {
        routesScanned++
        const rel = relative(REPO_ROOT, file).replace(/\\/g, "/")

        let content: string
        try {
          content = readFileSync(file, "utf8")
        } catch {
          continue
        }

        const hits = findBackendFetchCalls(content).map((h) => ({ ...h, file: rel }))
        if (hits.length === 0) continue
        routesProxying++

        // Skip exempt routes (with documented justification).
        const exempt = EXEMPT_ROUTES.find((e) => e.path === rel)
        if (exempt) continue

        const missing: string[] = []
        if (!fileContains(content, "X-Internal-Key")) missing.push("X-Internal-Key")
        if (!fileContains(content, "X-User-ID")) missing.push("X-User-ID")

        if (missing.length > 0) {
          violations.push({ file: rel, missing, hits })
        }
      }
    }

    // Sanity: we should always find at least the routes we know exist.
    // If this drops to zero, the walker is broken (e.g. pattern regex
    // change), not a sign of a clean codebase.
    expect(
      routesProxying,
      "expected to find proxy routes — walker may be broken",
    ).toBeGreaterThanOrEqual(15)
    expect(routesScanned, "expected to scan many route.ts files").toBeGreaterThan(20)

    if (violations.length > 0) {
      const lines: string[] = [
        `Found ${violations.length} proxy route(s) that fetch into the`,
        `Python backend without forwarding the auth headers required for the`,
        `backend CSRFMiddleware skip path.  In deployment these surface to`,
        `users as: \`{"error": "CSRF token missing"}\` (the literal body the`,
        `schedule-DELETE bug rendered before the fix).`,
        ``,
        `Fix each by adding the canonical buildHeaders pattern from`,
        `app/api/schedules/[chatId]/route.ts:`,
        ``,
        `  const headers = {`,
        `    'Content-Type': 'application/json',`,
        `    'X-User-ID': userId,`,
        `    ...(INTERNAL_API_KEY && { 'X-Internal-Key': INTERNAL_API_KEY }),`,
        `  }`,
        ``,
        `Violations:`,
        ``,
      ]
      for (const v of violations) {
        lines.push(`  ${v.file} — missing: ${v.missing.join(", ")}`)
        for (const h of v.hits) {
          lines.push(`    ${v.file}:${h.line}  ${h.snippet}`)
        }
      }
      lines.push(
        ``,
        `If a route legitimately must NOT forward these headers (e.g. it's`,
        `a public-API proxy authenticating via X-API-Key, or it has its own`,
        `signature scheme), add it to EXEMPT_ROUTES at the top of this file`,
        `with a one-line justification — that justification is reviewed by`,
        `the security-review process.`,
      )
      throw new Error(lines.join("\n"))
    }
  })

  it("the canonical reference (schedules/[chatId]/route.ts) actually contains the headers — guard against the test self-cancelling", () => {
    const ref = readFileSync(
      join(REPO_ROOT, "app/api/schedules/[chatId]/route.ts"),
      "utf8",
    )
    expect(fileContains(ref, "X-Internal-Key")).toBe(true)
    expect(fileContains(ref, "X-User-ID")).toBe(true)
    // And the helper that this test's logic implicitly depends on:
    expect(ref).toMatch(/buildHeaders/)
  })
})
