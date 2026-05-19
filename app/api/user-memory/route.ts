import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

// Keep this in sync with backend/app/utils/user_memory.py MAX_MEMORY_CHARS.
// Stored on public.users.system_prompt (existing free-form TEXT column,
// no schema change). The backend injects this string into every agent
// run's USER turn (never the system prompt — see user_memory.py for the
// prompt-cache rationale).
const MAX_MEMORY_CHARS = 4000

function normalize(raw: unknown): { value: string; truncated: boolean } {
  if (typeof raw !== "string") return { value: "", truncated: false }
  const stripped = raw.trim()
  if (stripped.length > MAX_MEMORY_CHARS) {
    return { value: stripped.slice(0, MAX_MEMORY_CHARS), truncated: true }
  }
  return { value: stripped, truncated: false }
}

export async function GET() {
  try {
    const supabase = await createClient()
    if (!supabase) {
      return NextResponse.json(
        { error: "Database connection failed" },
        { status: 500 }
      )
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data, error } = await supabase
      .from("users")
      .select("system_prompt")
      .eq("id", user.id)
      .single()

    if (error) {
      // First-login user without a public.users row yet — treat as
      // "no memory set" instead of 500. The backend route handles this
      // identically.
      if (error.code === "PGRST116") {
        return NextResponse.json({
          memory: "",
          length: 0,
          max_length: MAX_MEMORY_CHARS,
          truncated: false,
        })
      }
      console.error("Error fetching user memory:", error)
      return NextResponse.json(
        { error: "Server error occurred" },
        { status: 500 }
      )
    }

    const value = (data?.system_prompt ?? "").trim()
    return NextResponse.json({
      memory: value,
      length: value.length,
      max_length: MAX_MEMORY_CHARS,
      truncated: false,
    })
  } catch (error) {
    console.error("Error in user-memory GET API:", error)
    return NextResponse.json(
      { error: "Server error occurred" },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    if (!supabase) {
      return NextResponse.json(
        { error: "Database connection failed" },
        { status: 500 }
      )
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const { value: canonical, truncated } = normalize(body?.memory)

    const { error } = await supabase
      .from("users")
      .update({ system_prompt: canonical })
      .eq("id", user.id)

    if (error) {
      console.error("Error updating user memory:", error)
      return NextResponse.json(
        { error: "Server error occurred" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      memory: canonical,
      length: canonical.length,
      max_length: MAX_MEMORY_CHARS,
      truncated,
    })
  } catch (error) {
    console.error("Error in user-memory PUT API:", error)
    return NextResponse.json(
      { error: "Server error occurred" },
      { status: 500 }
    )
  }
}
