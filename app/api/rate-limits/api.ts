import {
  AUTH_DAILY_MESSAGE_LIMIT,
  DAILY_LIMIT_PRO_MODELS,
} from "@/lib/config"
import { validateUserIdentity } from "@/lib/server/api"

export async function getMessageUsage(userId: string) {
  const supabase = await validateUserIdentity(userId)
  if (!supabase) return null

  const { data, error } = await supabase
    .from("users")
    .select("daily_message_count, daily_pro_message_count")
    .eq("id", userId)
    .maybeSingle()

  if (error || !data) {
    throw new Error(error?.message || "Failed to fetch message usage")
  }

  const dailyLimit = AUTH_DAILY_MESSAGE_LIMIT
  const dailyCount = data.daily_message_count || 0
  const dailyProCount = data.daily_pro_message_count || 0

  return {
    dailyCount,
    dailyProCount,
    dailyLimit,
    remaining: dailyLimit - dailyCount,
    remainingPro: DAILY_LIMIT_PRO_MODELS - dailyProCount,
  }
}
