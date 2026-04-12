import { createClient } from "@/lib/supabase/server"
import { createChatInDb } from "./api"

export async function POST(request: Request) {
  try {
    // Authenticate from server-side session — never trust client-provided userId
    const supabase = await createClient()
    if (!supabase) {
      return new Response(JSON.stringify({ error: "Server error" }), { status: 500 })
    }
    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError || !authData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    }
    const userId = authData.user.id

    const { title, model, projectId } = await request.json()

    const chat = await createChatInDb({
      userId,
      title,
      model,
      projectId,
    })

    if (!chat) {
      return new Response(
        JSON.stringify({ error: "Supabase not available in this deployment." }),
        { status: 200 }
      )
    }

    return new Response(JSON.stringify({ chat }), { status: 200 })
  } catch (err: unknown) {
    console.error("Error in create-chat endpoint:", err)

    if (err instanceof Error && err.message === "DAILY_LIMIT_REACHED") {
      return new Response(
        JSON.stringify({ error: err.message, code: "DAILY_LIMIT_REACHED" }),
        { status: 403 }
      )
    }

    return new Response(
      JSON.stringify({
        error: "Server error occurred",
      }),
      { status: 500 }
    )
  }
}
