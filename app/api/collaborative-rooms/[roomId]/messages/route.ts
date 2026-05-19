import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/server-guest"
import { decryptScreenshotsInMessages } from "@/lib/screenshot-encryption"
import { NextRequest, NextResponse } from "next/server"

// GET: Get all messages in a collaborative room with enhanced user data
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params
    const supabase = await createClient()
    
    if (!supabase) {
      return NextResponse.json(
        { error: "Database connection failed" },
        { status: 500 }
      )
    }

    const { data: authData } = await supabase.auth.getUser()
    
    if (!authData?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Check if user is a participant in this room
    const { data: userParticipant } = await supabase
      .from("chat_participants")
      .select("id")
      .eq("chat_id", roomId)
      .eq("user_id", authData.user.id)
      .single()

    if (!userParticipant) {
      return NextResponse.json(
        { error: "Not a participant in this room" },
        { status: 403 }
      )
    }

    // Check if this is a collaborative room
    const { data: chatData } = await supabase
      .from("chats")
      .select("collaborative")
      .eq("id", roomId)
      .single()

    if (!chatData?.collaborative) {
      return NextResponse.json(
        { error: "Not a collaborative room" },
        { status: 400 }
      )
    }

    // Get all messages with user info for collaborative rooms
    const { data: messages, error } = await supabase
      .from("messages")
      .select(`
        id, content, role, experimental_attachments, created_at, parts, message_group_id, model, user_id,
        users (
          display_name,
          profile_image,
          email
        )
      `)
      .eq("chat_id", roomId)
      .order("created_at", { ascending: true })

    if (error) {
      console.error("Error fetching messages:", error)
      return NextResponse.json(
        { error: "Failed to fetch messages" },
        { status: 500 }
      )
    }

    // Get admin client to fetch user metadata with avatar URLs
    const adminClient = await createServiceClient()
    
    if (adminClient && messages) {
      // Enhance messages with avatar URLs from user metadata for user messages only
      const enhancedMessages = await Promise.all(
        messages.map(async (message: any) => {
          // Only enhance user messages, not assistant messages
          if (message.role === 'user' && message.user_id) {
            try {
              const { data: userData } = await adminClient.auth.admin.getUserById(message.user_id)
              return {
                ...message,
                users: message.users ? {
                  ...message.users,
                  profile_image: userData?.user?.user_metadata?.avatar_url || message.users.profile_image,
                  display_name: userData?.user?.user_metadata?.name || message.users.display_name,
                } : {
                  profile_image: userData?.user?.user_metadata?.avatar_url,
                  display_name: userData?.user?.user_metadata?.name,
                  email: userData?.user?.email || ''
                }
              }
            } catch {
              // Error fetching user metadata
              // Return original message data if admin fetch fails
              return message
            }
          }
          
          // Return assistant messages and other types as-is
          return message
        })
      )
      
      // Decrypt frontendScreenshot values inside JSONB parts. Done AFTER
      // the user-metadata enhancement so we walk the final shape once.
      return NextResponse.json({
        messages: decryptScreenshotsInMessages(enhancedMessages),
      })
    }

    return NextResponse.json({
      messages: decryptScreenshotsInMessages(messages || []),
    })
  } catch (err) {
    console.error("Error in collaborative room messages GET:", err)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
} 