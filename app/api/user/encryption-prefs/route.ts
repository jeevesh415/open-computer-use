import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

/**
 * Per-user encryption preferences read/write.
 *
 * GET  /api/user/encryption-prefs → { prefs, available, encryption_key_configured, notes }
 * PUT  /api/user/encryption-prefs   body: { prefs: Partial<Record<Category, boolean>> }
 *                                  → echoes the persisted prefs after merge
 *
 * Reads/writes ``public.users.encryption_prefs`` (JSONB, default `{}`). The
 * column is keyed by category — keep this list in sync with
 * ``backend/app/utils/encryption_prefs.py:KNOWN_CATEGORIES`` and the toggle
 * grid in ``app/components/layout/settings/general/data-section.tsx``.
 *
 * Categories table:
 *   - `screenshots` — backend filesystem screenshots (wired today)
 *   - `messages`    — chat message content (reserved, not yet wired)
 *   - `tool_calls`  — tool args/results (reserved, not yet wired)
 *   - `memory`      — users.system_prompt (reserved, not yet wired)
 *
 * When a category is marked `available: true` below, the backend honors the
 * toggle on write. Reserved categories accept toggles (so we can persist
 * intent today) but do not yet drive any actual encryption.
 *
 * Cache note: the FastAPI worker caches per-user prefs for 60 s. A PUT here
 * takes effect for *new* writes within that window; we do not synchronously
 * invalidate the backend cache. UI surface acknowledges this lag.
 */

type Category = "screenshots" | "messages" | "tool_calls" | "memory"

const ALL_CATEGORIES: readonly Category[] = [
  "screenshots",
  "messages",
  "tool_calls",
  "memory",
] as const

// Only `screenshots` is plumbed end-to-end today. The others persist the
// user's preference but the backend doesn't yet act on them — keep the UI
// honest by tagging which is which.
const WIRED_CATEGORIES: ReadonlySet<Category> = new Set<Category>(["screenshots"])

type Prefs = Record<Category, boolean>

function defaultsAllOff(): Prefs {
  return {
    screenshots: false,
    messages: false,
    tool_calls: false,
    memory: false,
  }
}

function normalize(raw: unknown): Prefs {
  const out = defaultsAllOff()
  if (raw && typeof raw === "object") {
    for (const cat of ALL_CATEGORIES) {
      const v = (raw as Record<string, unknown>)[cat]
      if (typeof v === "boolean") out[cat] = v
    }
  }
  return out
}

function buildAvailability() {
  return ALL_CATEGORIES.map((cat) => ({
    id: cat,
    wired: WIRED_CATEGORIES.has(cat),
  }))
}

function encryptionKeyConfigured(): boolean {
  // ENCRYPTION_KEY is set in both Next.js and the FastAPI backend envs. We
  // surface its presence so the UI can warn users who toggle ON in a
  // deployment that doesn't actually have a key set ("opt-in is a no-op").
  return Boolean(process.env.ENCRYPTION_KEY)
}

export async function GET() {
  const supabase = await createClient()
  if (!supabase) {
    return NextResponse.json(
      { error: "Database connection failed" },
      { status: 500 }
    )
  }
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data, error } = await supabase
    .from("users")
    .select("encryption_prefs")
    .eq("id", user.id)
    .single()

  // First-login user without a users row yet → treat as all-off.
  let prefs: Prefs
  if (error && error.code !== "PGRST116") {
    console.error("encryption-prefs GET error:", error)
    return NextResponse.json(
      { error: "Server error occurred" },
      { status: 500 }
    )
  }
  prefs = normalize(data?.encryption_prefs)

  return NextResponse.json({
    prefs,
    available: buildAvailability(),
    encryption_key_configured: encryptionKeyConfigured(),
    // 60s = the backend's TTL cache window on the prefs read.
    propagation_delay_seconds: 60,
  })
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient()
  if (!supabase) {
    return NextResponse.json(
      { error: "Database connection failed" },
      { status: 500 }
    )
  }
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const requestedPatch = normalize(body?.prefs)

  // Merge against current value so a PUT with only `{ screenshots: true }`
  // doesn't accidentally zero the other categories.
  const { data: current } = await supabase
    .from("users")
    .select("encryption_prefs")
    .eq("id", user.id)
    .single()
  const merged: Prefs = { ...normalize(current?.encryption_prefs) }
  if (body && body.prefs && typeof body.prefs === "object") {
    for (const cat of ALL_CATEGORIES) {
      const v = (body.prefs as Record<string, unknown>)[cat]
      if (typeof v === "boolean") merged[cat] = v
    }
  } else {
    // No body — overwrite with normalized payload (all-off baseline).
    Object.assign(merged, requestedPatch)
  }

  // Update + .select() returns the affected rows. If the user has no
  // public.users row yet (auth.users trigger didn't fire for whatever
  // reason — corrupted signup, dev DB without migration 018, etc.), an
  // .update() against zero rows silently succeeds and we'd lie to the user
  // about persistence. Asserting on the returned row count catches this.
  const { data: updatedRows, error: updateError } = await supabase
    .from("users")
    .update({ encryption_prefs: merged })
    .eq("id", user.id)
    .select("encryption_prefs")

  if (updateError) {
    console.error("encryption-prefs PUT error:", updateError)
    return NextResponse.json(
      { error: "Server error occurred" },
      { status: 500 }
    )
  }

  if (!updatedRows || updatedRows.length === 0) {
    // No public.users row exists. The auth.users → public.users mirror
    // trigger (migration 018) should have created it on signup, so this
    // is a real anomaly worth telling the user about. We don't try to
    // INSERT here because the users table has other NOT NULL columns
    // (email etc.) that we can't synthesize from this context.
    console.error(
      "encryption-prefs PUT: no public.users row for authenticated user",
      user.id
    )
    return NextResponse.json(
      {
        error:
          "Your profile is not yet provisioned in the public schema. " +
          "Try signing out and back in, or contact support if this persists.",
      },
      { status: 409 }
    )
  }

  // Audit log — encryption-pref changes are rare and audit-worthy.
  console.info(
    `encryption-prefs PUT user=${user.id} new=${JSON.stringify(merged)}`
  )

  // Fire-and-forget: tell the FastAPI workers to drop their 60s TTL cache
  // for this user so the toggle takes effect on the very next write,
  // not after a minute. Best-effort — if the backend is unreachable we just
  // fall back to the natural TTL expiry. We don't await this; it must not
  // block the user's response.
  void invalidateBackendCache(user.id)

  return NextResponse.json({
    prefs: merged,
    available: buildAvailability(),
    encryption_key_configured: encryptionKeyConfigured(),
    propagation_delay_seconds: 60,
  })
}

const PYTHON_BACKEND_URL =
  process.env.PYTHON_BACKEND_URL || "http://127.0.0.1:8001"
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || ""

async function invalidateBackendCache(userId: string): Promise<void> {
  try {
    // Backend mounts the `internal` router at root (prefix=""), so the
    // endpoint sits at /internal/* — not under /api/. Matches the existing
    // /internal/memstats path in app/api/routes/internal.py.
    //
    // Headers follow the canonical proxy pattern enforced by
    // tests/lib/proxy-headers-audit.test.ts: every backend fetch from a
    // Next.js route forwards BOTH X-Internal-Key AND X-User-ID so the
    // backend's CSRFMiddleware skip path fires. The endpoint also reads
    // user_id from the body (used for cache invalidation, not auth) — both
    // identify the same user, the header satisfies the middleware contract
    // and the body satisfies the route handler.
    await fetch(
      `${PYTHON_BACKEND_URL}/internal/encryption-prefs/invalidate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-ID": userId,
          ...(INTERNAL_API_KEY && { "X-Internal-Key": INTERNAL_API_KEY }),
        },
        body: JSON.stringify({ user_id: userId }),
        // Short timeout — if the backend is slow we shouldn't keep the user waiting.
        signal: AbortSignal.timeout(2000),
      }
    )
  } catch (e) {
    // Tolerated failure mode — the 60s TTL will pick up the change shortly.
    console.warn(
      "encryption-prefs backend cache invalidate failed (non-fatal):",
      e instanceof Error ? e.message : e
    )
  }
}
