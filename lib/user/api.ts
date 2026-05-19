import { isSupabaseEnabled } from "@/lib/supabase/config"
import { createClient } from "@/lib/supabase/server"
import { hashApiKeyToUserId } from "@/lib/auth/current-identity"
import { getCoastyApiKey, isOssMode } from "@/lib/oss-mode"
import {
  convertFromApiFormat,
  defaultPreferences,
} from "@/lib/user-preference-store/utils"
import type { UserProfile } from "./types"

export async function getSupabaseUser() {
  const supabase = await createClient()
  if (!supabase) return { supabase: null, user: null }

  const { data } = await supabase.auth.getUser()
  return {
    supabase,
    user: data.user ?? null,
  }
}

export async function getUserProfile(): Promise<UserProfile | null> {
  // OSS mode: synthesize a profile keyed by sha256(COASTY_API_KEY) so the
  // chat-store / preferences / messages caches stay coherent across reloads
  // without leaking the raw key. Must short-circuit BEFORE any Supabase
  // call because OSS deployments don't have a Supabase project at all.
  if (isOssMode()) {
    const key = getCoastyApiKey()
    if (!key) return null
    return {
      id: hashApiKeyToUserId(key),
      // DB type requires `string` (not null) — use empty string as a
      // non-PII placeholder. The UI hides email-edit surfaces when
      // `anonymous` is true.
      email: "",
      display_name: "Coasty user",
      profile_image: "",
      anonymous: true,
      preferences: defaultPreferences,
    } as UserProfile
  }

  if (!isSupabaseEnabled) {
    // return fake user profile for no supabase
    return {
      id: "guest",
      email: "guest@coasty.ai",
      display_name: "Guest",
      profile_image: "",
      anonymous: true,
      preferences: defaultPreferences,
    } as UserProfile
  }

  const { supabase, user } = await getSupabaseUser()
  if (!supabase || !user) return null

  const { data: userProfileData } = await supabase
    .from("users")
    .select("*, user_preferences(*)")
    .eq("id", user.id)
    .single()

  // Format user preferences if they exist
  const formattedPreferences = userProfileData?.user_preferences
    ? convertFromApiFormat(userProfileData.user_preferences)
    : undefined

  return {
    ...userProfileData,
    profile_image: user.user_metadata?.avatar_url ?? "",
    display_name: user.user_metadata?.name ?? "",
    preferences: formattedPreferences,
  } as UserProfile
}
