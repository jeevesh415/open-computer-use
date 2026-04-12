import { createServiceClient } from "@/lib/supabase/service"
import { NextRequest, NextResponse } from "next/server"

// GET: List all public chats for the discover page
export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceClient()

    if (!supabase) {
      return NextResponse.json(
        { error: "Database connection failed" },
        { status: 500 }
      )
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get("page") || "0")
    const limit = Math.min(parseInt(searchParams.get("limit") || "24"), 48)
    const offset = page * limit

    // Fetch public chats with first assistant message as preview
    const { data: chats, error, count } = await supabase
      .from("chats")
      .select("id, title, created_at, updated_at, model", { count: "exact" })
      .eq("public", true)
      .not("title", "is", null)
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error("Error fetching public chats:", error)
      return NextResponse.json(
        { error: "Failed to fetch public chats" },
        { status: 500 }
      )
    }

    if (!chats || chats.length === 0) {
      return NextResponse.json({
        chats: [],
        total: count || 0,
        page,
        hasMore: false,
      })
    }

    // Fetch first user message and first assistant message for each chat (preview)
    const chatIds = chats.map((c) => c.id)
    const { data: previewMessages } = await supabase
      .from("messages")
      .select("chat_id, content, role")
      .in("chat_id", chatIds)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: true })

    // Build preview map: first user message + first assistant message per chat
    const previewMap: Record<string, { userMessage?: string; assistantPreview?: string }> = {}
    if (previewMessages) {
      for (const msg of previewMessages) {
        if (!previewMap[msg.chat_id]) {
          previewMap[msg.chat_id] = {}
        }
        const entry = previewMap[msg.chat_id]
        if (msg.role === "user" && !entry.userMessage && msg.content) {
          entry.userMessage = msg.content.slice(0, 200)
        }
        if (msg.role === "assistant" && !entry.assistantPreview && msg.content) {
          // Strip CUA tags and special markers for clean preview
          const clean = msg.content
            .replace(/<cua-section[^>]*>[\s\S]*?<\/cua-section>/g, "")
            .replace(/<[^>]+>/g, "")
            .replace(/\n{2,}/g, "\n")
            .trim()
          if (clean) {
            entry.assistantPreview = clean.slice(0, 300)
          }
        }
      }
    }

    // Get message counts per chat
    const { data: messageCounts } = await supabase
      .from("messages")
      .select("chat_id")
      .in("chat_id", chatIds)

    const countMap: Record<string, number> = {}
    if (messageCounts) {
      for (const msg of messageCounts) {
        countMap[msg.chat_id] = (countMap[msg.chat_id] || 0) + 1
      }
    }

    const enrichedChats = chats.map((chat) => ({
      id: chat.id,
      title: chat.title,
      created_at: chat.created_at,
      updated_at: chat.updated_at,
      model: chat.model,
      messageCount: countMap[chat.id] || 0,
      userMessage: previewMap[chat.id]?.userMessage || null,
      assistantPreview: previewMap[chat.id]?.assistantPreview || null,
    }))

    return NextResponse.json({
      chats: enrichedChats,
      total: count || 0,
      page,
      hasMore: offset + limit < (count || 0),
    })
  } catch (err) {
    console.error("Error in discover GET:", err)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
