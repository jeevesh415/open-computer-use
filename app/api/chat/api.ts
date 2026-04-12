import { saveFinalAssistantMessage } from "@/app/api/chat/db"
import type {
  ChatApiParams,
  LogUserMessageParams,
  StoreAssistantMessageParams,
  SupabaseClientType,
} from "@/app/types/api.types"
import { FREE_MODELS_IDS } from "@/lib/config"
import { getProviderForModel } from "@/lib/openproviders/provider-map"
import { sanitizeUserInput } from "@/lib/sanitize"
import { validateUserIdentity } from "@/lib/server/api"
import { checkUsageByModel, incrementUsage } from "@/lib/usage"
import { getUserKey, type Provider } from "@/lib/user-keys"

export async function validateAndTrackUsage({
  userId,
  model,
  isAuthenticated,
}: ChatApiParams): Promise<SupabaseClientType | null> {
  const supabase = await validateUserIdentity(userId)
  if (!supabase) return null

  // Check API key requirements for non-free models
  const provider = getProviderForModel(model)
  const userApiKey = await getUserKey(userId, provider)

  if (!userApiKey && !FREE_MODELS_IDS.includes(model)) {
    throw new Error(
      `This model requires an API key for ${provider}. Please add your API key in settings or use a free model.`
    )
  }

  // Check usage limits for the model
  await checkUsageByModel(supabase, userId, model)

  return supabase as any
}

export async function incrementMessageCount({
  supabase,
  userId,
}: {
  supabase: SupabaseClientType
  userId: string
}): Promise<void> {
  if (!supabase) return

  try {
    await incrementUsage(supabase, userId)
  } catch (err) {
    console.error("Failed to increment message count:", err)
    // Don't throw error as this shouldn't block the chat
  }
}

export async function logUserMessage({
  supabase,
  userId,
  chatId,
  content,
  attachments,
  model,
  isAuthenticated,
  message_group_id,
}: LogUserMessageParams): Promise<void> {
  if (!supabase) return

  const { error } = await supabase.from("messages").insert({
    chat_id: chatId,
    role: "user",
    content: sanitizeUserInput(content),
    experimental_attachments: attachments,
    user_id: userId,
    message_group_id,
  })

  if (error) {
    console.error("Error saving user message:", error)
  }
}

export async function storeAssistantMessage({
  supabase,
  chatId,
  messages,
  message_group_id,
  model,
}: StoreAssistantMessageParams): Promise<void> {
  if (!supabase) return
  try {
    await saveFinalAssistantMessage(
      supabase,
      chatId,
      messages,
      message_group_id,
      model
    )
  } catch (err) {
    console.error("Failed to save assistant messages:", err)
  }
}
