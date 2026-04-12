import { createClient } from "@/lib/supabase/server"
import { getMessageUsage } from "./api"

export async function GET(req: Request) {
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

    const usage = await getMessageUsage(userId)

    if (!usage) {
      return new Response(
        JSON.stringify({ error: "Supabase not available in this deployment." }),
        { status: 200 }
      )
    }

    return new Response(JSON.stringify(usage), { status: 200 })
  } catch (err: unknown) {
    console.error("Error in rate-limits API:", err)
    return new Response(JSON.stringify({ error: "Server error occurred" }), { status: 500 })
  }
}
