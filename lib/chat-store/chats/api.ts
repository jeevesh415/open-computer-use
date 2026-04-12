import { readFromIndexedDB, writeToIndexedDB } from "@/lib/chat-store/persist"
import type { Chat, Chats } from "@/lib/chat-store/types"
import { createClient } from "@/lib/supabase/client"
import { isSupabaseEnabled } from "@/lib/supabase/config"
import { MODEL_DEFAULT } from "../../config"
import { fetchClient } from "../../fetch"
import { API_ROUTE_UPDATE_CHAT_MODEL } from "../../routes"

const CHATS_PAGE_SIZE = 20

export async function getChatsForUserInDb(
  userId: string,
  offset: number = 0,
  limit: number = CHATS_PAGE_SIZE
): Promise<{ chats: Chats[]; hasMore: boolean }> {
  const supabase = createClient()
  if (!supabase) return { chats: [], hasMore: false }

  // Get chats owned by the user with pagination
  const { data: ownedChats, error: ownedError } = await supabase
    .from("chats")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (ownedError) {
    console.error("Failed to fetch owned chats:", ownedError)
    return { chats: [], hasMore: false }
  }

  const hasMore = (ownedChats || []).length === limit

  // For each chat, get the last assistant message
  const chatsWithPreviews = await Promise.all(
    (ownedChats || []).map(async (chat: any) => {
      const { data: lastMessage } = await supabase
        .from("messages")
        .select("content")
        .eq("chat_id", chat.id)
        .eq("role", "assistant")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      // Add preview to chat object
      if (lastMessage?.content) {
        let preview = ''
        
        // Try to extract task plan content first
        const taskPlanMatch = lastMessage.content.match(/\[TASK_PLAN_START\]([\s\S]*?)\[TASK_PLAN_END\]/)
        if (taskPlanMatch) {
          try {
            const taskPlan = JSON.parse(taskPlanMatch[1])
            // Create a readable preview from the task plan
            if (taskPlan.main_objective) {
              preview = taskPlan.main_objective
            } else if (taskPlan.subtasks && taskPlan.subtasks.length > 0) {
              // Use first task description as fallback
              preview = taskPlan.subtasks[0].description
            }
          } catch (e) {
            // If JSON parsing fails, try to get clean text from the content
            preview = lastMessage.content
          }
        } else {
          // No task plan found, use regular content
          preview = lastMessage.content
        }
        
        // If we still don't have a preview from task plan, clean the regular content
        if (!preview || preview === lastMessage.content) {
          // Remove special markers
          preview = preview.replace(/\[TASK_PLAN_START\][\s\S]*?\[TASK_PLAN_END\]/g, '')
          preview = preview.replace(/\[REASONING_START\][\s\S]*?\[REASONING_END\]/g, '')
          preview = preview.replace(/\[THINKING_START\][\s\S]*?\[THINKING_END\]/g, '')

          // Remove CUA section tags, keeping inner text content
          preview = preview.replace(/<cua-section\s+[^>]*>/g, '')
          preview = preview.replace(/<\/cua-section>/g, '')
          
          // Remove status updates
          preview = preview.replace(/\[TASK_STATUS:[^:]+:[^\]]+\]/g, '')
          preview = preview.replace(/\[TASK_SUMMARY:[^:]+:[^\]]+\]/g, '')
          
          // Remove code blocks
          preview = preview.replace(/```[\s\S]*?```/g, '')
          preview = preview.replace(/`[^`]+`/g, '')
          
          // Remove markdown formatting
          preview = preview.replace(/[#*_~\[\]()]/g, '')
        }
        
        // Clean up whitespace
        preview = preview.replace(/\s+/g, ' ').trim()
        
        // Truncate to reasonable length
        if (preview.length > 100) {
          preview = preview.substring(0, 100).trim() + '...'
        }
        
        // Only return preview if there's actual content
        if (preview && preview !== '...') {
          return { ...chat, last_message_preview: preview }
        }
      }
      
      return chat
    })
  )

  return { chats: chatsWithPreviews || [], hasMore }
}

export async function updateChatTitleInDb(id: string, title: string) {
  const supabase = createClient()
  if (!supabase) return

  const { error } = await supabase
    .from("chats")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) throw error
}

export async function deleteChatInDb(id: string) {
  const supabase = createClient()
  if (!supabase) return

  const { error } = await supabase.from("chats").delete().eq("id", id)
  if (error) throw error
}

export async function getAllUserChatsInDb(userId: string): Promise<Chats[]> {
  const supabase = createClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from("chats")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })

  if (!data || error) return []
  return data
}

export async function createChatInDb(
  userId: string,
  title: string,
  model: string,
  systemPrompt: string
): Promise<string | null> {
  const supabase = createClient()
  if (!supabase) return null

  const { data, error } = await supabase
    .from("chats")
    .insert({ user_id: userId, title, model, system_prompt: systemPrompt })
    .select("id")
    .single()

  if (error || !data?.id) return null
  return data.id
}

export async function fetchAndCacheChats(
  userId: string,
  offset: number = 0,
  limit: number = CHATS_PAGE_SIZE
): Promise<{ chats: Chats[]; hasMore: boolean }> {
  if (!isSupabaseEnabled) {
    const cached = await getCachedChats()
    return { chats: cached, hasMore: false }
  }

  const { chats: data, hasMore } = await getChatsForUserInDb(userId, offset, limit)

  if (offset === 0 && data.length > 0) {
    // Only overwrite cache on initial load
    await writeToIndexedDB("chats", data)
  } else if (data.length > 0) {
    // Append to cache for subsequent pages
    const cached = await getCachedChats()
    const existingIds = new Set(cached.map(c => c.id))
    const newChats = data.filter(c => !existingIds.has(c.id))
    await writeToIndexedDB("chats", [...cached, ...newChats])
  }

  return { chats: data, hasMore }
}

export async function getCachedChats(): Promise<Chats[]> {
  const all = await readFromIndexedDB<Chats>("chats")
  return (all as Chats[]).sort(
    (a, b) => +new Date(b.created_at || "") - +new Date(a.created_at || "")
  )
}

export async function updateChatTitle(
  id: string,
  title: string
): Promise<void> {
  await updateChatTitleInDb(id, title)
  const all = await getCachedChats()
  const updated = (all as Chats[]).map((c) =>
    c.id === id ? { ...c, title } : c
  )
  await writeToIndexedDB("chats", updated)
}

export async function deleteChat(id: string): Promise<void> {
  await deleteChatInDb(id)
  const all = await getCachedChats()
  await writeToIndexedDB(
    "chats",
    (all as Chats[]).filter((c) => c.id !== id)
  )
}

export async function getChat(chatId: string): Promise<Chat | null> {
  const all = await readFromIndexedDB<Chat>("chats")
  return (all as Chat[]).find((c) => c.id === chatId) || null
}

export async function getUserChats(userId: string): Promise<Chat[]> {
  const data = await getAllUserChatsInDb(userId)
  if (!data) return []
  await writeToIndexedDB("chats", data)
  return data
}

export async function createChat(
  userId: string,
  title: string,
  model: string,
  systemPrompt: string
): Promise<string> {
  const id = await createChatInDb(userId, title, model, systemPrompt)
  const finalId = id ?? crypto.randomUUID()

  await writeToIndexedDB("chats", {
    id: finalId,
    title,
    model,
    user_id: userId,
    system_prompt: systemPrompt,
    created_at: new Date().toISOString(),
  })

  return finalId
}

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

    const all = await getCachedChats()
    const updated = (all as Chats[]).map((c) =>
      c.id === chatId ? { ...c, model } : c
    )
    await writeToIndexedDB("chats", updated)

    return responseData
  } catch (error) {
    console.error("Error updating chat model:", error)
    throw error
  }
}

export async function createNewChat(
  userId: string,
  title?: string,
  model?: string,
  isAuthenticated?: boolean,
  // projectId?: string  // COMMENTED OUT - Project feature disabled
): Promise<Chats> {
  try {
    // userId is derived server-side from session — only send title/model
    const payload: {
      title: string
      model: string
    } = {
      title: title || "New Project",
      model: model || MODEL_DEFAULT,
    }

    const res = await fetchClient("/api/create-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    const responseData = await res.json()

    if (!res.ok || !responseData.chat) {
      throw new Error(responseData.error || "Failed to create chat")
    }

    const chat: Chats = {
      id: responseData.chat.id,
      title: responseData.chat.title,
      created_at: responseData.chat.created_at,
      model: responseData.chat.model,
      user_id: responseData.chat.user_id,
      public: responseData.chat.public,
      updated_at: responseData.chat.updated_at,
      project_id: responseData.chat.project_id || null,
      collaborative: responseData.chat.collaborative || false,
      max_participants: responseData.chat.max_participants || 10,
      invite_code: responseData.chat.invite_code || null,
      room_settings: responseData.chat.room_settings || {},
    }

    await writeToIndexedDB("chats", chat)
    return chat
  } catch (error) {
    console.error("Error creating new chat:", error)
    throw error
  }
}
