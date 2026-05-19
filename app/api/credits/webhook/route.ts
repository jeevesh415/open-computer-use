import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { headers } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { logApiAccess } from "@/lib/observability/api-access-log"

export const runtime = "nodejs"
export const maxDuration = 60

const stripe = new Stripe(process.env.STRIPE_API_KEY!, {
  apiVersion: "2025-08-27.basil",
})

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!

// Helper function to handle credit purchases (receives service role client)
async function handleCreditPurchase(session: Stripe.Checkout.Session, supabase: any) {
  const userId = session.metadata?.user_id
  const credits = parseInt(session.metadata?.credits || "0")

  if (!userId || !credits) {
    console.error("Missing user_id or credits in session metadata")
    return
  }

  // Atomic balance increment via migration 014 RPC.  Replaces the legacy
  // SELECT-then-UPDATE pattern that lost concurrent updates between
  // replicas.  The RPC also handles the "user_credits row missing" case
  // via INSERT ... ON CONFLICT, so we don't need a separate branch.
  const { data: rpcRows, error: rpcError } = await supabase.rpc(
    "add_credits_atomic",
    {
      p_user_id: userId,
      p_amount: credits,
    }
  )

  if (rpcError) {
    console.error("add_credits_atomic RPC failed:", rpcError)
    return
  }

  const newBalance: number =
    (Array.isArray(rpcRows) ? rpcRows[0]?.new_balance : (rpcRows as any)?.new_balance) ?? credits

  // Record transaction.  The credit_transactions partial UNIQUE on
  // stripe_payment_intent_id (migration 014) means a Stripe retry of the
  // SAME PaymentIntent will fail with 23505 here.  In that case we must
  // compensate by subtracting back the duplicate increment we just made,
  // otherwise balance > sum(transactions).
  const { error: txnError } = await supabase
    .from("credit_transactions")
    .insert({
      user_id: userId,
      type: "purchase",
      amount: credits,
      balance_after: newBalance,
      stripe_payment_intent_id: session.payment_intent as string,
      stripe_checkout_session_id: session.id,
      currency: session.currency,
      price_paid: (session.amount_total || 0) / 100,
      metadata: {
        session_id: session.id,
        customer_email: session.customer_email,
      },
    })

  if (txnError) {
    if ((txnError as any).code === '23505') {
      // PaymentIntent already recorded — Stripe is retrying a delivery
      // that we processed previously (or a sibling replica did).  Subtract
      // back the duplicate increment that add_credits_atomic just made so
      // balance stays consistent with the transactions log.
      console.log(
        `credit_transactions row already recorded for PaymentIntent ${session.payment_intent}; compensating by reverting the duplicate increment`
      )
      const { error: compensateError } = await supabase.rpc(
        "add_credits_atomic",
        {
          p_user_id: userId,
          p_amount: -credits,
        }
      )
      if (compensateError) {
        console.error(
          "Failed to compensate duplicate-insert race:",
          compensateError
        )
      }
      return
    }
    console.error("Error inserting credit_transactions row:", txnError)
    return
  }

  console.log(`Successfully processed payment: ${credits} credits`)
}

export async function POST(req: NextRequest) {
  // Per-request access log. Critical for the Stripe webhook because a 500
  // here means Stripe retries — without the access log we couldn't tell
  // the difference between "Stripe is hammering us due to retries" vs
  // "normal webhook traffic spiked".
  const t_start = Date.now()
  let webhookEventType: string | undefined
  let outResponse: NextResponse | undefined
  try {
    const body = await req.text()
    const signature = (await headers()).get("stripe-signature")

    if (!signature) {
      outResponse = NextResponse.json(
        { error: "Missing stripe signature" },
        { status: 400 }
      )
      return outResponse
    }

    let event: Stripe.Event

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
    } catch (err) {
      console.error("Webhook signature verification failed:", err)
      outResponse = NextResponse.json(
        { error: "Invalid signature" },
        { status: 400 }
      )
      return outResponse
    }

    webhookEventType = event.type

    // Use service role client for webhook operations (bypasses RLS)
    const supabase = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Atomically check and record the event (prevents race condition with simultaneous deliveries)
    // Uses upsert with onConflict + ignoreDuplicates → INSERT ON CONFLICT DO NOTHING
    // maybeSingle() returns null data (no error) when the row is skipped, vs single() which throws PGRST116
    const { data: insertedEvent, error: eventInsertError } = await supabase
      .from("stripe_events")
      .upsert(
        {
          id: event.id,
          type: event.type,
          data: event.data,
          processed: false,
        },
        { onConflict: "id", ignoreDuplicates: true }
      )
      .select("id")
      .maybeSingle()

    // Real DB error — let Stripe retry
    if (eventInsertError) {
      console.error(`Error recording stripe event ${event.id}:`, eventInsertError)
      outResponse = NextResponse.json({ error: "Database error" }, { status: 500 })
      return outResponse
    }

    // No row returned means the event already existed — skip processing
    if (!insertedEvent) {
      console.log(`Event ${event.id} already processed (atomic check)`)
      outResponse = NextResponse.json({ received: true })
      return outResponse
    }

    // Log the event for debugging
    console.log(`Processing webhook event: ${event.type}`)
    
    // Handle the event
    switch (event.type) {
      // Handle subscription creation
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session
        console.log(`Processing checkout session: ${session.id}, mode: ${session.mode}`)
        
        // Check if this is a subscription checkout
        if (session.mode === "subscription") {
          const userId = session.metadata?.user_id
          const tier = session.metadata?.tier
          const subscriptionId = session.subscription as string
          
          console.log(`Subscription checkout - tier: ${tier}`)
          
          if (!userId || !tier || !subscriptionId) {
            console.error("Missing subscription metadata")
            break
          }

          // IMPORTANT: Check if we've already granted credits for this subscription
          // This prevents double granting when both checkout.session.completed and customer.subscription.created fire
          const { data: existingGrant } = await (supabase as any)
            .from("credit_transactions")
            .select("id")
            .eq("user_id", userId)
            .eq("type", "subscription_grant")
            .eq("metadata->>stripe_subscription_id", subscriptionId)
            .single()

          if (existingGrant) {
            console.log(`Credits already granted for subscription ${subscriptionId}, skipping credit grant in checkout.session.completed`)
            // Still create/update the subscription record, just don't grant credits
          }

          // Get the subscription details from Stripe
          const subscription = await stripe.subscriptions.retrieve(subscriptionId) as any
          
          // Get the plan from database first
          const { data: plan } = await (supabase as any)
            .from("subscription_plans")
            .select("*")
            .eq("tier", tier)
            .single()

          if (!plan) {
            console.error("Subscription plan not found for tier:", tier)
            break
          }

          // Handle timestamps - they might not be available yet in checkout.session.completed
          let periodStart: string
          let periodEnd: string
          
          if (subscription.current_period_start && subscription.current_period_end) {
            try {
              periodStart = new Date(subscription.current_period_start * 1000).toISOString()
              periodEnd = new Date(subscription.current_period_end * 1000).toISOString()
            } catch (e) {
              console.error("Invalid subscription period timestamps:", e)
              // Use fallback dates
              periodStart = new Date().toISOString()
              periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days from now
            }
          } else {
            // Subscription timestamps not available yet, use defaults
            // TODO(NEW-4 audit): These NOW()/NOW()+30d fallbacks are NOT stable
            // across webhook retries. The priority-ordered period derivation
            // applied to the invoice.payment_succeeded handler should also be
            // applied here. For checkout.session.completed the impact is bounded
            // to the *initial* grant: the existing-grant dedupe is keyed on
            // metadata->>stripe_subscription_id (not the unstable period), so
            // a retry with a different "now" cannot double-grant — it would be
            // skipped by the existingGrant short-circuit. The cosmetic side
            // effect is that the persisted period column may not match Stripe.
            // Fix path: when the session has an `invoice` reference, retrieve
            // it and use invoice.lines.data[0].period.{start,end}.
            console.log("Subscription timestamps not available yet, using defaults")
            periodStart = new Date().toISOString()
            periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days from now
          }

          // Check if subscription already exists (user might be resubscribing)
          const { data: existingSubscription } = await (supabase as any)
            .from("user_subscriptions")
            .select("*")
            .eq("stripe_subscription_id", subscriptionId)
            .single()

          let newSubscription
          
          if (existingSubscription) {
            console.log(`Subscription already exists for ${subscriptionId}, updating it`)
            // Update existing subscription record (reactivation)
            const { data: updated, error: updateError } = await (supabase as any)
              .from("user_subscriptions")
              .update({
                subscription_plan_id: plan.id,
                stripe_customer_id: session.customer as string,
                status: subscription.status,
                current_period_start: periodStart,
                current_period_end: periodEnd,
                cancel_at_period_end: false,
                canceled_at: null,  // Clear cancellation date
                updated_at: new Date().toISOString()
              })
              .eq("stripe_subscription_id", subscriptionId)
              .select()
              .single()
            
            if (updateError) {
              console.error("Error updating subscription record:", updateError)
              break
            }
            
            newSubscription = updated
            console.log(`Subscription record updated (reactivated) with ID: ${newSubscription.id}`)
          } else {
            // Create new subscription record
            const { data: created, error: insertError } = await (supabase as any)
              .from("user_subscriptions")
              .insert({
                user_id: userId,
                subscription_plan_id: plan.id,
                stripe_subscription_id: subscriptionId,
                stripe_customer_id: session.customer as string,
                status: subscription.status,
                current_period_start: periodStart,
                current_period_end: periodEnd,
                cancel_at_period_end: subscription.cancel_at_period_end,
                created_at: new Date().toISOString()
              })
              .select()
              .single()

            if (insertError || !created) {
              // Handle edge case where subscription was created between our check and insert
              if (insertError?.code === '23505') {
                console.log("Subscription was created concurrently, fetching it")
                const { data: concurrent } = await (supabase as any)
                  .from("user_subscriptions")
                  .select("*")
                  .eq("stripe_subscription_id", subscriptionId)
                  .single()
                
                if (concurrent) {
                  newSubscription = concurrent
                } else {
                  console.error("Could not find or create subscription")
                  break
                }
              } else {
                console.error("Error creating subscription record:", insertError)
                break
              }
            } else {
              newSubscription = created
              console.log(`Subscription record created with ID: ${newSubscription.id}`)
            }
          }

          // Only grant credits if we haven't already.  Belt-and-braces:
          // the existingGrant short-circuit above is application-level
          // dedup; the RPC also dedupes natively via the UNIQUE constraint
          // on subscription_credit_grants(subscription_id, billing_period_start).
          if (!existingGrant) {
            // Atomic + idempotent grant via migration 014 RPC.  Replaces
            // the legacy SELECT/UPDATE/INSERT triple that lost concurrent
            // updates between replicas.  The RPC handles the "user_credits
            // row missing" case via INSERT ... ON CONFLICT, takes a
            // FOR UPDATE row lock, and inserts the credit_transactions
            // row with the post-update balance — see migration 014.
            //
            // Column is `usage_description` per supabase/schema.sql:1747.
            // Pre-fix this used `description:` and silently failed every
            // Stripe insert with PGRST204 "Could not find the
            // 'description' column of 'credit_transactions' in the
            // schema cache" — confirmed via 2026-04-30 webhook for user
            // 8d19ce8c-9741-47bd-98c7-eadc6512e642.
            const { data: rpcRows, error: rpcError } = await (supabase as any).rpc(
              "grant_subscription_credits_atomic",
              {
                p_user_id: userId,
                p_subscription_id: newSubscription.id,
                p_credits: plan.monthly_credits,
                p_period_start: periodStart,
                p_period_end: periodEnd,
                p_invoice_id: null,
                p_transaction_type: "subscription_grant",
                p_usage_description: `Initial ${tier} subscription credits`,
                p_metadata: {
                  tier: tier,
                  period_start: periodStart,
                  period_end: periodEnd,
                  stripe_subscription_id: subscriptionId,
                  event_type: "checkout.session.completed"
                },
              }
            )

            if (rpcError) {
              console.error("grant_subscription_credits_atomic (checkout) failed:", rpcError)
            } else {
              const result = Array.isArray(rpcRows) ? rpcRows[0] : (rpcRows as any)
              if (result?.was_granted) {
                console.log(
                  `Atomically granted ${plan.monthly_credits} credits for subscription ${subscriptionId}; new balance: ${result?.new_balance}`
                )
              } else {
                console.log(
                  `Subscription ${subscriptionId} period ${periodStart} already granted (RPC dedup); skipping`
                )
              }
            }
          } else {
            console.log(`Skipped credit granting for subscription ${subscriptionId} - already granted`)
          }

          // Sync tier across user_credits.subscription_tier + machine_limits.tier
          // from the just-written user_subscriptions row.  This is the single
          // canonical projection — see migration 011.  Idempotent.
          {
            const { error: syncError } = await (supabase as any).rpc(
              "sync_user_tier",
              { p_user_id: userId }
            )
            if (syncError) {
              console.error("sync_user_tier after checkout failed:", syncError)
            }
          }

          console.log(`Subscription created for user ${userId}: ${tier} plan`)
        } else {
          // Handle one-time credit purchases (existing code)
          await handleCreditPurchase(session, supabase)
        }
        break
      }

      // Handle subscription creation (this has full subscription data)
      // NOTE: This handler NEVER grants initial credits — that is done exclusively by checkout.session.completed.
      // This handler only manages subscription records and handles reactivation credits.
      case "customer.subscription.created": {
        const subscription = event.data.object as any
        console.log(`Processing subscription created: ${subscription.id}`)

        // Get metadata
        const userId = subscription.metadata?.user_id
        const tier = subscription.metadata?.tier

        if (!userId || !tier) {
          console.error("Missing metadata in subscription.created:", { userId, tier })
          break
        }

        // Check if we already have this subscription record
        const { data: existingSub } = await (supabase as any)
          .from("user_subscriptions")
          .select("*")
          .eq("stripe_subscription_id", subscription.id)
          .single()

        if (existingSub) {
          console.log("Subscription already exists, updating it with full details")
          // Update the subscription with complete information from Stripe
          if (subscription.current_period_start && subscription.current_period_end) {
            await (supabase as any)
              .from("user_subscriptions")
              .update({
                status: subscription.status,
                current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
                current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
                cancel_at_period_end: subscription.cancel_at_period_end,
                updated_at: new Date().toISOString()
              })
              .eq("id", existingSub.id)

            console.log(`Updated subscription ${existingSub.id} with full details`)
          }

          // Check if this is a reactivation (status changed from canceled to active)
          if (existingSub.status === 'canceled' && subscription.status === 'active') {
            console.log("Subscription reactivated, checking for duplicate reactivation grant")

            // Check if we've already granted reactivation credits for this subscription
            const { data: existingReactivation } = await (supabase as any)
              .from("credit_transactions")
              .select("id")
              .eq("user_id", userId)
              .eq("type", "subscription_reactivation")
              .eq("metadata->>stripe_subscription_id", subscription.id)
              .single()

            if (existingReactivation) {
              console.log(`Reactivation credits already granted for subscription ${subscription.id}, skipping`)
            } else {
              // Get the plan
              const { data: plan } = await (supabase as any)
                .from("subscription_plans")
                .select("*")
                .eq("tier", tier)
                .single()

              if (plan) {
                // Reactivation period derivation — prefer Stripe's
                // current_period_*, fall back to NOW()/+30d.  This timestamp
                // is the dedup key for the RPC.
                let reactivationPeriodStart: string
                let reactivationPeriodEnd: string
                if (subscription.current_period_start && subscription.current_period_end) {
                  try {
                    reactivationPeriodStart = new Date(subscription.current_period_start * 1000).toISOString()
                    reactivationPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString()
                  } catch {
                    reactivationPeriodStart = new Date().toISOString()
                    reactivationPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
                  }
                } else {
                  reactivationPeriodStart = new Date().toISOString()
                  reactivationPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
                }

                // Atomic + idempotent grant via migration 014 RPC.
                // Replaces the legacy SELECT/UPDATE/INSERT triple.
                const { data: rpcRows, error: rpcError } = await (supabase as any).rpc(
                  "grant_subscription_credits_atomic",
                  {
                    p_user_id: userId,
                    p_subscription_id: existingSub.id,
                    p_credits: plan.monthly_credits,
                    p_period_start: reactivationPeriodStart,
                    p_period_end: reactivationPeriodEnd,
                    p_invoice_id: null,
                    p_transaction_type: "subscription_reactivation",
                    p_usage_description: `${tier} subscription reactivation`,
                    p_metadata: {
                      tier: tier,
                      stripe_subscription_id: subscription.id,
                      event: "customer.subscription.created (reactivation)"
                    },
                  }
                )

                if (rpcError) {
                  console.error("grant_subscription_credits_atomic (reactivation) failed:", rpcError)
                } else {
                  const result = Array.isArray(rpcRows) ? rpcRows[0] : (rpcRows as any)
                  if (result?.was_granted) {
                    console.log(
                      `Reactivation: Atomically added ${plan.monthly_credits} credits for user ${userId}, new balance: ${result?.new_balance}`
                    )
                  } else {
                    console.log(
                      `Reactivation: subscription ${subscription.id} period ${reactivationPeriodStart} already granted (RPC dedup); skipping`
                    )
                  }
                }
              }
            }
          }

          // Sync tier across user_credits + machine_limits from the existing
          // (now-updated) user_subscriptions row.  Idempotent.
          {
            const { error: syncError } = await (supabase as any).rpc(
              "sync_user_tier",
              { p_user_id: userId }
            )
            if (syncError) {
              console.error("sync_user_tier after subscription.created (existing) failed:", syncError)
            }
          }

          break
        }

        // No subscription record exists yet — create it without granting credits.
        // Credits are granted exclusively by checkout.session.completed.
        // If that event failed, credits will be granted on the next invoice.payment_succeeded (monthly renewal).
        console.log("Creating subscription record from subscription.created (no credit grant — handled by checkout.session.completed)")

        // Get the plan
        const { data: plan } = await (supabase as any)
          .from("subscription_plans")
          .select("*")
          .eq("tier", tier)
          .single()

        if (!plan) {
          console.error("Plan not found for tier in subscription.created:", tier)
          break
        }

        // Create subscription record only — no credit granting
        const { error: insertError } = await (supabase as any)
          .from("user_subscriptions")
          .insert({
            user_id: userId,
            subscription_plan_id: plan.id,
            stripe_subscription_id: subscription.id,
            stripe_customer_id: subscription.customer,
            status: subscription.status,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            cancel_at_period_end: subscription.cancel_at_period_end,
          })

        if (insertError) {
          console.error("Error creating subscription in subscription.created:", insertError)
          break
        }

        // Ensure user_credits has subscription flags set (but don't add credits)
        const { data: currentCredits } = await (supabase as any)
          .from("user_credits")
          .select("*")
          .eq("user_id", userId)
          .single()

        if (currentCredits) {
          await (supabase as any)
            .from("user_credits")
            .update({
              has_active_subscription: true,
              subscription_tier: tier,
              updated_at: new Date().toISOString()
            })
            .eq("user_id", userId)
        }

        // Sync tier across user_credits + machine_limits from the just-inserted
        // user_subscriptions row.  Closes the gap where machine_limits.tier
        // would otherwise stay at 'free' until the next subscription.updated.
        {
          const { error: syncError } = await (supabase as any).rpc(
            "sync_user_tier",
            { p_user_id: userId }
          )
          if (syncError) {
            console.error("sync_user_tier after subscription.created (new) failed:", syncError)
          }
        }

        console.log(`Subscription record created for user ${userId}: ${tier} plan (credits deferred to checkout.session.completed)`)
        break
      }

      // Handle subscription updates (status change, plan change, cancel-at-period-end toggle)
      case "customer.subscription.updated": {
        const subscription = event.data.object as any

        // Validate timestamps exist (best-effort — RPC tolerates NULLs).
        let periodStart: string | null = null
        let periodEnd: string | null = null
        if (subscription.current_period_start && subscription.current_period_end) {
          try {
            periodStart = new Date(subscription.current_period_start * 1000).toISOString()
            periodEnd = new Date(subscription.current_period_end * 1000).toISOString()
          } catch (e) {
            console.error("Invalid subscription update timestamps:", e)
          }
        }

        // Detect plan change: pick the FIRST line item's price id and resolve
        // it against subscription_plans.stripe_price_id.  This corrects the
        // historical bug where plan changes via the Stripe Customer Portal
        // never propagated to user_subscriptions.subscription_plan_id.
        let newPlanId: string | null = null
        let newPlanTier: string | null = null
        try {
          const newPriceId: string | undefined =
            subscription.items?.data?.[0]?.price?.id ??
            subscription.items?.data?.[0]?.plan?.id
          if (newPriceId) {
            const { data: plan } = await (supabase as any)
              .from("subscription_plans")
              .select("id, tier")
              .eq("stripe_price_id", newPriceId)
              .maybeSingle()
            if (plan?.id) {
              newPlanId = plan.id
              newPlanTier = plan.tier
            } else {
              console.warn(
                `subscription.updated: price ${newPriceId} not found in subscription_plans; tier change will not propagate`
              )
            }
          }
        } catch (e) {
          console.error("subscription.updated: plan lookup failed:", e)
        }

        // Single atomic RPC: writes user_subscriptions, user_credits, and
        // machine_limits.tier — see migration 011.
        const { data: rpcResult, error: rpcError } = await (supabase as any).rpc(
          "update_subscription_status",
          {
            p_stripe_subscription_id: subscription.id,
            p_status: subscription.status,
            p_period_start: periodStart,
            p_period_end: periodEnd,
            p_cancel_at_period_end: subscription.cancel_at_period_end,
            p_subscription_plan_id: newPlanId,
          }
        )
        if (rpcError) {
          console.error("update_subscription_status RPC failed:", rpcError)
        }

        // Stripe stores the original tier in subscription.metadata.tier.  When
        // the user changes plan via the Customer Portal, that metadata is
        // stale.  Patch it so future invoice.payment_succeeded events resolve
        // the correct tier from metadata.  Best-effort — DB is the source of
        // truth and the renewal handler reads from DB too.
        if (newPlanTier && subscription.metadata?.tier !== newPlanTier) {
          try {
            await stripe.subscriptions.update(subscription.id, {
              metadata: { ...(subscription.metadata || {}), tier: newPlanTier },
            })
          } catch (e) {
            console.error("Failed to patch subscription.metadata.tier:", e)
          }
        }

        // Reconcile downstream resources whenever tier moved.  Idempotent: if
        // the user is still within limits, this is a no-op.  Skips when:
        //   * the subscription was unknown to our DB (no rpcResult)
        //   * the subscription is past_due/active/trialing AND tier didn't
        //     drop (we still call reconcile because the user may already be
        //     over the cap from grandfathered limits — the function tolerates).
        // NOTE: OUT columns are prefixed with `out_` to avoid PG 42702
        // "ambiguous user_id" inside the RPC body — see
        // supabase/migrations/015_fix_ambiguous_user_id.sql.
        const resolvedUserId = rpcResult?.[0]?.out_user_id as string | undefined
        const resolvedTier = rpcResult?.[0]?.out_resolved_tier as string | undefined
        if (resolvedUserId && resolvedTier) {
          try {
            const { reconcileForTierChange } = await import(
              "@/lib/services/tier-reconciler"
            )
            const reconcileResult = await reconcileForTierChange({
              supabase,
              userId: resolvedUserId,
              newTier: resolvedTier,
              reason: "subscription_downgraded",
            })
            console.log(
              `subscription.updated: reconciled user=${resolvedUserId} tier=${resolvedTier} machines={terminated:${reconcileResult.machinesTerminated}, deferred:${reconcileResult.machinesDeferred}, failed:${reconcileResult.machinesFailedToTerminate}} schedules={paused:${reconcileResult.schedulesPaused}}`
            )
          } catch (reconcileError) {
            console.error(
              `subscription.updated: reconciliation failed for user=${resolvedUserId}:`,
              reconcileError
            )
          }
        }

        console.log(
          `Subscription updated: ${subscription.id} status=${subscription.status} planChange=${
            newPlanId ? `→${newPlanTier}` : "no"
          } rpcUserId=${rpcResult?.[0]?.out_user_id ?? "none"}`
        )
        break
      }

      // Handle subscription deletion/cancellation.  Routes through the same
      // RPC so machine_limits.tier and user_credits flags are flipped to free
      // atomically.  Also resolves user_id robustly: never relies on
      // metadata.user_id (which Stripe may strip on out-of-band subscription
      // creation, manual Dashboard edits, or migrated subs); instead looks it
      // up via stripe_customers.stripe_customer_id which is a UNIQUE column.
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = (subscription as any).customer as string | undefined

        // Primary path: RPC handles update + tier sync in one transaction,
        // keyed on stripe_subscription_id (UNIQUE).
        const { data: rpcResult, error: rpcError } = await (supabase as any).rpc(
          "update_subscription_status",
          {
            p_stripe_subscription_id: subscription.id,
            p_status: "canceled",
            p_period_start: null,
            p_period_end: null,
            p_cancel_at_period_end: null,
            p_subscription_plan_id: null,
          }
        )
        if (rpcError) {
          console.error("subscription.deleted RPC failed:", rpcError)
        }

        // Defensive fallback: subscription wasn't in our DB.  Find the user
        // via stripe_customers (NEVER via metadata.user_id — Stripe doesn't
        // guarantee metadata is preserved on subscription deletion, and a
        // canceled subscription created via the Dashboard or by a migration
        // tool may have empty metadata).
        // OUT columns prefixed with `out_` — see migration 015.
        let resolvedUserId: string | null = rpcResult?.[0]?.out_user_id ?? null
        if (!resolvedUserId && customerId) {
          const { data: customerRow } = await (supabase as any)
            .from("stripe_customers")
            .select("user_id")
            .eq("stripe_customer_id", customerId)
            .maybeSingle()
          if (customerRow?.user_id) {
            resolvedUserId = customerRow.user_id as string
            await (supabase as any).rpc("sync_user_tier", { p_user_id: resolvedUserId })
            console.log(
              `subscription.deleted: ${subscription.id} unknown to DB; resolved user via stripe_customers(${customerId})=${resolvedUserId} and applied sync_user_tier`
            )
          }
        }

        if (!resolvedUserId) {
          console.warn(
            `subscription.deleted: ${subscription.id} could not resolve user_id (customer=${customerId ?? "?"}); skipping reconciliation`
          )
          console.log(`Subscription canceled: ${subscription.id}`)
          break
        }

        // Resource reconciliation — terminate excess machines, pause schedules.
        // Runs after tier has flipped to free so getTierResourceLimits sees
        // the post-cancel state.
        try {
          const { reconcileForTierChange } = await import(
            "@/lib/services/tier-reconciler"
          )
          const reconcileResult = await reconcileForTierChange({
            supabase,
            userId: resolvedUserId,
            newTier: "free",
            reason: "subscription_canceled",
          })
          console.log(
            `subscription.deleted: reconciled user=${resolvedUserId} machines={terminated:${reconcileResult.machinesTerminated}, deferred:${reconcileResult.machinesDeferred}, failed:${reconcileResult.machinesFailedToTerminate}} schedules={paused:${reconcileResult.schedulesPaused}}`
          )
        } catch (reconcileError) {
          console.error(
            `subscription.deleted: reconciliation failed for user=${resolvedUserId}:`,
            reconcileError
          )
        }

        console.log(`Subscription canceled: ${subscription.id}`)
        break
      }

      // Handle invoice payment (monthly renewal)
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as any
        
        // Skip the first invoice (handled by checkout.session.completed)
        if (invoice.billing_reason === "subscription_create") {
          console.log("Skipping first invoice - handled by checkout.session.completed")
          break
        }

        const subscriptionId = invoice.subscription as string
        let subscription = await stripe.subscriptions.retrieve(subscriptionId) as any
        const userId = subscription.metadata?.user_id
        const tier = subscription.metadata?.tier

        if (!userId || !tier) {
          console.error("Missing user_id or tier in subscription metadata")
          break
        }

        // Get the plan
        const { data: plan } = await supabase
          .from("subscription_plans")
          .select("monthly_credits")
          .eq("tier", tier)
          .single()

        if (!plan) {
          console.error("Plan not found for tier:", tier)
          break
        }

        // Get the subscription record
        const { data: subRecord } = await supabase
          .from("user_subscriptions")
          .select("id")
          .eq("stripe_subscription_id", subscriptionId)
          .single()

        if (subRecord) {
          // ─── Period derivation with priority-ordered fallback (NEW-4 fix) ───
          // Stripe has a known timing window where the parent subscription's
          // current_period_* fields lag the invoice. Previously we'd `break`
          // on missing timestamps, silently skipping the credit grant. Now we
          // walk a fallback chain and only fail (HTTP 500 → Stripe retries)
          // if every source is exhausted.
          //
          // CRITICAL idempotency requirement: every fallback timestamp MUST be
          // stable across retries so the existingRenewal dedupe check by
          // (user_id, type, subscription_id, created_at∈[periodStart,periodEnd])
          // produces the same result on every delivery. The "now() / now()+30d"
          // pattern from checkout.session.completed is NEVER acceptable here.
          const toIso = (epoch: number | null | undefined): string | null => {
            if (!epoch || typeof epoch !== "number") return null
            try {
              return new Date(epoch * 1000).toISOString()
            } catch {
              return null
            }
          }

          let periodStart: string | null = null
          let periodEnd: string | null = null
          let periodSource: string = "none"

          // (a) Primary: subscription.current_period_*
          periodStart = toIso(subscription.current_period_start)
          periodEnd = toIso(subscription.current_period_end)
          if (periodStart && periodEnd) {
            periodSource = "subscription_period"
            console.log(
              `webhook.invoice.fallback.subscription_period subscription=${subscriptionId} invoice=${invoice.id}`
            )
          } else {
            // (b) Line item period — almost always present on invoice lines.
            //     Stable across retries (the invoice is immutable).
            const linePeriod = invoice?.lines?.data?.[0]?.period
            const lineStart = toIso(linePeriod?.start)
            const lineEnd = toIso(linePeriod?.end)
            if (lineStart && lineEnd) {
              periodStart = lineStart
              periodEnd = lineEnd
              periodSource = "line_period"
              console.log(
                `webhook.invoice.fallback.line_period subscription=${subscriptionId} invoice=${invoice.id} reason=subscription_period_missing`
              )
            } else {
              // (c) Top-level invoice.period_start / invoice.period_end
              const invStart = toIso(invoice.period_start)
              const invEnd = toIso(invoice.period_end)
              if (invStart && invEnd) {
                periodStart = invStart
                periodEnd = invEnd
                periodSource = "invoice_period"
                console.log(
                  `webhook.invoice.fallback.invoice_period subscription=${subscriptionId} invoice=${invoice.id} reason=line_period_missing`
                )
              } else {
                // (d) Last-resort: re-fetch the subscription once. The first
                //     retrieve may have hit a stale/cached read replica.
                console.log(
                  `webhook.invoice.fallback.refetch subscription=${subscriptionId} invoice=${invoice.id} reason=all_invoice_periods_missing`
                )
                try {
                  subscription = await stripe.subscriptions.retrieve(
                    subscriptionId,
                    { expand: ["items.data.price"] }
                  ) as any
                  periodStart = toIso(subscription.current_period_start)
                  periodEnd = toIso(subscription.current_period_end)
                  if (periodStart && periodEnd) {
                    periodSource = "refetch"
                  }
                } catch (refetchErr) {
                  console.error(
                    `webhook.invoice.fallback.refetch failed for ${subscriptionId}:`,
                    refetchErr
                  )
                }
              }
            }
          }

          if (!periodStart || !periodEnd) {
            // All paths exhausted. Return 500 so Stripe retries the webhook
            // instead of silently swallowing the renewal credit grant.
            console.error(
              `webhook.invoice.fallback.exhausted subscription=${subscriptionId} invoice=${invoice.id} — returning 500 for Stripe to retry`
            )
            outResponse = NextResponse.json(
              {
                error: "Unable to derive billing period for renewal",
                subscription_id: subscriptionId,
                invoice_id: invoice.id,
              },
              { status: 500 }
            )
            return outResponse
          }

          console.log(
            `Renewal billing period resolved via ${periodSource}: ${periodStart} → ${periodEnd}`
          )

          // Check if we've already granted credits for this billing period
          const { data: existingRenewal } = await (supabase as any)
            .from("credit_transactions")
            .select("id")
            .eq("user_id", userId)
            .eq("type", "subscription_renewal")
            .eq("subscription_id", subRecord.id)
            .gte("created_at", periodStart)
            .lte("created_at", periodEnd)
            .single()
          
          if (existingRenewal) {
            console.log(`Credits already granted for this billing period (${periodStart} to ${periodEnd}), skipping`)
            break
          }

          // Atomic + idempotent renewal grant via migration 014 RPC.
          // Replaces the legacy SELECT/UPDATE/INSERT triple that lost
          // concurrent updates between replicas.  The RPC's dedup is
          // keyed on (subscription_id, billing_period_start) and uses
          // a UNIQUE constraint, so concurrent webhook deliveries land
          // on the same row.  Belt-and-braces: the existingRenewal
          // short-circuit above remains as application-level dedup.
          const { data: rpcRows, error: rpcError } = await (supabase as any).rpc(
            "grant_subscription_credits_atomic",
            {
              p_user_id: userId,
              p_subscription_id: subRecord.id,
              p_credits: plan.monthly_credits,
              p_period_start: periodStart,
              p_period_end: periodEnd,
              p_invoice_id: invoice.id,
              p_transaction_type: "subscription_renewal",
              p_usage_description: `Monthly ${tier} subscription renewal`,
              p_metadata: {
                tier: tier,
                period_start: periodStart,
                period_end: periodEnd,
                stripe_subscription_id: subscriptionId,
                invoice_id: invoice.id
              },
            }
          )

          if (rpcError) {
            console.error("grant_subscription_credits_atomic (renewal) failed:", rpcError)
          } else {
            const result = Array.isArray(rpcRows) ? rpcRows[0] : (rpcRows as any)
            if (result?.was_granted) {
              console.log(
                `Monthly renewal: Atomically added ${plan.monthly_credits} credits for user ${userId}, new balance: ${result?.new_balance}`
              )
            } else {
              console.log(
                `Monthly renewal: subscription ${subscriptionId} period ${periodStart} already granted (RPC dedup); skipping`
              )
            }
          }

          // RPC function removed - we handle everything directly above
        } else {
          console.error(`Subscription record not found for Stripe ID: ${subscriptionId}`)
        }
        break
      }

      // Handle failed payments
      case "invoice.payment_failed": {
        const invoice = event.data.object as any
        const subscriptionId = invoice.subscription as string
        
        await (supabase as any)
          .from("user_subscriptions")
          .update({
            status: "past_due",
          })
          .eq("stripe_subscription_id", subscriptionId)

        console.log(`Payment failed for subscription: ${subscriptionId}`)
        break
      }

      // Handle regular credit purchases (moved to function)
      case "payment_intent.succeeded": {
        // Handled by checkout.session.completed for one-time purchases
        break
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        console.error("Payment failed:", paymentIntent.id)

        // If this was an auto-refill charge, disable auto-refill to prevent repeated failures
        if (paymentIntent.metadata?.type === "auto_refill" && paymentIntent.metadata?.user_id) {
          await supabase
            .from("auto_refill_settings")
            .update({ enabled: false, updated_at: new Date().toISOString() })
            .eq("user_id", paymentIntent.metadata.user_id)

          console.log(`Auto-refill disabled for user ${paymentIntent.metadata.user_id} due to payment failure`)
        }
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    // Mark event as processed
    await supabase
      .from("stripe_events")
      .update({
        processed: true,
        processed_at: new Date().toISOString(),
      })
      .eq("id", event.id)

    outResponse = NextResponse.json({ received: true })
    return outResponse
  } catch (error) {
    // Webhook processing error occurred
    outResponse = NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    )
    return outResponse
  } finally {
    // Unified access-log line. The `event_type` extra is critical for
    // distinguishing the Stripe webhook retry source — without it
    // CloudWatch can't tell whether the 500s are concentrated on
    // checkout.session.completed (init flow) or invoice.payment_succeeded
    // (renewal flow).
    logApiAccess(req, outResponse?.status ?? 500, Date.now() - t_start, {
      event_type: webhookEventType,
    })
  }
}