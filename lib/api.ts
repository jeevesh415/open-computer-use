  import { APP_DOMAIN } from "@/lib/config"
import { SupabaseClient } from "@supabase/supabase-js"
import { fetchClient } from "./fetch"
import { API_ROUTE_UPDATE_CHAT_MODEL } from "./routes"

export class UsageLimitError extends Error {
  code: string
  constructor(message: string) {
    super(message)
    this.code = "DAILY_LIMIT_REACHED"
  }
}

/**
 * Checks the authenticated user's daily usage.
 * userId is derived server-side from the session cookie.
 */
export async function checkRateLimits() {
  try {
    const res = await fetchClient(
      `/api/rate-limits`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      }
    )
    const responseData = await res.json()
    if (!res.ok) {
      throw new Error(
        responseData.error ||
          `Failed to check rate limits: ${res.status} ${res.statusText}`
      )
    }
    return responseData
  } catch (err) {
    throw err
  }
}

/**
 * Updates the model for an existing chat
 */
export async function updateChatModel(chatId: string, model: string) {
  try {
    const res = await fetchClient(API_ROUTE_UPDATE_CHAT_MODEL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, model }),
    })
    const responseData = await res.json()

    if (!res.ok) {
      throw new Error(
        responseData.error ||
          `Failed to update chat model: ${res.status} ${res.statusText}`
      )
    }

    return responseData
  } catch (error) {
    // Error updating chat model
    throw error
  }
}

/**
 * Signs up a new user with email and password.
 * Requires email confirmation before the user can sign in.
 */
export async function signUpWithEmail(
  supabase: SupabaseClient,
  email: string,
  password: string
) {
  const isDev = process.env.NODE_ENV === "development"
  const baseUrl = isDev
    ? "http://localhost:3000"
    : typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_VERCEL_URL
        ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
        : APP_DOMAIN

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${baseUrl}/auth/callback`,
    },
  })

  if (error) throw error
  return data
}

/**
 * Signs in user with email and password
 */
export async function signInWithEmail(
  supabase: SupabaseClient,
  email: string,
  password: string
) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) throw error
  return data
}

/**
 * Sends a magic link to the user's email for passwordless sign-in
 */
export async function signInWithMagicLink(
  supabase: SupabaseClient,
  email: string
) {
  const isDev = process.env.NODE_ENV === "development"
  const baseUrl = isDev
    ? "http://localhost:3000"
    : typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_VERCEL_URL
        ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
        : APP_DOMAIN

  const { data, error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${baseUrl}/auth/callback`,
      shouldCreateUser: false,
    },
  })

  if (error) {
    // SECURITY (P1-02): When `shouldCreateUser: false` is set and the email
    // is not registered, Supabase returns "Signups not allowed for otp".
    // Surfacing that distinct error to the client is an account-enumeration
    // leak. Swallow it and return success-shaped data so the UI displays the
    // same "check your email" affordance regardless of whether the account
    // exists. All other errors continue to throw.
    if (error.message?.toLowerCase().includes("signups not allowed")) {
      return { user: null, session: null }
    }
    throw error
  }
  return data
}

/**
 * Sends a password reset email
 */
export async function resetPassword(
  supabase: SupabaseClient,
  email: string
) {
  const isDev = process.env.NODE_ENV === "development"
  const baseUrl = isDev
    ? "http://localhost:3000"
    : typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_VERCEL_URL
        ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
        : APP_DOMAIN

  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${baseUrl}/auth/reset-password`,
  })

  if (error) throw error
  return data
}

/**
 * Signs in user with Google OAuth via Supabase
 */
export async function signInWithGoogle(supabase: SupabaseClient) {
  try {
    const isDev = process.env.NODE_ENV === "development"

    // Get base URL dynamically (will work in both browser and server environments)
    const baseUrl = isDev
      ? "http://localhost:3000"
      : typeof window !== "undefined"
        ? window.location.origin
        : process.env.NEXT_PUBLIC_VERCEL_URL
          ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
          : APP_DOMAIN

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${baseUrl}/auth/callback`,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
        // You can optionally specify a custom auth URL if you have a custom domain
        // authUrl: process.env.NEXT_PUBLIC_SUPABASE_AUTH_URL || undefined,
      },
    })

    if (error) {
      throw error
    }

    // Return the provider URL
    return data
  } catch (err) {
    // Error signing in with Google
    throw err
  }
}

