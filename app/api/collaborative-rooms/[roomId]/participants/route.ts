import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/server-guest"
import { NextRequest, NextResponse } from "next/server"

// GET: Get all participants in a room
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

    // Get all participants with user info
    const { data: participants, error } = await supabase
      .from("chat_participants")
      .select(`
        *,
        users (
          display_name,
          profile_image,
          email
        )
      `)
      .eq("chat_id", roomId)
      .order("joined_at", { ascending: true })

    if (error) {
      console.error("Error fetching participants:", error)
      return NextResponse.json(
        { error: "Failed to fetch participants" },
        { status: 500 }
      )
    }

    // Get admin client to fetch user metadata with avatar URLs
    const adminClient = await createServiceClient()
    
    if (adminClient && participants) {
      // Enhance participants with avatar URLs from user metadata
      const enhancedParticipants = await Promise.all(
        participants.map(async (participant: any) => {
          try {
            const { data: userData } = await adminClient.auth.admin.getUserById(participant.user_id)
            return {
              ...participant,
              users: {
                ...participant.users,
                profile_image: userData?.user?.user_metadata?.avatar_url || participant.users.profile_image,
                display_name: userData?.user?.user_metadata?.name || participant.users.display_name,
              }
            }
          } catch (error) {
            console.error(`Error fetching user metadata for ${participant.user_id}:`, error)
            // Return original participant data if admin fetch fails
            return participant
          }
        })
      )
      
      return NextResponse.json({ participants: enhancedParticipants })
    }

    return NextResponse.json({ participants })
  } catch (err) {
    console.error("Error in participants GET:", err)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

// DELETE: Remove a participant from the room
export async function DELETE(
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

    const body = await request.json()
    const { userId } = body

    if (!userId) {
      return NextResponse.json(
        { error: "User ID is required" },
        { status: 400 }
      )
    }

    // Check if the requester is the owner or moderator
    const { data: requesterParticipant } = await supabase
      .from("chat_participants")
      .select("role")
      .eq("chat_id", roomId)
      .eq("user_id", authData.user.id)
      .single()

    if (!requesterParticipant) {
      return NextResponse.json(
        { error: "Not a participant in this room" },
        { status: 403 }
      )
    }

    // Allow users to remove themselves, or owners/moderators to remove others
    if (userId !== authData.user.id && !["owner", "moderator"].includes(requesterParticipant.role)) {
      return NextResponse.json(
        { error: "Not authorized to remove participants" },
        { status: 403 }
      )
    }

    // Remove the participant
    const { error } = await supabase
      .from("chat_participants")
      .delete()
      .eq("chat_id", roomId)
      .eq("user_id", userId)

    if (error) {
      console.error("Error removing participant:", error)
      return NextResponse.json(
        { error: "Failed to remove participant" },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Error in participants DELETE:", err)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
} 