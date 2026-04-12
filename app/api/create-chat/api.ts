import { validateUserIdentity } from "@/lib/server/api"
import { checkUsageByModel } from "@/lib/usage"

type CreateChatInput = {
  userId: string
  title?: string
  model: string
  isAuthenticated?: boolean
  projectId?: string
}

export async function createChatInDb({
  userId,
  title,
  model,
  projectId,
}: CreateChatInput) {
  const supabase = await validateUserIdentity(userId)
  if (!supabase) {
    return {
      id: crypto.randomUUID(),
      user_id: userId,
      title,
      model,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      collaborative: false,
    }
  }

  await checkUsageByModel(supabase, userId, model)

  const insertData: {
    user_id: string
    title: string
    model: string
    project_id?: string
    collaborative?: boolean
  } = {
    user_id: userId,
    title: title || "New Task",
    model,
    collaborative: false,
  }

  if (projectId) {
    insertData.project_id = projectId
  }

  const { data, error } = await supabase
    .from("chats")
    .insert(insertData)
    .select("*")
    .single()

  if (error || !data) {
    console.error("Error creating chat:", error)
    return null
  }

  return data
}
