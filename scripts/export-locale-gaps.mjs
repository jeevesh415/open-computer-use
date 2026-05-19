#!/usr/bin/env node
/**
 * Reads /tmp/locale-gaps.json (produced by scripts/audit-locales.mjs) and
 * writes one focused gap file per locale to /tmp/gaps/<locale>.json with
 * the shape:
 *   [{ "key": "header.products", "en": "Products" }, ...]
 *
 * The translation agents consume these files instead of re-reading the full
 * en.json on every key lookup.
 */
import fs from "node:fs"
import path from "node:path"

const GAPS_FILE = "/tmp/locale-gaps.json"
const OUT_DIR = "/tmp/gaps"

if (!fs.existsSync(GAPS_FILE)) {
  console.error(`Missing ${GAPS_FILE} — run scripts/audit-locales.mjs first`)
  process.exit(1)
}

function getValue(obj, keyPath) {
  let cur = obj
  for (const p of keyPath.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined
    cur = cur[p]
  }
  return cur
}

const en = JSON.parse(fs.readFileSync("messages/en.json", "utf8"))
const detail = JSON.parse(fs.readFileSync(GAPS_FILE, "utf8"))

fs.mkdirSync(OUT_DIR, { recursive: true })

for (const [locale, gaps] of Object.entries(detail)) {
  const rows = []
  for (const k of gaps.englishMatch) {
    const v = getValue(en, k)
    if (typeof v === "string") rows.push({ key: k, en: v })
  }
  const outPath = path.join(OUT_DIR, `${locale}.json`)
  fs.writeFileSync(outPath, JSON.stringify(rows, null, 2))
  console.log(`${locale.padEnd(6)} ${String(rows.length).padStart(4)} keys → ${outPath}`)
}
