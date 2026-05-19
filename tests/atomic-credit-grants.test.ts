/**
 * Tests for migration 014 + webhook atomic-RPC migration.
 *
 * Background: 2026-05-06 cross-replica audit. The Stripe webhook had 7
 * distinct sites following the lost-update / SELECT-then-INSERT race
 * pattern. Concurrent webhook deliveries (Stripe retry hitting a different
 * replica from the original) could:
 *   - double-grant credits (lost-update on `balance`)
 *   - write contradictory credit_transactions rows
 *   - bypass dedup checks that read user_credits or credit_transactions
 *
 * The fix is migration 014 (`grant_subscription_credits_atomic` and
 * `add_credits_atomic` RPCs + UNIQUE constraints on the dedup keys) and
 * a webhook rewrite that calls the RPCs instead of the manual triple.
 *
 * These tests are SOURCE-LEVEL anti-drift checks. They read the deployed
 * SQL + TypeScript and assert the fix's distinctive markers are present.
 * Concurrent-delivery semantics are verified at the SQL level by the
 * UNIQUE constraints; here we just check the wiring is correct.
 *
 * Run: `npx vitest run tests/atomic-credit-grants.test.ts`
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "..");

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf-8");
}


// ═══════════════════════════════════════════════════════════════════════════
// Migration 014 — RPCs + dedup constraints
// ═══════════════════════════════════════════════════════════════════════════

describe("Migration 014: atomic credit grants", () => {
  const sql = readSrc("supabase/migrations/014_atomic_credit_grants.sql");

  it("file exists with the expected migration name", () => {
    expect(sql.length).toBeGreaterThan(500);
  });

  it("creates UNIQUE constraint on subscription_credit_grants(subscription_id, billing_period_start)", () => {
    // The existing schema has only id PK; without this UNIQUE the dedup
    // table cannot enforce concurrent-INSERT idempotency. Two replicas
    // would both pass the EXISTS check inside the RPC and both write
    // their grants.
    expect(sql).toMatch(
      /CONSTRAINT subscription_credit_grants_period_unique[\s\S]*?UNIQUE \(subscription_id, billing_period_start\)/
    );
  });

  it("creates partial UNIQUE index on credit_transactions(stripe_payment_intent_id)", () => {
    // Auto-refill retries can re-INSERT the same PaymentIntent's transaction
    // row. Partial unique (WHERE NOT NULL) lets existing NULL rows
    // (subscription grants etc.) coexist.
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX credit_transactions_stripe_pi_unique[\s\S]*?WHERE stripe_payment_intent_id IS NOT NULL/
    );
  });

  it("constraint creation is idempotent (DO $$ + EXCEPTION WHEN duplicate_object)", () => {
    // Re-running the migration must not fail. The DO blocks swallow
    // duplicate_object so terraform applies are safe to re-run.
    const blocks = sql.match(/DO \$\$ BEGIN[\s\S]*?WHEN duplicate_object THEN NULL/g);
    expect(blocks?.length).toBeGreaterThanOrEqual(1);
  });

  it("defines add_credits_atomic with FOR UPDATE row lock", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.add_credits_atomic/);
    // The body must take a row-level lock — without FOR UPDATE, two
    // replicas could both increment the same balance.
    const fnIdx = sql.indexOf("CREATE OR REPLACE FUNCTION public.add_credits_atomic");
    const next = sql.indexOf("CREATE OR REPLACE FUNCTION", fnIdx + 10);
    const fnBody = sql.slice(fnIdx, next === -1 ? sql.length : next);
    expect(fnBody).toMatch(/FOR UPDATE/);
  });

  it("add_credits_atomic returns (new_balance, new_total_purchased)", () => {
    expect(sql).toMatch(
      /add_credits_atomic[\s\S]*?RETURNS TABLE\(new_balance integer, new_total_purchased integer\)/
    );
  });

  it("add_credits_atomic rejects non-positive amounts", () => {
    // Defensive — prevents accidental balance corruption from a buggy caller.
    // (Negative amounts would mean a deduct, which is a different RPC.)
    const fnIdx = sql.indexOf("CREATE OR REPLACE FUNCTION public.add_credits_atomic");
    const next = sql.indexOf("CREATE OR REPLACE FUNCTION", fnIdx + 10);
    const fnBody = sql.slice(fnIdx, next === -1 ? sql.length : next);
    expect(fnBody).toMatch(/p_amount IS NULL OR p_amount <= 0/);
    expect(fnBody).toMatch(/RAISE EXCEPTION.*add_credits_atomic.*p_amount must be > 0/);
  });

  it("defines grant_subscription_credits_atomic with FOR UPDATE row lock", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.grant_subscription_credits_atomic/
    );
    const fnIdx = sql.indexOf("CREATE OR REPLACE FUNCTION public.grant_subscription_credits_atomic");
    const tail = sql.slice(fnIdx);
    expect(tail).toMatch(/FOR UPDATE/);
  });

  it("grant_subscription_credits_atomic catches unique_violation explicitly", () => {
    // The whole point of the RPC: if two replicas race past the EXISTS
    // check, the INSERT into subscription_credit_grants must hit the
    // UNIQUE constraint and we must catch it cleanly to return
    // was_granted=false. Without the EXCEPTION WHEN unique_violation
    // block, the RPC would propagate the error to the caller (a
    // misleading 500 instead of an idempotent skip).
    const fnIdx = sql.indexOf("CREATE OR REPLACE FUNCTION public.grant_subscription_credits_atomic");
    const tail = sql.slice(fnIdx);
    expect(tail).toMatch(/EXCEPTION[\s\S]*?WHEN unique_violation THEN/);
  });

  it("grant_subscription_credits_atomic returns (was_granted, new_balance)", () => {
    expect(sql).toMatch(
      /grant_subscription_credits_atomic[\s\S]*?RETURNS TABLE\(was_granted boolean, new_balance integer\)/
    );
  });

  it("grant_subscription_credits_atomic uses balance_after = post-update balance", () => {
    // Pre-fix, the webhook's manual INSERT used the JS-computed
    // balance_after, which could be wrong if a concurrent transaction
    // landed between the SELECT and the UPDATE. The RPC's RETURNING
    // clause guarantees `v_balance` is the actual post-update balance.
    const fnIdx = sql.indexOf("CREATE OR REPLACE FUNCTION public.grant_subscription_credits_atomic");
    const tail = sql.slice(fnIdx);
    // After UPDATE we use RETURNING balance INTO v_balance, then INSERT
    // credit_transactions with balance_after = v_balance.
    expect(tail).toMatch(/RETURNING balance INTO v_balance/);
    expect(tail).toMatch(/INSERT INTO credit_transactions[\s\S]*?balance_after[\s\S]*?v_balance/);
  });

  it("grants EXECUTE to service_role (so the webhook can invoke via supabase client)", () => {
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.add_credits_atomic\(uuid, integer\) TO service_role/
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.grant_subscription_credits_atomic[\s\S]*?TO service_role/
    );
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Webhook source — all 7 lost-update sites replaced with RPC calls
// ═══════════════════════════════════════════════════════════════════════════

describe("Webhook: 7 lost-update sites migrated to atomic RPC", () => {
  const src = readSrc("app/api/credits/webhook/route.ts");

  it("does NOT contain the pre-fix `(currentCredits.balance || 0) + plan.monthly_credits` pattern", () => {
    // This was the lost-update arithmetic: SELECT balance → JS-computed
    // newBalance → UPDATE balance. Concurrent webhook deliveries to
    // different replicas would both read same balance, both add same
    // credits, one update lost.
    expect(src).not.toMatch(/\(currentCredits\.balance \|\| 0\) \+ plan\.monthly_credits/);
    expect(src).not.toMatch(/\(existingCredits\.balance \|\| 0\) \+ plan\.monthly_credits/);
  });

  it("does NOT contain the pre-fix `currentCredits.balance + credits` pattern (handleCreditPurchase)", () => {
    expect(src).not.toMatch(/currentCredits\.balance \+ credits/);
  });

  it("calls grant_subscription_credits_atomic at all 3 subscription paths", () => {
    // 1. checkout.session.completed initial grant
    // 2. customer.subscription.created reactivation
    // 3. invoice.payment_succeeded monthly renewal
    const matches = src.match(/grant_subscription_credits_atomic/g);
    expect(matches).not.toBeNull();
    // 1 RPC name, 3 invocations (one per path) + the comments referencing
    // it. Lower bound 3 ensures all paths are wired.
    expect(matches!.length).toBeGreaterThanOrEqual(3);
  });

  it("calls add_credits_atomic in handleCreditPurchase", () => {
    // One-time credit purchases use the simpler atomic-increment RPC
    // (no period dedup table — relies on credit_transactions.stripe_payment_intent_id
    // partial UNIQUE for idempotency).
    expect(src).toMatch(/add_credits_atomic/);
  });

  it("each RPC invocation passes the required p_period_start parameter", () => {
    // Pre-fix the dedup was on credit_transactions, which has no period
    // column. Now the dedup is on subscription_credit_grants
    // (subscription_id, billing_period_start). p_period_start MUST be
    // passed and consistent across replicas for the lock to actually
    // dedupe.
    const rpcCalls = src.match(/grant_subscription_credits_atomic[\s\S]*?p_period_start[\s\S]*?\}/g);
    expect(rpcCalls).not.toBeNull();
    expect(rpcCalls!.length).toBeGreaterThanOrEqual(3);
  });

  it("checks `was_granted` to avoid logging a duplicate grant message", () => {
    // The new code branches on the RPC's was_granted return value to log
    // either "Atomically added N credits" or "already granted". A pre-fix
    // bug logged "Updated user balance" unconditionally, even when
    // existingGrant was non-null.
    expect(src).toMatch(/result\?\.was_granted/);
  });

  it("handleCreditPurchase catches 23505 on credit_transactions insert (PaymentIntent retry)", () => {
    // The partial UNIQUE on stripe_payment_intent_id means a retry of the
    // same checkout session fails with 23505 on the credit_transactions
    // INSERT. Without the catch, that 23505 surfaces as a 500 to Stripe
    // and triggers more retries.
    expect(src).toMatch(/code === ['"]23505['"][\s\S]*?already recorded/);
  });

  it("handleCreditPurchase compensates by subtracting on duplicate-insert race", () => {
    // If the second replica increments the balance AND then sees 23505
    // on the transaction insert, it must subtract back the duplicate
    // increment. Otherwise balance > sum of transactions.
    expect(src).toMatch(
      /add_credits_atomic[\s\S]*?p_amount: -credits/
    );
  });

  it("preserves stripe_events upsert atomic gate at the top of the handler", () => {
    // Independent of migration 014: the existing stripe_events PK
    // dedup must still be the FIRST gate. Without it, a Stripe
    // delivery retry of the SAME event.id would re-enter all the
    // handler bodies.
    expect(src).toMatch(/from\("stripe_events"\)[\s\S]*?upsert/);
    expect(src).toMatch(/onConflict:\s*["']id["'][\s\S]*?ignoreDuplicates:\s*true/);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Auto-refill source — uses the now-existing add_credits_atomic
// ═══════════════════════════════════════════════════════════════════════════

describe("auto-refill/execute: uses the now-existing add_credits_atomic", () => {
  const src = readSrc("app/api/credits/auto-refill/execute/route.ts");

  it("still calls add_credits_atomic (the call existed before; migration 014 makes the RPC actually exist)", () => {
    expect(src).toMatch(/\.rpc\(["']add_credits_atomic["']/);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Referral + run-feedback awardCredits — P0 lost-update fix
// ═══════════════════════════════════════════════════════════════════════════

describe("awardCredits helpers (referral + run-feedback)", () => {
  for (const file of [
    "app/api/referral/claim/route.ts",
    "app/api/feedback/run/route.ts",
  ] as const) {
    describe(file, () => {
      const src = readSrc(file);

      it("uses add_credits_atomic instead of SELECT-then-UPDATE balance", () => {
        // Pre-fix the helper did:
        //   SELECT balance → newBalance = balance + amount → UPDATE
        // which loses concurrent increments. Now it must call the RPC.
        expect(src).toMatch(/add_credits_atomic/);
      });

      it("does NOT contain the pre-fix `existing.balance + amount` arithmetic", () => {
        expect(src).not.toMatch(/existing\.balance \+ amount/);
      });

      it("does NOT call .update on user_credits with a JS-computed newBalance", () => {
        // Block the regression where someone re-introduces the manual
        // arithmetic+update pair.
        expect(src).not.toMatch(
          /\.update\(\{\s*balance:\s*newBalance/
        );
      });

      it("still INSERTs into credit_transactions with balance_after = post-RPC balance", () => {
        expect(src).toMatch(/credit_transactions[\s\S]*?balance_after/);
      });
    });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// Cross-fix integration: all 4 generations of credit-grant fixes coexist
// ═══════════════════════════════════════════════════════════════════════════

describe("Cross-fix integration", () => {
  it("migration 012 (auto_blog_runs), 013 (cron_runs), 014 (atomic credits) all exist", () => {
    for (const fname of [
      "012_auto_blog_runs.sql",
      "013_cron_runs.sql",
      "014_atomic_credit_grants.sql",
    ]) {
      const p = path.join(REPO_ROOT, "supabase", "migrations", fname);
      expect(fs.existsSync(p), `missing: ${fname}`).toBe(true);
    }
  });

  it("all 3 generations describe their cross-replica race-prevention rationale", () => {
    // Each migration's header should mention the production incident or
    // the race shape it closes. Anti-drift: if a future PR strips the
    // commentary, it loses the "why" and a future engineer might revert
    // the unique constraint or RPC.
    const m012 = readSrc("supabase/migrations/012_auto_blog_runs.sql");
    const m013 = readSrc("supabase/migrations/013_cron_runs.sql");
    const m014 = readSrc("supabase/migrations/014_atomic_credit_grants.sql");

    expect(m012).toMatch(/PRIMARY KEY|cross-replica|race/i);
    expect(m013).toMatch(/PRIMARY KEY|cross-replica|race/i);
    expect(m014).toMatch(/lost-update|race|atomic/i);
  });
});
