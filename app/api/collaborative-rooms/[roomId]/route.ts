import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/server-guest"
import { safeUserMetadataFetch } from "@/lib/fetch"
import { NextRequest, NextResponse } from "next/server"
import { isExpectedAuthError } from "@/lib/observability/auth-errors"

// GET: Get room details with participants
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params
    console.log(`[ROOM API] Fetching room details for ${roomId}`)
    
    const supabase = await createClient()
    
    if (!supabase) {
      console.error("[ROOM API] Database connection failed")
      return NextResponse.json(
        { error: "Database connection failed" },
        { status: 500 }
      )
    }

    const { data: authData, error: authError } = await supabase.auth.getUser()

    if (authError) {
      // Suppress the "logged-out client hit authed route" noise. The
      // refresh_token_not_found / AuthSessionMissingError shape produced
      // 18 ERROR lines / 4 days in the 2026-05-13 audit on this endpoint
      // alone. The route's RESPONSE is unchanged — still a 401 — but the
      // noisy ERROR log is dropped for expected anonymous-poller traffic.
      if (!isExpectedAuthError(authError)) {
        console.error("[ROOM API] Auth error:", authError)
      }
      return NextResponse.json({ error: "Authentication failed" }, { status: 401 })
    }

    if (!authData?.user?.id) {
      // Anonymous client — silent 401. Don't log as ERROR.
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // User requesting room access

    // Check if user is a participant in this room
    const { data: userParticipant, error: participantError } = await supabase
      .from("chat_participants")
      .select("id, role")
      .eq("chat_id", roomId)
      .eq("user_id", authData.user.id)
      .single()

    if (participantError) {
      console.error("[ROOM API] Error checking participant:", participantError)
      if (participantError.code === 'PGRST116') {
        return NextResponse.json(
          { error: "Not a participant in this room" },
          { status: 403 }
        )
      }
      return NextResponse.json(
        { error: "Failed to verify participation" },
        { status: 500 }
      )
    }

    if (!userParticipant) {
      // User is not a participant in room
      return NextResponse.json(
        { error: "Not a participant in this room" },
        { status: 403 }
      )
    }

    // User has participant access

    // Get room details with participants
    const { data: room, error } = await supabase
      .from("chats")
      .select(`
        *,
        chat_participants (
          id,
          user_id,
          role,
          joined_at,
          last_active_at,
          permissions,
          users (
            display_name,
            profile_image,
            email
          )
        )
      `)
      .eq("id", roomId)
      .eq("collaborative", true)
      .single()

    if (error) {
      console.error("[ROOM API] Error fetching room:", error)
      return NextResponse.json(
        { error: "Failed to fetch room details", details: error.message },
        { status: 500 }
      )
    }

    if (!room) {
      console.log(`[ROOM API] Room ${roomId} not found or not collaborative`)
      return NextResponse.json(
        { error: "Room not found" },
        { status: 404 }
      )
    }

    // Get admin client to fetch user metadata with avatar URLs
    const adminClient = await createServiceClient()
    
    if (adminClient && room.chat_participants) {
      try {
        console.log(`[ROOM API] Enhancing ${room.chat_participants.length} participants with metadata`)
        
        // Enhance participants with avatar URLs from user metadata
        const enhancedParticipants = await Promise.allSettled(
          room.chat_participants.map(async (participant: any) => {
            const userData = await safeUserMetadataFetch(
              async () => {
                // Fetching user metadata
                const { data } = await adminClient.auth.admin.getUserById(participant.user_id)
                // Successfully fetched user metadata
                return data
              },
              null // fallback to null if fails
            )

            if (userData) {
              // Enhanced user with metadata
            } else {
              // Using original participant data
            }

            return {
              ...participant,
              users: {
                ...participant.users,
                profile_image: userData?.user?.user_metadata?.avatar_url || participant.users.profile_image,
                display_name: userData?.user?.user_metadata?.name || participant.users.display_name,
              }
            }
          })
        )
        
        // Handle both fulfilled and rejected promises
        room.chat_participants = enhancedParticipants.map((result, index) => {
          if (result.status === 'fulfilled') {
            return result.value
          } else {
            console.error(`Failed to enhance participant ${index}:`, result.reason)
            return room.chat_participants[index] // Return original data
          }
        })
        
        console.log(`[ROOM API] Successfully enhanced participants metadata`)
      } catch (error) {
        console.error("[ROOM API] Failed to enhance participants with metadata, using original data:", error)
        // Continue with original participant data if enhancement fails completely
      }
    }

    console.log(`[ROOM API] Successfully fetched room ${roomId} with ${room.chat_participants?.length || 0} participants`)
    
    return NextResponse.json({ room })
  } catch (err) {
    console.error("[ROOM API] Error in room GET:", err)
    return NextResponse.json(
      { error: "Internal server error", details: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    )
  }
} 