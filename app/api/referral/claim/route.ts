import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/server-guest"
import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"

const REFERRAL_CREDITS = 50 // 5 minutes at 10 credits/minute
const REFERRAL_WINDOW_DAYS = 7

async function awardCredits(
  supabaseAdmin: any,
  userId: string,
  amount: number,
  description: string,
  metadata: Record<string, string>
) {
  // Atomic balance increment via migration 014 RPC.  Replaces the legacy
  // SELECT-then-UPDATE pattern that lost concurrent increments when two
  // award flows (e.g. simultaneous referral claims) hit different Next.js
  // replicas.  The RPC also handles the "user_credits row missing" case
  // via INSERT ... ON CONFLICT, so we don't need a separate branch.
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

    // Authenticate the current user (the referred user)
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await req.json()
    const { referrerCode } = body

    if (!referrerCode || typeof referrerCode !== "string") {
      return NextResponse.json(
        { error: "Missing referral code" },
        { status: 400 }
      )
    }

    // Validate UUID format
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(referrerCode)) {
      return NextResponse.json(
        { error: "Invalid referral code" },
        { status: 400 }
      )
    }

    // Prevent self-referral
    if (referrerCode === user.id) {
      return NextResponse.json(
        { error: "Cannot refer yourself" },
        { status: 400 }
      )
    }

    // Use service role client for cross-user operations
    const supabaseAdmin = await createServiceClient()
    if (!supabaseAdmin) {
      return NextResponse.json({ error: "Service error" }, { status: 500 })
    }

    // Verify referrer exists
    const { data: referrer, error: referrerError } = await supabaseAdmin
      .from("users")
      .select("id, email")
      .eq("id", referrerCode)
      .single()

    if (referrerError || !referrer) {
      return NextResponse.json(
        { error: "Invalid referral code" },
        { status: 400 }
      )
    }

    // Check if this referred user already generated a bonus
    const { data: existingClaims } = await supabaseAdmin
      .from("credit_transactions")
      .select("id")
      .eq("type", "bonus")
      .filter("metadata->>referral_type", "eq", "signup_referral")
      .filter("metadata->>referred_user_id", "eq", user.id)

    if (existingClaims && existingClaims.length > 0) {
      return NextResponse.json(
        { error: "Referral already claimed" },
        { status: 409 }
      )
    }

    // Check that referred user is new (within REFERRAL_WINDOW_DAYS)
    const { data: referredUser } = await supabaseAdmin
      .from("users")
      .select("created_at")
      .eq("id", user.id)
      .single()

    if (referredUser?.created_at) {
      const createdAt = new Date(referredUser.created_at)
      const cutoff = new Date(
        Date.now() - REFERRAL_WINDOW_DAYS * 24 * 60 * 60 * 1000
      )
      if (createdAt < cutoff) {
        return NextResponse.json(
          { error: "Referral only valid for new accounts" },
          { status: 400 }
        )
      }
    }

    // Award credits to the referrer
    await awardCredits(
      supabaseAdmin,
      referrerCode,
      REFERRAL_CREDITS,
      "Referral bonus: new user signup",
      {
        referral_type: "signup_referral",
        referred_user_id: user.id,
        referred_user_email: user.email || "",
        direction: "referrer",
      }
    )

    // Award credits to the referred user
    await awardCredits(
      supabaseAdmin,
      user.id,
      REFERRAL_CREDITS,
      "Welcome bonus: joined via referral",
      {
        referral_type: "signup_referral",
        referred_user_id: user.id,
        referrer_user_id: referrerCode,
        referrer_email: referrer.email || "",
        direction: "referred",
      }
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error processing referral claim:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
