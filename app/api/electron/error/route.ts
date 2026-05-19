/**
 * Next.js proxy for Electron's HTTP error-reporter fallback.
 *
 * Why this route exists
 * ---------------------
 * `electron/src/main/error-reporter.ts` prefers shipping error reports over
 * the WebSocket bridge. When the WS is closed — exactly the moment most
 * worth reporting — the reporter queues reports and POSTs them in batches
 * to `${backendUrl}/api/electron/error` with `Authorization: Bearer <jwt>`.
 *
 * The FastAPI backend implements `POST /api/electron/error` (see
 * `backend/app/api/routes/electron_bridge.py` line ~911), but Next.js had
 * no proxy route for it — every HTTP fallback report silently 404'd
 * because the reporter swallows failures with `.catch(() => null)`.
 *
 * Symptom in prod: zero `electron_bridge.error_report` log entries in
 * CloudWatch from HTTP fallback, even though WS outages are well-attested.
 * Reports during WS-down windows were lost.
 *
 * Auth: same two-step pattern as `chat/route.ts` and
 * `chat/resume-human/[machineId]/route.ts`. Electron always sends Bearer
 * (it has no cookie jar); the cookie path is kept so the route is
 * symmetrically callable from a logged-in browser if we ever need a
 * debug-shaped UI page that POSTs synthetic reports.
 */
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { verifyBearerToken } from "@/lib/supabase/bearer-auth"

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || "http://127.0.0.1:8001"
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || ""

export async function POST(req: NextRequest) {
  try {
    let userId: string | null = null

    const supabase = await createClient()
    if (supabase) {
      const { data: authData, error: authError } = await supabase.auth.getUser()
      if (!authError && authData?.user) {
        userId = authData.user.id
      }
    }

    if (!userId) {
      const bearer = await verifyBearerToken(req)
      if (bearer.user) {
        userId = bearer.user.id
      }
    }

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Read the body as JSON. The FastAPI side expects `{reports: [...]}`
    // with a 200-entry cap; we don't enforce it here — the backend does
    // (413 on overflow) and we just passthrough so client retry logic
    // (exponential backoff in error-reporter.ts) sees the correct status.
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "Body must be JSON" }, { status: 400 })
    }

    const response = await fetch(`${PYTHON_BACKEND_URL}/api/electron/error`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-ID": userId,
        ...(INTERNAL_API_KEY && { "X-Internal-Key": INTERNAL_API_KEY }),
      },
      body: JSON.stringify(body),
    })

    // Propagate the backend's status verbatim. The error-reporter uses
    // `res.ok` to decide drop-vs-retry, so a 5xx must surface as 5xx and
    // a 413 must surface as 413 — flattening to "200 with error body"
    // would make the client retry indefinitely.
    const data = await response.json().catch(() => ({}))
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error("Error proxying Electron error report:", error)
    return NextResponse.json(
      { error: "Failed to forward error report" },
      { status: 503 },
    )
  }
}
