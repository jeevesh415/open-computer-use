import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"

export const runtime = "nodejs"

const stripe = new Stripe(process.env.STRIPE_API_KEY!, {
  apiVersion: "2025-08-27.basil",
})

// Server-side credit packages — single source of truth for pricing
const CREDIT_PACKAGES: Record<string, { credits: number; price: number; name: string }> = {
  "boost-small": { credits: 150, price: 19, name: "Boost" },
  "boost-medium": { credits: 500, price: 49, name: "Power Boost" },
  "boost-large": { credits: 1200, price: 99, name: "Ultra Boost" },
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

    // Check if user has an active subscription (required for additional credits)
    const { data: subscription } = await (supabase as any)
      .from("user_subscriptions")
      .select("id, status")
      .eq("user_id", user.id)
      .eq("status", "active")
      .single()

    if (!subscription) {
      return NextResponse.json(
        { error: "Active subscription required to purchase additional credits" },
        { status: 403 }
      )
    }

    // Parse request body
    const body = await req.json()
    const { packageId } = body

    // Look up package server-side — never trust client-sent price/credits
    const pkg = CREDIT_PACKAGES[packageId]
    if (!pkg) {
      return NextResponse.json(
        { error: "Invalid package ID" },
        { status: 400 }
      )
    }

    const { credits, price, name } = pkg

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

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `${name} — ${credits} Credits`,
              description: `Purchase ${credits} credits for your account`,
            },
            unit_amount: Math.round(price * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      payment_intent_data: {
        setup_future_usage: "off_session",
      },
      success_url: `${BASE_URL}/?payment_success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/?payment_canceled=true`,
      metadata: {
        user_id: user.id,
        credits: credits.toString(),
        package_id: packageId || "",
      },
    })

    return NextResponse.json({ 
      sessionId: session.id,
      url: session.url 
    })
  } catch (error) {
    console.error("Error creating checkout session:", error)
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    )
  }
}