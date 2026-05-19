import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/server-guest"
import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"

// Credit rewards
const RATING_CREDITS = 1
const COMMENT_CREDITS = 5
const NPS_CREDITS = 10

async function awardCredits(
  supabaseAdmin: any,
  userId: string,
  amount: number,
  description: string,
  metadata: Record<string, string>
) {
  // Atomic balance increment via migration 014 RPC.  Replaces the legacy
  // SELECT-then-UPDATE pattern that lost concurrent increments when two
  // award flows (e.g. simultaneous feedback submissions) hit different
  // Next.js replicas. The RPC also handles the "user_credits row missing"
  // case via INSERT ... ON CONFLICT, so we don't need a separate branch.
  const { data: rpcRows, error: rpcError } = await supabaseAdmin.rpc(
    "add_credits_atomic",
    {
      p_user_id: userId,
      p_amount: amount,
    }
  )

  if (rpcError) {
    console.error("add_credits_atomic RPC failed:", rpcError)
    return
  }

  const newBalance: number =
    (Array.isArray(rpcRows) ? rpcRows[0]?.new_balance : (rpcRows as any)?.new_balance) ?? amount

  await supabaseAdmin.from("credit_transactions").insert({
    user_id: userId,
    type: "bonus",
    amount,
    balance_after: newBalance,
    usage_description: description,
    metadata,
  })
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    if (!supabase) {
      return NextResponse.json(
        { error: "Database connection error" },
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

    const body = await req.json()
    const {
      chatId,
      swarmId,
      messageId,
      rating,
      comment,
      npsScore,
      feedbackType = "run",
    } = body

    // Validate inputs
    if (rating !== undefined && (rating < 1 || rating > 4)) {
      return NextResponse.json(
        { error: "Rating must be between 1 and 4" },
        { status: 400 }
      )
    }
    if (npsScore !== undefined && (npsScore < 0 || npsScore > 10)) {
      return NextResponse.json(
        { error: "NPS score must be between 0 and 10" },
        { status: 400 }
      )
    }
    if (!rating && npsScore === undefined) {
      return NextResponse.json(
        { error: "Rating or NPS score is required" },
        { status: 400 }
      )
    }

    const supabaseAdmin = await createServiceClient()
    if (!supabaseAdmin) {
      return NextResponse.json({ error: "Service error" }, { status: 500 })
    }

    // Prevent duplicate feedback for the same message/swarm
    if (messageId || swarmId) {
      const query = supabaseAdmin
        .from("run_feedback")
        .select("id")
        .eq("user_id", user.id)

      if (messageId) query.eq("message_id", messageId)
      if (swarmId) query.eq("swarm_id", swarmId)
      if (npsScore !== undefined) query.eq("feedback_type", "nps")
      else query.neq("feedback_type", "nps")

      const { data: existing } = await query
      if (existing && existing.length > 0) {
        return NextResponse.json(
          { error: "Feedback already submitted", alreadySubmitted: true },
          { status: 409 }
        )
      }
    }

    // Calculate credits to award
    let totalCredits = 0
    if (npsScore !== undefined) {
      totalCredits = NPS_CREDITS
    } else {
      totalCredits = RATING_CREDITS
      if (comment && comment.trim().length > 0) {
        totalCredits += COMMENT_CREDITS
      }
    }

    // Insert feedback record
    const { data: feedback, error: insertError } = await supabaseAdmin
      .from("run_feedback")
      .insert({
        user_id: user.id,
        chat_id: chatId || null,
        swarm_id: swarmId || null,
        message_id: messageId || null,
        rating: rating || null,
        comment: comment?.trim() || null,
        nps_score: npsScore ?? null,
        feedback_type: feedbackType,
        credits_awarded: totalCredits,
        metadata: {},
      })
      .select("id")
      .single()

    if (insertError) {
      console.error("Error inserting run feedback:", insertError)
      return NextResponse.json(
        { error: "Failed to save feedback" },
        { status: 500 }
      )
    }

    // Award credits
    if (totalCredits > 0) {
      const description =
        npsScore !== undefined
          ? "NPS feedback reward"
          : comment
            ? "Run feedback reward (rating + comment)"
            : "Run feedback reward (rating)"

      await awardCredits(supabaseAdmin, user.id, totalCredits, description, {
        feedback_id: feedback.id,
        feedback_type: feedbackType,
        reward_type: "run_feedback",
      })
    }

    return NextResponse.json({
      success: true,
      creditsAwarded: totalCredits,
      feedbackId: feedback.id,
    })
  } catch (error) {
    console.error("Error processing run feedback:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
