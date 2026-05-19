import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { PURCHASABLE_DB_TIERS } from "@/lib/pricing/tiers"

export const runtime = "nodejs"

const stripe = new Stripe(process.env.STRIPE_API_KEY!, {
  apiVersion: "2025-08-27.basil",
})

// Map tier names to Stripe price IDs (you'll need to create these in Stripe Dashboard)
const STRIPE_PRICE_IDS: Record<string, string> = {
  lite: process.env.STRIPE_PRICE_LITE || "",
  starter: process.env.STRIPE_PRICE_STARTER || "",
  professional: process.env.STRIPE_PRICE_PROFESSIONAL || "",
  unlimited: process.env.STRIPE_PRICE_UNLIMITED || "",
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE || "",
}

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    if (!supabase) {
      return NextResponse.json(
        { error: "Database connection error" },
        { status: 500 }
      )
    }
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    // Check if user already has an active subscription
    const { data: existingSubscription } = await (supabase as any)
      .from("user_subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "active")
      .single()

    if (existingSubscription) {
      return NextResponse.json(
        { error: "You already have an active subscription. Please manage it from your account." },
        { status: 400 }
      )
    }

    // Parse request body
    const body = await req.json()
    const { planId, tier, price } = body

    if (!tier || !STRIPE_PRICE_IDS[tier]) {
      return NextResponse.json(
        { error: "Invalid subscription tier" },
        { status: 400 }
      )
    }

    // Block checkout for any tier that is not currently live for purchase.
    // Defence-in-depth: even if the UI is hiding decommissioned plans, a
    // crafted request must not be allowed to bypass and create a
    // subscription on a hidden tier.  Toggle a tier's `purchasable` flag
    // in lib/pricing/tiers.ts (and add to PURCHASABLE_DB_TIERS) to relist.
    if (!PURCHASABLE_DB_TIERS.has(tier)) {
      return NextResponse.json(
        { error: "This plan is no longer available for new subscriptions." },
        { status: 400 }
      )
    }

    // Get or create Stripe customer
    let stripeCustomerId: string

    const { data: existingCustomer } = await (supabase as any)
      .from("stripe_customers")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .single()

    if (existingCustomer) {
      stripeCustomerId = existingCustomer.stripe_customer_id
    } else {
      // Create new Stripe customer
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          user_id: user.id,
        },
      })

      // Save customer ID to database
      await (supabase as any)
        .from("stripe_customers")
        .insert({
          user_id: user.id,
          stripe_customer_id: customer.id,
          email: user.email,
        })

      stripeCustomerId = customer.id
    }

    // Create Stripe checkout session for subscription
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ["card"],
      line_items: [
        {
          price: STRIPE_PRICE_IDS[tier],
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `${BASE_URL}/?subscription_success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/?payment_canceled=true`,
      metadata: {
        user_id: user.id,
        tier: tier,
        plan_id: planId,
      },
      subscription_data: {
        metadata: {
          user_id: user.id,
          tier: tier,
        },
      },
      // Allow promotion codes
      allow_promotion_codes: true,
    })

    return NextResponse.json({ 
      sessionId: session.id,
      url: session.url 
    })
  } catch (error) {
    console.error("Error creating subscription checkout session:", error)
    return NextResponse.json(
      { error: "Failed to create subscription checkout session" },
      { status: 500 }
    )
  }
}