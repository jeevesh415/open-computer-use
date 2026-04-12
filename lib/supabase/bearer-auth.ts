/**
 * Verify a Supabase Bearer token from Electron desktop app requests.
 *
 * Next.js API routes normally authenticate via cookies (server.ts createClient).
 * The Electron app sends an Authorization: Bearer <jwt> header instead.
 * This helper validates that JWT against Supabase and returns the user.
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { NextRequest } from "next/server"

interface BearerAuthResult {
  user: { id: string; email?: string } | null
  error: string | null
}

/**
 * Extract and verify a Bearer token from the request's Authorization header.
 * Returns the authenticated user if valid, or an error string if not.
 */
export async function verifyBearerToken(req: NextRequest): Promise<BearerAuthResult> {
  const authHeader = req.headers.get("Authorization") || ""
  if (!authHeader.startsWith("Bearer ")) {
    return { user: null, error: "Missing Bearer token" }
  }

  const token = authHeader.slice(7)
  if (!token) {
    return { user: null, error: "Empty Bearer token" }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return { user: null, error: "Supabase not configured" }
  }

  try {
    // Create a stateless client and verify the token by calling getUser()
    const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })

    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data?.user) {
      return { user: null, error: "Invalid or expired token" }
    }

    return { user: { id: data.user.id, email: data.user.email }, error: null }
  } catch {
    return { user: null, error: "Token verification failed" }
  }
}
