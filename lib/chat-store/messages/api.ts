import { createClient } from "@/lib/supabase/client"
import { isSupabaseEnabled } from "@/lib/supabase/config"
import type { Message as MessageAISDK } from "ai"
import { readFromIndexedDB, writeToIndexedDB } from "../persist"

export async function getMessagesFromDb(
  chatId: string
): Promise<MessageAISDK[]> {
  // fallback to local cache only
  if (!isSupabaseEnabled) {
    const cached = await getCachedMessages(chatId)
    return cached
  }

  const supabase = createClient()
  if (!supabase) return []

  // Check if this is a collaborative room
  const { data: chatData } = await supabase
    .from("chats")
    .select("collaborative")
    .eq("id", chatId)
    .single()

  const isCollaborative = chatData?.collaborative === true

  // For collaborative rooms, use the enhanced API endpoint
  if (isCollaborative) {
    try {
      const response = await fetch(`/api/collaborative-rooms/${chatId}/messages`)
      if (response.ok) {
        const { messages } = await response.json()
        const formattedMessages = messages.map((message: any) => ({
          id: String(message.id),
          content: message.content ?? "",
          role: message.role,
          createdAt: new Date(message.created_at || ""),
          experimental_attachments: message.experimental_attachments,
          parts: (message?.parts as MessageAISDK["parts"]) || undefined,
          message_group_id: message.message_group_id,
          model: message.model,
          user_id: message.user_id,
          users: message.users || undefined,
        } as MessageAISDK & { user_id?: string; users?: any }))

        // Update cache with latest messages
        await cacheMessages(chatId, formattedMessages)
        return formattedMessages
      }
    } catch (error) {
      console.warn("Error fetching enhanced messages, falling back to standard fetch:", error)
    }
  }

  // Standard fetch for non-collaborative rooms. Goes through the Next.js
  // server route at /api/chats/:chatId/messages instead of directly hitting
  // Supabase, so that:
  //   - `frontendScreenshot` values encrypted under users.encryption_prefs.messages
  //     can be decrypted SERVER-SIDE (the ENCRYPTION_KEY must never ship to
  //     the browser — that's a critical security boundary).
  //   - Future read-time transformations (redaction, signed URLs, etc.) have a
  //     single chokepoint.
  // RLS still applies because the server route uses the user's session.
  try {
    const response = await fetch(`/api/chats/${chatId}/messages`, {
      cache: "no-store",
      credentials: "include",
    })
    if (!response.ok) {
      console.error(
        `Failed to fetch messages from /api/chats/${chatId}/messages:`,
        response.status
      )
      const cached = await getCachedMessages(chatId)
      return cached
    }
    const { messages } = (await response.json()) as { messages: any[] }

    const formattedMessages = messages.map((message: any) => ({
      id: String(message.id),
      content: message.content ?? "",
      role: message.role,
      createdAt: new Date(message.created_at || ""),
      experimental_attachments: message.experimental_attachments,
      parts: (message?.parts as MessageAISDK["parts"]) || undefined,
      message_group_id: message.message_group_id,
      model: message.model,
    }))

    // Update cache with latest messages (now containing decrypted screenshots,
    // so the cache reflects what the renderer expects without a re-fetch).
    await cacheMessages(chatId, formattedMessages)
    return formattedMessages
  } catch (error) {
    console.error("Failed to fetch messages:", error)
    const cached = await getCachedMessages(chatId)
    return cached
  }
}

export async function insertMessageToDb(
  chatId: string,
  message: MessageAISDK
): Promise<void> {
  if (!isSupabaseEnabled) return

  const supabase = createClient()
  if (!supabase) return

  try {
    const payload: any = {
      chat_id: chatId,
      content: message.content,
      role: message.role,
      created_at: message.createdAt?.toISOString() || new Date().toISOString(),
      experimental_attachments: (message as any).experimental_attachments || null,
      parts: (message as any).parts || null,
      message_group_id: (message as any).message_group_id || null,
      model: (message as any).model || null,
    }
    
    // Only include id if it's a valid integer
    const parsedId = parseInt(message.id, 10)
    if (!isNaN(parsedId)) {
      payload.id = parsedId
    }

    const { error } = await supabase.from("messages").insert(payload)
    if (error) {
      console.error("Failed to insert message to database:", error)
      throw error
    }

    // Update local cache after successful server insert
    const current = await getCachedMessages(chatId)
    const updated = [...current, message]
    await cacheMessages(chatId, updated)
  } catch (error) {
    console.error("Failed to insert message:", error)
    // Still update cache even if server insert fails
    const current = await getCachedMessages(chatId)
    const updated = [...current, message]
    await cacheMessages(chatId, updated)
  }
}

async function insertMessagesToDb(chatId: string, messages: MessageAISDK[]) {
  const supabase = createClient()
  if (!supabase) return

  const payload = messages.map((message) => ({
    chat_id: chatId,
    role: message.role,
    content: message.content,
    experimental_attachments: message.experimental_attachments,
    created_at: message.createdAt?.toISOString() || new Date().toISOString(),
    message_group_id: (message as any).message_group_id || null,
    model: (message as any).model || null,
  }))

  await supabase.from("messages").insert(payload)
}

async function deleteMessagesFromDb(chatId: string) {
  const supabase = createClient()
  if (!supabase) return

  const { error } = await supabase
    .from("messages")
    .delete()
    .eq("chat_id", chatId)

  if (error) {
    console.error("Failed to clear messages from database:", error)
  }
}

type ChatMessageEntry = {
  id: string
  messages: MessageAISDK[]
}

export async function getCachedMessages(
  chatId: string
): Promise<MessageAISDK[]> {
  const entry = await readFromIndexedDB<ChatMessageEntry>("messages", chatId)

  if (!entry || Array.isArray(entry)) return []

  return (entry.messages || []).sort(
    (a, b) => +new Date(a.createdAt || 0) - +new Date(b.createdAt || 0)
  )
}

export async function cacheMessages(
  chatId: string,
  messages: MessageAISDK[]
): Promise<void> {
  await writeToIndexedDB("messages", { id: chatId, messages })
}

export async function addMessage(
  chatId: string,
  message: MessageAISDK
): Promise<void> {
  await insertMessageToDb(chatId, message)
  const current = await getCachedMessages(chatId)
  const updated = [...current, message]

  await writeToIndexedDB("messages", { id: chatId, messages: updated })
}

export async function setMessages(
  chatId: string,
  messages: MessageAISDK[]
): Promise<void> {
  await insertMessagesToDb(chatId, messages)
  await writeToIndexedDB("messages", { id: chatId, messages })
}

export async function clearMessagesCache(chatId: string): Promise<void> {
  await writeToIndexedDB("messages", { id: chatId, messages: [] })
}

export async function clearMessagesForChat(chatId: string): Promise<void> {
  await deleteMessagesFromDb(chatId)
  await clearMessagesCache(chatId)
}
