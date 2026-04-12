import { createClient as createServiceClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"

export const runtime = "nodejs"

const stripe = new Stripe(process.env.STRIPE_API_KEY!, {
  apiVersion: "2025-08-27.basil",
})

// Must match the server-side source of truth in /api/credits/checkout
const CREDIT_PACKAGES: Record<string, { credits: number; price: number; name: string }> = {
  "boost-small": { credits: 150, price: 19, name: "Boost" },
  "boost-medium": { credits: 500, price: 49, name: "Power Boost" },
  "boost-large": { credits: 1200, price: 99, name: "Ultra Boost" },
}

// Called by /api/credits/balance when balance drops below threshold
// Also callable by backend via internal API key
export async function POST(req: NextRequest) {
  let resolvedUserId: string | undefined
  try {
    // Authenticate — accept either user session or internal API key
    const internalKey = req.headers.get("x-internal-key")
    if (internalKey && internalKey === process.env.INTERNAL_API_KEY) {
      // Backend calling us
      const body = await req.json()
      resolvedUserId = body.user_id
      if (!resolvedUserId) {
        return NextResponse.json({ error: "user_id required" }, { status: 400 })
      }
    } else {
      // User session
      const { createClient } = await import("@/lib/supabase/server")
      const supabase = await createClient()
      if (!supabase) {
        return NextResponse.json({ error: "Database connection error" }, { status: 500 })
      }
      const { data: { user }, error } = await supabase.auth.getUser()
      if (error || !user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      }
      resolvedUserId = user.id
    }

    // At this point resolvedUserId is always set (all undefined paths return early above)
    const userId = resolvedUserId!

    // Use service role for all DB operations
    const supabase = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // 1. Get auto-refill settings
    const { data: settings } = await supabase
      .from("auto_refill_settings")
      .select("*")
      .eq("user_id", userId)
      .single()

    if (!settings || !settings.enabled) {
      return NextResponse.json({ skipped: true, reason: "auto-refill not enabled" })
    }

    // 2. Check balance is actually below threshold
    const { data: credits } = await supabase
      .from("user_credits")
      .select("balance, total_purchased")
      .eq("user_id", userId)
      .single()

    if (!credits || credits.balance >= settings.threshold) {
      return NextResponse.json({ skipped: true, reason: "balance above threshold" })
    }

    // 3. Check daily limit — reset counter if new day
    const resetAt = new Date(settings.refills_today_reset_at)
    const now = new Date()
    let refillsToday = settings.refills_today

    if (now.toDateString() !== resetAt.toDateString()) {
      refillsToday = 0
      await supabase
        .from("auto_refill_settings")
        .update({ refills_today: 0, refills_today_reset_at: now.toISOString() })
        .eq("user_id", userId)
    }

    if (refillsToday >= settings.max_refills_per_day) {
      return NextResponse.json({ skipped: true, reason: "daily refill limit reached" })
    }

    // 4. Cooldown — at least 5 minutes between refills
    if (settings.last_refill_at) {
      const lastRefill = new Date(settings.last_refill_at)
      const cooldownMs = 5 * 60 * 1000
      if (now.getTime() - lastRefill.getTime() < cooldownMs) {
        return NextResponse.json({ skipped: true, reason: "cooldown period" })
      }
    }

    // 5. Get the credit package
    const pkg = CREDIT_PACKAGES[settings.package_id]
    if (!pkg) {
      return NextResponse.json({ error: "Invalid package configured" }, { status: 400 })
    }

    // 6. Get Stripe customer
    const { data: stripeCustomer } = await supabase
      .from("stripe_customers")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .single()

    if (!stripeCustomer) {
      return NextResponse.json({ skipped: true, reason: "no Stripe customer on file" })
    }

    // 7. Get default payment method
    const customer = await stripe.customers.retrieve(stripeCustomer.stripe_customer_id) as Stripe.Customer
    let paymentMethodId =
      (typeof customer.invoice_settings?.default_payment_method === "string"
        ? customer.invoice_settings.default_payment_method
        : customer.invoice_settings?.default_payment_method?.id) ||
      (typeof customer.default_source === "string"
        ? customer.default_source
        : customer.default_source?.id)

    // Fallback: list payment methods and use most recent
    if (!paymentMethodId) {
      const methods = await stripe.paymentMethods.list({
        customer: stripeCustomer.stripe_customer_id,
        type: "card",
        limit: 1,
      })
      if (methods.data.length > 0) {
        paymentMethodId = methods.data[0].id
      }
    }

    if (!paymentMethodId) {
      // Disable auto-refill if no payment method
      await supabase
        .from("auto_refill_settings")
        .update({ enabled: false, updated_at: now.toISOString() })
        .eq("user_id", userId)

      return NextResponse.json({
        skipped: true,
        reason: "no payment method on file — auto-refill disabled",
      })
    }

    // 8. Create off-session PaymentIntent
    const idempotencyKey = `auto-refill-${userId}-${now.toISOString().slice(0, 10)}-${refillsToday}`

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: Math.round(pkg.price * 100),
        currency: "usd",
        customer: stripeCustomer.stripe_customer_id,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        description: `Auto-refill: ${pkg.name} (${pkg.credits} credits)`,
        metadata: {
          user_id: userId,
          credits: pkg.credits.toString(),
          package_id: settings.package_id,
          type: "auto_refill",
        },
      },
      { idempotencyKey }
    )

    if (paymentIntent.status !== "succeeded") {
      console.error(`Auto-refill PaymentIntent not succeeded: ${paymentIntent.status}`)
      return NextResponse.json({
        error: "Payment failed",
        status: paymentIntent.status,
      }, { status: 402 })
    }

    // 9. Atomically add credits to user balance (avoids race with concurrent deductions)
    const { data: updatedCredits, error: updateError } = await supabase
      .rpc("add_credits_atomic", {
        p_user_id: userId,
        p_amount: pkg.credits,
      })

    // Fallback if RPC doesn't exist yet — use increment pattern
    let newBalance: number
    if (updateError) {
      console.warn("add_credits_atomic RPC not available, falling back to increment:", updateError.message)
      // Re-fetch current balance to minimize race window
      const { data: freshCredits } = await supabase
        .from("user_credits")
        .select("balance, total_purchased")
        .eq("user_id", userId)
        .single()

      const currentBalance = freshCredits?.balance ?? credits.balance
      const currentTotalPurchased = freshCredits?.total_purchased ?? credits.total_purchased ?? 0
      newBalance = currentBalance + pkg.credits

      await supabase
        .from("user_credits")
        .update({
          balance: newBalance,
          total_purchased: currentTotalPurchased + pkg.credits,
          last_purchase_at: now.toISOString(),
        })
        .eq("user_id", userId)
    } else {
      newBalance = (updatedCredits as any)?.new_balance ?? (credits.balance + pkg.credits)
    }

    // 10. Record transaction
    await supabase
      .from("credit_transactions")
      .insert({
        user_id: userId,
        type: "purchase",
        amount: pkg.credits,
        balance_after: newBalance,
        stripe_payment_intent_id: paymentIntent.id,
        currency: "usd",
        price_paid: pkg.price,
        usage_description: `Auto-refill: ${pkg.name}`,
        metadata: {
          type: "auto_refill",
          package_id: settings.package_id,
          threshold: settings.threshold,
        },
      })

    // 11. Update refill tracking
    await supabase
      .from("auto_refill_settings")
      .update({
        refills_today: refillsToday + 1,
        last_refill_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("user_id", userId)

    console.log(`Auto-refill success: ${pkg.credits} credits for user ${userId}`)

    return NextResponse.json({
      success: true,
      credits_added: pkg.credits,
      new_balance: newBalance,
      charged: pkg.price,
    })
  } catch (error: any) {
    // Handle Stripe card errors gracefully
    if (error?.type === "StripeCardError" || error?.code === "authentication_required") {
      console.error("Auto-refill card error:", error.message)

      // Disable auto-refill on card failure to prevent repeated charge attempts
      if (resolvedUserId) {
        try {
          const supa = createServiceClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE!,
            { auth: { autoRefreshToken: false, persistSession: false } }
          )
          await supa
            .from("auto_refill_settings")
            .update({ enabled: false, updated_at: new Date().toISOString() })
            .eq("user_id", resolvedUserId)
        } catch {}
      }

      return NextResponse.json({
        error: "Card declined",
        message: error.message,
      }, { status: 402 })
    }

    console.error("Auto-refill execution error:", error)
    return NextResponse.json({ error: "Auto-refill failed" }, { status: 500 })
  }
}
