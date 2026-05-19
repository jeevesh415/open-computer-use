/**
 * Server-side messages fetch with screenshot decryption.
 *
 * GET /api/chats/:chatId/messages → { messages: Message[] }
 *
 * Why this exists
 * ---------------
 * `frontendScreenshot` values inside `messages.parts` are now optionally
 * AES-256-GCM ciphertext (sentinel `enc:v1:...`) when the user has opted in
 * to ``users.encryption_prefs.messages``. Decrypting them requires the
 * `ENCRYPTION_KEY` — which must NEVER ship to the browser. So this route
 * is the chokepoint that does the decrypt server-side and returns plaintext
 * to the client.
 *
 * The previous client-side direct-Supabase fetch in
 * `lib/chat-store/messages/api.ts:getMessagesFromDb` now points at this
 * route. RLS still applies (we use the server-side Supabase client with the
 * user's session cookie), so the security boundary is unchanged — we've
 * just moved the read from "browser → Supabase" to "browser → Next.js →
 * Supabase" so a decryption step can sit in the middle.
 *
 * Collaborative chats are still handled by the existing
 * `/api/collaborative-rooms/[roomId]/messages` route (which also does the
 * decryption). This route is only for the standard non-collaborative path.
 */
import { createClient } from "@/lib/supabase/server"
import { createClient as createSupabaseClient, SupabaseClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"
import { decryptScreenshotsInMessages } from "@/lib/screenshot-encryption"
import { verifyBearerToken } from "@/lib/supabase/bearer-auth"

export const dynamic = "force-dynamic"

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await context.params
  if (!chatId) {
    return NextResponse.json({ error: "Missing chatId" }, { status: 400 })
  }

  // ── Auth resolution ──────────────────────────────────────────────────
  // Two paths reach this route:
  //   1. Web app — Supabase session in cookies. `createClient()` returns a
  //      server client wired to those cookies; `getUser()` validates and
  //      returns the user.
  //   2. Electron desktop — `Authorization: Bearer <jwt>` header. No cookies
  //      because Electron's fetch isn't tied to a browser session. We
  //      stateless-verify the JWT via `verifyBearerToken` and then build a
  //      Bearer-authenticated Supabase client so subsequent RLS checks see
  //      the user.
  //
  // Without the Bearer fallback, every Electron call to this route 401s
  // (the symptom that broke "click history → load chat" in the desktop
  // app — RLS is fine, the cookie-based getUser() just returns null).
  let userId: string | null = null
  let supabase: SupabaseClient | null = null

  const cookieClient = await createClient()
  if (cookieClient) {
    const { data: cookieAuth, error: cookieErr } = await cookieClient.auth.getUser()
    if (!cookieErr && cookieAuth?.user) {
      userId = cookieAuth.user.id
      supabase = cookieClient
    }
  }

  if (!userId) {
    const bearer = await verifyBearerToken(req)
    if (bearer.user) {
      userId = bearer.user.id
      // Build a Supabase client that carries the Bearer token on every
      // outgoing request — needed so RLS on `messages` evaluates the
      // policies against THIS user, not anon.
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      if (supabaseUrl && supabaseAnonKey) {
        const authHeader = req.headers.get("Authorization") || ""
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""
        supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
          auth: { autoRefreshToken: false, persistSession: false },
          global: { headers: { Authorization: `Bearer ${token}` } },
        })
      }
    }
  }

  if (!userId || !supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Fetch — RLS on public.messages restricts to chats owned by the caller,
  // so a foreign chatId comes back as an empty array.
  const { data: rawMessages, error } = await supabase
    .from("messages")
    .select("*")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true })

  if (error) {
    console.error(`/api/chats/${chatId}/messages fetch error:`, error)
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    )
  }

  // Decrypt any encrypted frontendScreenshot values inside the JSONB parts.
  // Plaintext messages pass through unchanged; decryption failures (wrong
  // key, tampered bytes) drop the screenshot rather than render a broken
  // image. See lib/screenshot-encryption.ts for the contract.
  const messages = decryptScreenshotsInMessages(rawMessages || [])

  return NextResponse.json({ messages })
}
