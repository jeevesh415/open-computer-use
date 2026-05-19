#!/usr/bin/env node
/**
 * Locale audit — for each non-English locale, report:
 *   1. Missing keys (would force English fallback at runtime)
 *   2. Keys with values IDENTICAL to en.json (likely untranslated English)
 *
 * Output: human-readable summary + per-locale JSON detail at /tmp/locale-gaps.json
 *
 * Heuristics:
 * - "Brand-like" values are not flagged (single word in Latin script, brand names,
 *   technical acronyms, URLs, file paths, plain numbers, code-like tokens). The
 *   value list contains hand-curated exceptions kept in lowercase for compare.
 * - Strings under MIN_FLAG_LEN chars are not flagged (too noisy).
 * - Strings that look like ICU placeholders only ("{count}", "${value}") are skipped.
 *
 * Run:  node scripts/audit-locales.mjs
 */
import fs from "node:fs"
import path from "node:path"

const MESSAGES_DIR = "messages"
const MIN_FLAG_LEN = 6 // ignore short tokens like "OK", "Yes", "Dashboard" etc.

// Strings that are intentionally identical across locales (brand names,
// technical terms, plan names). When we see these match en, that's correct.
const KNOWN_KEEP_ENGLISH = new Set([
  "Coasty", "Coasty AI", "Coasty Desktop", "Coasty Team",
  "OSWorld", "Devin", "Devin Team", "Devin AI", "OpenAI", "OpenAI Operator",
  "ChatGPT", "ChatGPT Pro", "Anthropic", "Claude", "Claude Computer Use",
  "Manus", "Manus Extended", "Genspark", "Genspark Pro", "Browserbase",
  "Skyvern", "Skyvern Pro", "Lindy", "MCP", "ACU", "REST API",
  "Stripe", "Supabase", "GitHub", "Twitter", "X", "LinkedIn",
  "Free", "Starter", "Plus", "Pro", "Unlimited", "Enterprise",
  "Mac", "Windows", "Linux", "iOS", "Android",
])

function collectLeafKeys(obj, prefix = "") {
  const keys = new Map() // key -> value
  if (obj === null || obj === undefined) return keys
  if (typeof obj === "string") {
    if (prefix) keys.set(prefix, obj)
    return keys
  }
  if (typeof obj !== "object" || Array.isArray(obj)) return keys
  for (const k of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k
    for (const [sk, sv] of collectLeafKeys(obj[k], fullKey)) keys.set(sk, sv)
  }
  return keys
}

function getValue(obj, keyPath) {
  let cur = obj
  for (const p of keyPath.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined
    cur = cur[p]
  }
  return cur
}

function isPlaceholderOnly(s) {
  // Only ICU/template placeholders, no actual translatable text
  const stripped = s.replace(/\{[^}]+\}/g, "").replace(/\$\{[^}]+\}/g, "").trim()
  return stripped.length < 3
}

function isMostlyNonAlpha(s) {
  // Strings that are mostly punctuation/symbols/numbers
  const letters = (s.match(/[A-Za-z]/g) || []).length
  return letters < 5
}

function looksLikeUrlOrPath(s) {
  return /^(https?:\/\/|\/[A-Za-z0-9_-]|[a-z]+\.\w+|@\w+|\w+\.\w+\(|sk-[a-z]+-|npm i|npx |curl )/i.test(s.trim())
}

const en = JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, "en.json"), "utf8"))
const enLeaves = collectLeafKeys(en)
const enKeyCount = enLeaves.size
console.log(`en.json: ${enKeyCount} leaf string keys\n`)

const files = fs.readdirSync(MESSAGES_DIR).filter(f => f.endsWith(".json") && f !== "en.json").sort()

const report = []
const detail = {}

for (const f of files) {
  const locale = f.replace(".json", "")
  const data = JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, f), "utf8"))
  const localeLeaves = collectLeafKeys(data)

  const missing = []
  const englishMatch = []

  for (const [k, enVal] of enLeaves) {
    if (!localeLeaves.has(k)) {
      missing.push(k)
      continue
    }
    const localeVal = localeLeaves.get(k)
    if (typeof enVal !== "string" || typeof localeVal !== "string") continue
    if (enVal !== localeVal) continue
    // Identical to English — apply heuristics to decide if it's a problem
    if (enVal.length < MIN_FLAG_LEN) continue
    if (KNOWN_KEEP_ENGLISH.has(enVal.trim())) continue
    if (isPlaceholderOnly(enVal)) continue
    if (isMostlyNonAlpha(enVal)) continue
    if (looksLikeUrlOrPath(enVal)) continue
    englishMatch.push(k)
  }

  report.push({ locale, missing: missing.length, englishMatch: englishMatch.length })
  detail[locale] = { missing, englishMatch }

  if (missing.length || englishMatch.length) {
    console.log(
      `${locale.padEnd(6)} missing=${String(missing.length).padStart(4)} ` +
      `english-untranslated=${String(englishMatch.length).padStart(4)}`,
    )
  } else {
    console.log(`${locale.padEnd(6)} ✓ no gaps`)
  }
}

const totals = {
  missing: report.reduce((a, r) => a + r.missing, 0),
  english: report.reduce((a, r) => a + r.englishMatch, 0),
}
console.log(`\nTotals across ${files.length} non-English locales:`)
console.log(`  ${totals.missing} missing keys (English fallback at runtime)`)
console.log(`  ${totals.english} English-identical values (likely untranslated)`)
console.log(`  ${totals.missing + totals.english} total gaps`)

fs.writeFileSync("/tmp/locale-gaps.json", JSON.stringify(detail, null, 2))
console.log("\nDetail written to /tmp/locale-gaps.json")
