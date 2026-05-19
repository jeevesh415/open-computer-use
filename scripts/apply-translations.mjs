#!/usr/bin/env node
/**
 * apply-translations.mjs
 *
 * Apply a flat key→translation map onto a locale JSON file in-place.
 *
 * Usage:
 *   node scripts/apply-translations.mjs <locale> <translations.json>
 *
 *   translations.json shape: { "header.products": "Productos", "auth.features.localControl.title": "..." }
 *
 * Behavior:
 *   - Reads messages/<locale>.json
 *   - For each entry in translations.json, navigates the dotted key path
 *     and replaces the leaf string value
 *   - Skips entries where the leaf is not a string (defensive — never
 *     overwrites an object/array)
 *   - Skips entries where the key path doesn't resolve (with a warning)
 *   - Validates the resulting object is JSON-serializable
 *   - Writes back with 2-space indent + trailing newline (preserves repo style)
 *
 * Exit code 0 on full success, 1 if any path failed to resolve.
 */
import fs from "node:fs"
import path from "node:path"

const [, , locale, transPath] = process.argv
if (!locale || !transPath) {
  console.error("Usage: node scripts/apply-translations.mjs <locale> <translations.json>")
  process.exit(2)
}

const targetPath = path.join("messages", `${locale}.json`)
if (!fs.existsSync(targetPath)) {
  console.error(`Locale file not found: ${targetPath}`)
  process.exit(2)
}
if (!fs.existsSync(transPath)) {
  console.error(`Translations file not found: ${transPath}`)
  process.exit(2)
}

const data = JSON.parse(fs.readFileSync(targetPath, "utf8"))
const translations = JSON.parse(fs.readFileSync(transPath, "utf8"))

let applied = 0
let skippedNotString = 0
let skippedNotFound = 0
const failed = []

for (const [keyPath, newValue] of Object.entries(translations)) {
  if (typeof newValue !== "string") {
    failed.push({ key: keyPath, reason: "new value is not a string" })
    continue
  }
  const parts = keyPath.split(".")
  let cur = data
  let ok = true
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur === null || typeof cur !== "object" || !(parts[i] in cur)) {
      ok = false
      break
    }
    cur = cur[parts[i]]
  }
  if (!ok) {
    skippedNotFound++
    failed.push({ key: keyPath, reason: "key path not found" })
    continue
  }
  const last = parts[parts.length - 1]
  if (!(last in cur) || typeof cur[last] !== "string") {
    skippedNotString++
    failed.push({ key: keyPath, reason: "leaf is not a string" })
    continue
  }
  cur[last] = newValue
  applied++
}

// Validate
JSON.stringify(data)

fs.writeFileSync(targetPath, JSON.stringify(data, null, 2) + "\n")

console.log(
  `${locale}: applied=${applied} skipped(notFound)=${skippedNotFound} skipped(notString)=${skippedNotString}`,
)
if (failed.length) {
  console.log("First 10 failures:")
  for (const f of failed.slice(0, 10)) console.log(`  ${f.key} — ${f.reason}`)
}
process.exit(failed.length ? 1 : 0)
