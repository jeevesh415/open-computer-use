import { createClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  let body: { chatId?: string; model?: string }
  try {
    body = await request.json()
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400 }
    )
  }
  try {
    const supabase = await createClient()
    const { chatId, model } = body

    if (!chatId || !model) {
      return new Response(
        JSON.stringify({ error: "Missing chatId or model" }),
        { status: 400 }
      )
    }

    // If Supabase is not available, we still return success
    if (!supabase) {
      console.log("Supabase not enabled, skipping DB update")
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    }

    // Verify the user is authenticated
    const { data: authData } = await supabase.auth.getUser()
    if (!authData?.user?.id) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401 }
      )
    }

    // Only update if the user owns the chat
    const { error } = await supabase
      .from("chats")
      .update({ model })
      .eq("id", chatId)
      .eq("user_id", authData.user.id)

    if (error) {
      console.error("Error updating chat model:", error)
      return new Response(
        JSON.stringify({
          error: "Server error occurred",
          details: error.message,
        }),
        { status: 500 }
      )
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
    })
  } catch (err: unknown) {
    console.error("Error in update-chat-model endpoint:", err)
    return new Response(
      JSON.stringify({ error: "Server error occurred" }),
      { status: 500 }
    )
  }
}
