import { createServerClient } from "@supabase/ssr"
import { isSupabaseEnabled } from "./config"

/**
 * Creates a Supabase client with the service role key.
 * Bypasses Row Level Security — use only in trusted server-side contexts
 * (admin operations, cross-user lookups, webhooks, etc.).
 */
export async function createServiceClient(): Promise<any> {
  if (!isSupabaseEnabled) {
    return null
  }

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE!,
    {
      cookies: {
        getAll: () => [],
        setAll: () => {},
      },
    }
  )
}
