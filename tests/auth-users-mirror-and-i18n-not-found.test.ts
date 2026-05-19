/**
 * Tests for two production frontend bugs surfaced at 2026-05-11T15:22:31Z
 * and 2026-05-11T15:22:40Z respectively:
 *
 *   1. `code: 23503` FK violations on `user_credits_user_id_fkey` — a
 *      brand-new auth user hit `/api/credits/balance` before the
 *      `public.users` mirror row was provisioned. 8+ rapid-fire errors
 *      per signup, 84 in the prior 24 h.
 *
 *   2. `MISSING_MESSAGE: errorPages.notFound.*` for `(zh)` locale (and
 *      28 others) — the en.json `errorPages.notFound` namespace had
 *      grown with new keys (`metaTitle`, `log.*`, `links.*`,
 *      `primaryCta`, `secondaryCta`, `navLabel`) but translations were
 *      never backfilled. Every non-English visitor hitting the 404
 *      page produced ~17 server-side errors and a partially-broken UI.
 *
 * Fixes:
 *   - supabase/migrations/018_auth_users_mirror_trigger.sql:
 *       (A) AFTER INSERT trigger on auth.users → public.users mirror
 *       (B) Backfill for existing missing rows
 *       (C) Self-healing get_or_create_user_credits as defence-in-depth
 *   - messages/*.json: 18 missing keys filled across 29 locales (522
 *     translations total), with hand-curated translations for the
 *     major locales and English fallback for the rest.
 *
 * Run: `npx vitest run tests/auth-users-mirror-and-i18n-not-found.test.ts`
 */

import { describe, it, expect, beforeAll } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"

const REPO_ROOT = path.resolve(__dirname, "..")

// ═══════════════════════════════════════════════════════════════════════════
// 1.  Migration 018 — source-level guards.
//     We can't run the SQL here (no live Postgres) but we can assert
//     every load-bearing clause exists. A revert that strips any of
//     these will trigger the test before it ships.
// ═══════════════════════════════════════════════════════════════════════════

describe("Migration 018 — auth.users → public.users mirror", () => {
  let sql: string

  beforeAll(() => {
    sql = fs.readFileSync(
      path.join(REPO_ROOT, "supabase", "migrations", "018_auth_users_mirror_trigger.sql"),
      "utf8",
    )
  })

  it("file exists and is non-trivial", () => {
    expect(sql.length).toBeGreaterThan(1000)
  })

  // ── Layer A: trigger ───────────────────────────────────────────────────

  it("defines handle_new_auth_user() as SECURITY DEFINER", () => {
    // Without SECURITY DEFINER the trigger function can't INSERT into
    // public.users when the originating role is `authenticator` (the
    // role auth.users INSERT runs as in Supabase managed-auth).
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.handle_new_auth_user\(\)/)
    expect(sql).toMatch(/SECURITY DEFINER/)
  })

  it("trigger function sets search_path (anti-search-path-attack)", () => {
    // SECURITY DEFINER functions without an explicit search_path can
    // be exploited if a user creates a malicious table/function in
    // public that shadows ones the definer expects. Always set
    // search_path on SECURITY DEFINER bodies.
    expect(sql).toMatch(/SET search_path\s*=\s*public,\s*pg_temp/)
  })

  it("CREATE TRIGGER on_auth_user_created on auth.users AFTER INSERT", () => {
    expect(sql).toMatch(/CREATE TRIGGER on_auth_user_created/)
    expect(sql).toMatch(/AFTER INSERT ON auth\.users/)
    expect(sql).toMatch(/EXECUTE FUNCTION public\.handle_new_auth_user\(\)/)
  })

  it("DROP TRIGGER IF EXISTS makes migration re-runnable", () => {
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS on_auth_user_created ON auth\.users/)
  })

  it("trigger uses ON CONFLICT (id) DO NOTHING (idempotent)", () => {
    // Re-signin shouldn't fail; explicit signup-flow upserts can race
    // the trigger; the backfill below must also coexist.
    expect(sql).toMatch(/ON CONFLICT \(id\)\s+DO NOTHING/)
  })

  it("trigger captures display_name from common OAuth provider fields", () => {
    // Google, GitHub, Microsoft, etc. all put the name under different
    // keys — the COALESCE chain must cover the common variants.
    expect(sql).toMatch(/raw_user_meta_data\s*->>\s*'full_name'/)
    expect(sql).toMatch(/raw_user_meta_data\s*->>\s*'name'/)
  })

  it("trigger captures avatar from common OAuth provider fields", () => {
    expect(sql).toMatch(/raw_user_meta_data\s*->>\s*'avatar_url'/)
    expect(sql).toMatch(/raw_user_meta_data\s*->>\s*'picture'/)
  })

  it("trigger preserves empty strings as NULL (cleaner DB state)", () => {
    expect(sql).toMatch(/NULLIF\s*\(\s*COALESCE/)
  })

  // ── Layer B: backfill ─────────────────────────────────────────────────

  it("backfill is present and uses NOT EXISTS to find missing rows", () => {
    expect(sql).toMatch(/INSERT INTO public\.users[\s\S]+SELECT[\s\S]+FROM auth\.users/)
    expect(sql).toMatch(/WHERE NOT EXISTS \(\s*SELECT 1 FROM public\.users/)
  })

  it("backfill uses ON CONFLICT DO NOTHING (idempotent re-run)", () => {
    // Count `ON CONFLICT (id) DO NOTHING` occurrences — should be
    // at LEAST 3: trigger body + backfill + self-healing RPC body.
    const matches = sql.match(/ON CONFLICT \(id\)\s+DO NOTHING/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(3)
  })

  // ── Layer C: self-healing RPC ─────────────────────────────────────────

  it("get_or_create_user_credits is replaced with self-healing version", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.get_or_create_user_credits\s*\(/,
    )
  })

  it("RPC upserts public.users from auth.users BEFORE the credits insert", () => {
    // The fix sequence inside the RPC body. We assert by source-order:
    // the `IF NOT EXISTS (SELECT 1 FROM public.users)` upsert block
    // appears BEFORE the `INSERT INTO user_credits` line. Scope the
    // search to the RPC body (after `CREATE OR REPLACE FUNCTION
    // public.get_or_create_user_credits`) so the docstring's
    // explanatory mention of the legacy `INSERT INTO user_credits`
    // doesn't false-match as the "first" insert.
    const rpcStart = sql.indexOf(
      "CREATE OR REPLACE FUNCTION public.get_or_create_user_credits",
    )
    expect(rpcStart).toBeGreaterThan(-1)
    const body = sql.slice(rpcStart)
    const upsertIdx = body.indexOf(
      "IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id)",
    )
    const creditsInsertIdx = body.indexOf("INSERT INTO user_credits (user_id, balance)")
    expect(upsertIdx).toBeGreaterThan(-1)
    expect(creditsInsertIdx).toBeGreaterThan(-1)
    expect(upsertIdx).toBeLessThan(creditsInsertIdx)
  })

  it("RPC is SECURITY DEFINER so it can read auth.users", () => {
    // The RPC needs to SELECT from auth.users (a privileged schema) to
    // copy email/display_name into public.users during self-heal.
    // Find the get_or_create_user_credits definition block and ensure
    // SECURITY DEFINER appears within it.
    const start = sql.indexOf(
      "CREATE OR REPLACE FUNCTION public.get_or_create_user_credits",
    )
    const end = sql.indexOf("ALTER FUNCTION public.get_or_create_user_credits", start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const body = sql.slice(start, end)
    expect(body).toMatch(/SECURITY DEFINER/)
    expect(body).toMatch(/SET search_path\s*=\s*public,\s*pg_temp/)
  })

  it("RPC retains the original subscription-status update logic", () => {
    // Regression guard — the self-heal layer added at the top must
    // not have replaced the unchanged subscription-status update
    // that follows.
    expect(sql).toMatch(/UPDATE user_credits uc/)
    expect(sql).toMatch(/has_active_subscription = EXISTS/)
    expect(sql).toMatch(/subscription_tier =/)
  })

  it("grants execute on the new RPC to anon, authenticated, service_role", () => {
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_or_create_user_credits\(uuid\) TO anon/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_or_create_user_credits\(uuid\) TO authenticated/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_or_create_user_credits\(uuid\) TO service_role/)
  })

  it("NOTIFY pgrst, 'reload schema' so the API picks up the change immediately", () => {
    expect(sql).toMatch(/NOTIFY pgrst,\s*'reload schema'/)
  })

  // ── Documentation guard ───────────────────────────────────────────────

  it("references the 2026-05-11 production audit / 23503 FK incident", () => {
    expect(sql).toMatch(/2026-05-11|23503|FK violation/i)
  })

  it("explains the chain of root causes (anti-drift)", () => {
    expect(sql).toMatch(/auth\.users.*public\.users/)
    expect(sql).toMatch(/foreign key|user_credits_user_id_fkey/i)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2.  i18n backfill — every locale must now have a complete
//     errorPages.notFound namespace with all 20 leaf keys.
// ═══════════════════════════════════════════════════════════════════════════

const REQUIRED_TOP_KEYS = [
  "title", "description", "metaTitle", "metaDescription",
  "log", "ok", "fail", "primaryCta", "secondaryCta",
  "navLabel", "links",
] as const

const REQUIRED_LOG_KEYS = ["command", "step1", "step2", "step3", "result"] as const
const REQUIRED_LINK_KEYS = [
  "home", "computerUse", "pricing", "download", "blog", "guide",
] as const

function loadMessages(locale: string): any {
  const p = path.join(REPO_ROOT, "messages", `${locale}.json`)
  return JSON.parse(fs.readFileSync(p, "utf8"))
}

function listLocales(): string[] {
  return fs
    .readdirSync(path.join(REPO_ROOT, "messages"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
}

describe("i18n backfill — errorPages.notFound completeness across locales", () => {
  const locales = listLocales()

  it("at least 30 locales present (sanity)", () => {
    expect(locales.length).toBeGreaterThanOrEqual(30)
  })

  it("includes Chinese (zh) — the locale that triggered the audit", () => {
    expect(locales).toContain("zh")
  })

  // Generate one test per locale so failures attribute precisely.
  for (const locale of locales) {
    describe(`locale ${locale}`, () => {
      let messages: any
      let nf: any

      beforeAll(() => {
        messages = loadMessages(locale)
        nf = messages?.errorPages?.notFound
      })

      it("has errorPages.notFound namespace", () => {
        expect(nf).toBeTruthy()
        expect(typeof nf).toBe("object")
      })

      it("has all required top-level keys", () => {
        for (const key of REQUIRED_TOP_KEYS) {
          expect(nf[key], `${locale}.errorPages.notFound.${key} missing`).toBeTruthy()
        }
      })

      it("has all log.* keys (command, step1, step2, step3, result)", () => {
        expect(typeof nf.log).toBe("object")
        for (const key of REQUIRED_LOG_KEYS) {
          expect(nf.log[key], `${locale}.errorPages.notFound.log.${key} missing`).toBeTruthy()
        }
      })

      it("has all links.* keys", () => {
        expect(typeof nf.links).toBe("object")
        for (const key of REQUIRED_LINK_KEYS) {
          expect(
            nf.links[key],
            `${locale}.errorPages.notFound.links.${key} missing`,
          ).toBeTruthy()
        }
      })

      it("no value is an empty string (would render as blank in the UI)", () => {
        for (const key of REQUIRED_TOP_KEYS) {
          if (typeof nf[key] === "string") {
            expect(nf[key].length, `${locale}.${key} is empty`).toBeGreaterThan(0)
          }
        }
        for (const key of REQUIRED_LOG_KEYS) {
          expect(nf.log[key].length, `${locale}.log.${key} is empty`).toBeGreaterThan(0)
        }
        for (const key of REQUIRED_LINK_KEYS) {
          expect(
            nf.links[key].length,
            `${locale}.links.${key} is empty`,
          ).toBeGreaterThan(0)
        }
      })
    })
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// 3.  Chinese-specific spot check — the locale that triggered the audit.
// ═══════════════════════════════════════════════════════════════════════════

describe("Chinese (zh) locale — audit-triggered spot check", () => {
  let zh: any
  let nf: any

  beforeAll(() => {
    zh = loadMessages("zh")
    nf = zh.errorPages.notFound
  })

  it("title contains Chinese characters (not English fallback)", () => {
    // Codepoint check: title should be primarily CJK Unified Ideographs.
    const cjk = (nf.title.match(/[一-鿿]/g) ?? []).length
    expect(cjk).toBeGreaterThanOrEqual(3)
  })

  it("specific key the audit found missing (errorPages.notFound.ok) is now present", () => {
    // From the production log: `MISSING_MESSAGE: errorPages.notFound.ok (zh)`
    expect(nf.ok).toBeTruthy()
    expect(typeof nf.ok).toBe("string")
  })

  it("links.home is the Chinese 'home' translation", () => {
    // Spot-check: the value should contain at least one CJK character.
    const cjk = (nf.links.home.match(/[一-鿿]/g) ?? []).length
    expect(cjk).toBeGreaterThanOrEqual(1)
  })

  it("primaryCta and secondaryCta are present (audit found both missing)", () => {
    expect(nf.primaryCta).toBeTruthy()
    expect(nf.secondaryCta).toBeTruthy()
  })

  it("all log.step* keys are present (audit found all 4 missing)", () => {
    expect(nf.log.command).toBeTruthy()
    expect(nf.log.step1).toBeTruthy()
    expect(nf.log.step2).toBeTruthy()
    expect(nf.log.step3).toBeTruthy()
    expect(nf.log.result).toBeTruthy()
  })

  it("all links.* keys are present (audit found 6 missing)", () => {
    for (const k of REQUIRED_LINK_KEYS) {
      expect(nf.links[k]).toBeTruthy()
    }
  })

  it("preserves the original Chinese title from the pre-fix translation", () => {
    // The backfill must NOT overwrite the already-translated title.
    // Original zh.json had: "404 – 页面未找到"
    expect(nf.title).toContain("404")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4.  Translation-quality guards on the 5 major non-Latin scripts.
//
// (The original backfill helper script was a one-shot tool and isn't
// tracked in the repo. The committed JSON files in messages/*.json are
// the source-of-truth; suites 2 + 3 above already prove every locale's
// errorPages.notFound is complete. This block adds a deeper quality
// check: ZH/JA/KO/AR/HE values must NOT be English fallthroughs — i.e.
// they must contain at least one character in the locale's expected
// script range. This catches a future locale-addition that forgets to
// translate and silently ships English to non-Latin users.)
// ═══════════════════════════════════════════════════════════════════════════

describe("translation quality — non-Latin locales contain native script", () => {
  // For each (locale, expected-script-regex), spot-check 4 keys that
  // any reasonable translation must localise. Avoids over-asserting on
  // OK/FAIL which are loanwords in many languages.
  const TRANSLATED_LOCALES = [
    { locale: "zh", scriptRe: /[一-鿿]/, name: "CJK Unified Ideographs" },
    { locale: "ja", scriptRe: /[぀-ゟ゠-ヿ一-鿿]/, name: "Hiragana/Katakana/Kanji" },
    { locale: "ko", scriptRe: /[가-힯]/, name: "Hangul Syllables" },
    { locale: "ar", scriptRe: /[؀-ۿ]/, name: "Arabic" },
    { locale: "he", scriptRe: /[֐-׿]/, name: "Hebrew" },
  ]

  for (const { locale, scriptRe, name } of TRANSLATED_LOCALES) {
    describe(`${locale} (${name})`, () => {
      let nf: any
      beforeAll(() => {
        nf = loadMessages(locale).errorPages.notFound
      })

      it("title is translated (contains native script)", () => {
        expect(
          nf.title.match(scriptRe),
          `${locale}.title appears to be English fallthrough: ${JSON.stringify(nf.title)}`,
        ).toBeTruthy()
      })

      it("description is translated", () => {
        expect(nf.description.match(scriptRe)).toBeTruthy()
      })

      it("primaryCta is translated", () => {
        expect(nf.primaryCta.match(scriptRe)).toBeTruthy()
      })

      it("links.home is translated", () => {
        expect(nf.links.home.match(scriptRe)).toBeTruthy()
      })
    })
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// 5.  Sanity: en.json is unchanged (source-of-truth must not have been
//     edited by the backfill).
// ═══════════════════════════════════════════════════════════════════════════

describe("en.json sanity", () => {
  let en: any
  let nf: any

  beforeAll(() => {
    en = loadMessages("en")
    nf = en.errorPages.notFound
  })

  it("retains the original English title", () => {
    expect(nf.title).toBe("Page not found")
  })

  it("retains the witty log.step3 (under-the-couch joke is load-bearing)", () => {
    expect(nf.log.step3).toContain("couch")
  })
})
