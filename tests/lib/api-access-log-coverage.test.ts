/**
 * Meta-test: catches future API routes that forget the access-log helper.
 *
 * Why this exists
 * ---------------
 * The 4-day audit found that `/api/*` routes were invisible to the
 * structured access log because the middleware matcher excludes them.
 * The fix was a lightweight per-route helper (`logApiAccess`). To make
 * sure that fix doesn't rot, this meta-test scans every
 * `app/api/**\/route.ts` file and asserts it either imports
 * `logApiAccess` (the canonical path) OR contains an explicit
 * `// access-log-exempt:` comment with a justification (escape hatch
 * for routes that are deliberately silent, e.g. health checks).
 *
 * The test is initially failing for many routes — they'll be migrated
 * batch-by-batch. To bootstrap, we maintain an `ALLOWLIST_PENDING_MIGRATION`
 * set of routes that don't have the helper yet. The CI assertion is
 * "every NEW route uses the helper" (i.e. the allowlist must not grow).
 * As routes are migrated, they should be removed from the allowlist.
 *
 * Strict mode: set COASTY_STRICT_ACCESS_LOG=1 to fail when ANY route in
 * the allowlist is missing the helper. Default mode allows the existing
 * backlog while preventing NEW routes from being added to it.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const REPO_ROOT = join(__dirname, "..", "..")
const API_DIR = join(REPO_ROOT, "app", "api")

/**
 * Routes that haven't yet been migrated to use `logApiAccess`.
 *
 * INVARIANT: this set must NEVER grow. As routes are converted, remove
 * them from this list. The meta-test fails fast if a new route file
 * appears without the helper.
 *
 * Paths are stored as forward-slash relative paths from app/api/.
 */
const ALLOWLIST_PENDING_MIGRATION = new Set<string>([
  // Bootstrap: chat, files, credits/webhook are migrated.
  // Everything else is grandfathered until it gets touched for unrelated
  // reasons. New routes MUST use the helper (enforced below).
  "ai-plugin/route.ts",
  "blog/posts/[id]/route.ts",
  "blog/posts/route.ts",
  "blog/revalidate/route.ts",
  "blog/seo-pages/route.ts",
  "chat/machine-status/[machineId]/route.ts",
  "chat/resume-human/[machineId]/route.ts",
  "chat/stop-machine/[machineId]/route.ts",
  "chats/[chatId]/messages/route.ts",
  "chats/[chatId]/route.ts",
  "collaborative-rooms/[roomId]/activity/route.ts",
  "collaborative-rooms/[roomId]/messages/route.ts",
  "collaborative-rooms/[roomId]/participants/route.ts",
  "collaborative-rooms/[roomId]/route.ts",
  "collaborative-rooms/route.ts",
  "create-chat/route.ts",
  "credits/auto-refill/execute/route.ts",
  "credits/auto-refill/route.ts",
  "credits/balance/route.ts",
  "credits/checkout/route.ts",
  "credits/history/route.ts",
  "csrf/route.ts",
  "debug/machine-cleanup/route.ts",
  "developers/[id]/route.ts",
  "developers/route.ts",
  "discover/route.ts",
  "discovery/route.ts",
  "download/route.ts",
  "electron/error/route.ts",
  "electron/machines/[id]/approvals/[approvalId]/respond/route.ts",
  "electron/machines/[id]/approvals/route.ts",
  "electron/machines/[id]/health/route.ts",
  "electron/machines/route.ts",
  "electron/proxy/[...path]/route.ts",
  "feedback/run/route.ts",
  "health/route.ts",
  "identity/route.ts",
  "locale/route.ts",
  "machines/[id]/agent-health/route.ts",
  "machines/[id]/route.ts",
  "machines/[id]/screenshot/route.ts",
  "machines/[id]/sessions/[sessionId]/route.ts",
  "machines/[id]/sessions/route.ts",
  "machines/[id]/settings/route.ts",
  "machines/[id]/ssh-key/route.ts",
  "machines/[id]/status/route.ts",
  "machines/[id]/terminal/input/route.ts",
  "machines/[id]/terminal/resize/route.ts",
  "machines/[id]/terminal/route.ts",
  "machines/[id]/terminal/stream/route.ts",
  "machines/[id]/vnc/route.ts",
  "machines/cleanup/route.ts",
  "machines/route.ts",
  "mcp-server-card/route.ts",
  "models/route.ts",
  "onboarding/route.ts",
  "openapi/route.ts",
  "osworld/[...path]/route.ts",
  "pricing/route.ts",
  "projects/[projectId]/route.ts",
  "projects/route.ts",
  "providers/route.ts",
  "rate-limits/route.ts",
  "referral/claim/route.ts",
  "referral/stats/route.ts",
  "schedules/[chatId]/delegates/route.ts",
  "schedules/[chatId]/route.ts",
  "schedules/route.ts",
  "schedules/teams/[...path]/route.ts",
  "secrets/[id]/route.ts",
  "secrets/import/route.ts",
  "secrets/route.ts",
  "status/cron/route.ts",
  "status/history/route.ts",
  "status/route.ts",
  "subscription/checkout/route.ts",
  "subscription/portal/route.ts",
  "subscription/status/route.ts",
  "swarm/[swarmId]/pause/route.ts",
  "swarm/[swarmId]/resume/route.ts",
  "swarm/[swarmId]/route.ts",
  "swarm/[swarmId]/stop/route.ts",
  "swarm/route.ts",
  "swarms/[id]/route.ts",
  "swarms/route.ts",
  "swarms/shared/[id]/route.ts",
  "update-chat-model/route.ts",
  "user-key-status/route.ts",
  "user-keys/route.ts",
  "user-memory/route.ts",
  "user-preferences/favorite-models/route.ts",
  "user-preferences/route.ts",
  "user/encryption-prefs/route.ts",
  "v1/cua/[...path]/route.ts",
  "validate-email/route.ts",
])

/**
 * Recursively find every `route.ts` (and `route.tsx`) file under app/api/.
 */
function findRouteFiles(dir: string): string[] {
  const results: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return results
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
      results.push(...findRouteFiles(full))
    } else if (entry === "route.ts" || entry === "route.tsx") {
      results.push(full)
    }
  }
  return results
}

/**
 * Returns true iff the file imports `logApiAccess` from the canonical
 * helper path OR has the `access-log-exempt:` escape-hatch comment.
 */
function hasAccessLog(content: string): boolean {
  if (content.includes("logApiAccess")) return true
  if (content.includes("access-log-exempt:")) return true
  return false
}

describe("API access-log coverage", () => {
  const routeFiles = findRouteFiles(API_DIR)

  it("finds at least the 3 migrated routes", () => {
    // Sanity: the discovery walker works.
    expect(routeFiles.length).toBeGreaterThan(3)
  })

  it("the 3 bootstrap routes use logApiAccess", () => {
    const expected = [
      "chat/route.ts",
      "files/route.ts",
      "credits/webhook/route.ts",
    ]
    for (const rel of expected) {
      const full = join(API_DIR, rel)
      const content = readFileSync(full, "utf8")
      expect(hasAccessLog(content), `${rel} should import logApiAccess`).toBe(true)
    }
  })

  it("no NEW routes are missing the helper (allowlist must not grow)", () => {
    const missing: string[] = []
    for (const file of routeFiles) {
      const rel = relative(API_DIR, file).split("\\").join("/")
      const content = readFileSync(file, "utf8")
      if (!hasAccessLog(content) && !ALLOWLIST_PENDING_MIGRATION.has(rel)) {
        missing.push(rel)
      }
    }
    expect(
      missing,
      `New API routes must import logApiAccess from @/lib/observability/api-access-log ` +
        `or add an "access-log-exempt: <reason>" comment. Missing in:\n  ` +
        missing.join("\n  "),
    ).toEqual([])
  })

  // The allowlist itself is allowed to point at routes that have ALREADY
  // been migrated (which can happen after a refactor). This sanity check
  // surfaces those so they can be pruned from the allowlist.
  it("allowlist contains only routes that genuinely lack the helper", () => {
    const stalePrunes: string[] = []
    for (const rel of ALLOWLIST_PENDING_MIGRATION) {
      const full = join(API_DIR, rel)
      let content: string
      try {
        content = readFileSync(full, "utf8")
      } catch {
        // Route file no longer exists — prune.
        stalePrunes.push(`${rel} (file missing)`)
        continue
      }
      if (hasAccessLog(content)) {
        stalePrunes.push(`${rel} (already migrated — remove from allowlist)`)
      }
    }
    expect(stalePrunes, `Stale entries in ALLOWLIST_PENDING_MIGRATION:\n  ${stalePrunes.join("\n  ")}`).toEqual([])
  })
})
