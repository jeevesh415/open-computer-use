import { UsageLimitError } from "@/lib/api"
import {
  AUTH_DAILY_MESSAGE_LIMIT,
  DAILY_LIMIT_PRO_MODELS,
  FREE_MODELS_IDS,
} from "@/lib/config"
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = any

const isFreeModel = (modelId: string) => FREE_MODELS_IDS.includes(modelId)
const isProModel = (modelId: string) => !isFreeModel(modelId)

/**
 * Checks the authenticated user's daily usage to see if they've reached their limit.
 */
export async function checkUsage(supabase: AnySupabaseClient, userId: string) {
  const { data: userData, error: userDataError } = await supabase
    .from("users")
    .select(
      "message_count, daily_message_count, daily_reset, premium"
    )
    .eq("id", userId)
    .maybeSingle()

  if (userDataError) {
    throw new Error("Error fetching user data: " + userDataError.message)
  }
  if (!userData) {
    throw new Error("User record not found for id: " + userId)
  }

  const dailyLimit = AUTH_DAILY_MESSAGE_LIMIT

  // Reset the daily counter if the day has changed (using UTC).
  const now = new Date()
  let dailyCount = userData.daily_message_count || 0
  const lastReset = userData.daily_reset ? new Date(userData.daily_reset) : null

  const isNewDay =
    !lastReset ||
    now.getUTCFullYear() !== lastReset.getUTCFullYear() ||
    now.getUTCMonth() !== lastReset.getUTCMonth() ||
    now.getUTCDate() !== lastReset.getUTCDate()

  if (isNewDay) {
    dailyCount = 0
    const { error: resetError } = await supabase
      .from("users")
      .update({ daily_message_count: 0, daily_reset: now.toISOString() })
      .eq("id", userId)

    if (resetError) {
      throw new Error("Failed to reset daily count: " + resetError.message)
    }
  }

  // Check if the daily limit is reached.
  if (dailyCount >= dailyLimit) {
    throw new UsageLimitError("Daily message limit reached.")
  }

  return {
    userData,
    dailyCount,
    dailyLimit,
  }
}

/**
 * Increments both overall and daily message counters for a user.
 *
 * @param supabase - Your Supabase client.
 * @param userId - The ID of the user.
 * @param currentCounts - Current message counts (optional, will be fetchCliented if not provided)
 * @param trackDaily - Whether to track the daily message count (default is true)
 * @throws Error if updating fails.
 */
export async function incrementUsage(
  supabase: AnySupabaseClient,
  userId: string
): Promise<void> {
  const { data: userData, error: userDataError } = await supabase
    .from("users")
    .select("message_count, daily_message_count")
    .eq("id", userId)
    .maybeSingle()

  if (userDataError || !userData) {
    throw new Error(
      "Error fetchClienting user data: " +
        (userDataError?.message || "User not found")
    )
  }

  const messageCount = userData.message_count || 0
  const dailyCount = userData.daily_message_count || 0

  // Increment both overall and daily message counts.
  const newOverallCount = messageCount + 1
  const newDailyCount = dailyCount + 1

  const { error: updateError } = await supabase
    .from("users")
    .update({
      message_count: newOverallCount,
      daily_message_count: newDailyCount,
      last_active_at: new Date().toISOString(),
    })
    .eq("id", userId)

  if (updateError) {
    throw new Error("Failed to update usage data: " + updateError.message)
  }
}

export async function checkProUsage(supabase: AnySupabaseClient, userId: string) {
  const { data: userData, error: userDataError } = await supabase
    .from("users")
    .select("daily_pro_message_count, daily_pro_reset")
    .eq("id", userId)
    .maybeSingle()

  if (userDataError) {
    throw new Error("Error fetching user data: " + userDataError.message)
  }
  if (!userData) {
    throw new Error("User not found for ID: " + userId)
  }

  let dailyProCount = userData.daily_pro_message_count || 0
  const now = new Date()
  const lastReset = userData.daily_pro_reset
    ? new Date(userData.daily_pro_reset)
    : null

  const isNewDay =
    !lastReset ||
    now.getUTCFullYear() !== lastReset.getUTCFullYear() ||
    now.getUTCMonth() !== lastReset.getUTCMonth() ||
    now.getUTCDate() !== lastReset.getUTCDate()

  if (isNewDay) {
    dailyProCount = 0
    const { error: resetError } = await supabase
      .from("users")
      .update({
        daily_pro_message_count: 0,
        daily_pro_reset: now.toISOString(),
      })
      .eq("id", userId)

    if (resetError) {
      throw new Error("Failed to reset pro usage: " + resetError.message)
    }
  }

  if (dailyProCount >= DAILY_LIMIT_PRO_MODELS) {
    throw new UsageLimitError("Daily Pro model limit reached.")
  }

  return {
    dailyProCount,
    limit: DAILY_LIMIT_PRO_MODELS,
  }
}

export async function incrementProUsage(
  supabase: AnySupabaseClient,
  userId: string
) {
  const { data, error } = await supabase
    .from("users")
    .select("daily_pro_message_count")
    .eq("id", userId)
    .maybeSingle()

  if (error || !data) {
    throw new Error("Failed to fetch user usage for increment")
  }

  const count = data.daily_pro_message_count || 0

  const { error: updateError } = await supabase
    .from("users")
    .update({
      daily_pro_message_count: count + 1,
      last_active_at: new Date().toISOString(),
    })
    .eq("id", userId)

  if (updateError) {
    throw new Error("Failed to increment pro usage: " + updateError.message)
  }
}

export async function checkUsageByModel(
  supabase: AnySupabaseClient,
  userId: string,
  modelId: string
) {
  if (isProModel(modelId)) {
    return await checkProUsage(supabase, userId)
  }
  return await checkUsage(supabase, userId)
}

export async function incrementUsageByModel(
  supabase: AnySupabaseClient,
  userId: string,
  modelId: string
) {
  if (isProModel(modelId)) {
    return await incrementProUsage(supabase, userId)
  }
  return await incrementUsage(supabase, userId)
}
