import Papa from "papaparse"
import type { ImportPlatform, ParsedCredential } from "@/types/secrets.types"

/* ─── Platform configurations ─── */

export interface PlatformConfig {
  label: string
  columns: { name?: string; url: string; username: string; password: string; notes?: string }
  instructions: string[]
  /** If true, derive credential name from domain when the name column is missing */
  deriveName: boolean
}

export const PLATFORM_CONFIGS: Record<ImportPlatform, PlatformConfig> = {
  chrome: {
    label: "Google Chrome",
    columns: { name: "name", url: "url", username: "username", password: "password", notes: "note" },
    instructions: [
      "Open Chrome and go to Settings",
      'Click "Passwords and autofill" → "Google Password Manager"',
      "Click Settings (gear icon) on the left sidebar",
      'Click "Export passwords" and confirm with your device password',
      "Save the CSV file to your computer",
    ],
    deriveName: false,
  },
  firefox: {
    label: "Mozilla Firefox",
    columns: { url: "url", username: "username", password: "password" },
    instructions: [
      "Open Firefox and go to Settings",
      'Click "Privacy & Security" in the left sidebar',
      'Scroll to "Logins and Passwords" and click "Saved Logins"',
      'Click the three-dot menu (⋯) and select "Export Logins…"',
      "Confirm with your device password and save the CSV file",
    ],
    deriveName: true,
  },
  "1password": {
    label: "1Password",
    columns: { name: "Title", url: "Url", username: "Username", password: "Password", notes: "Notes" },
    instructions: [
      "Open 1Password desktop app",
      "Go to File → Export → select your vault",
      'Choose "CSV" as the export format',
      "Authenticate with your master password",
      "Save the CSV file to your computer",
    ],
    deriveName: false,
  },
  bitwarden: {
    label: "Bitwarden",
    columns: { name: "name", url: "login_uri", username: "login_username", password: "login_password", notes: "notes" },
    instructions: [
      "Open Bitwarden web vault or desktop app",
      "Go to Tools → Export Vault",
      'Select ".csv" as the file format',
      "Enter your master password to confirm",
      "Save the exported CSV file",
    ],
    deriveName: false,
  },
  lastpass: {
    label: "LastPass",
    columns: { name: "name", url: "url", username: "username", password: "password", notes: "extra" },
    instructions: [
      "Log in to LastPass web vault (lastpass.com)",
      "Go to Advanced Options → Export",
      "Enter your master password to confirm",
      "A CSV file will download automatically",
      "Save it to a known location on your computer",
    ],
    deriveName: false,
  },
  keepass: {
    label: "KeePass",
    columns: { name: "Title", url: "URL", username: "UserName", password: "Password", notes: "Notes" },
    instructions: [
      "Open KeePass and unlock your database",
      "Go to File → Export",
      'Select "CSV" as the export format',
      "Choose which entries to export (or all)",
      "Save the CSV file to your computer",
    ],
    deriveName: false,
  },
}

/* ─── Helpers ─── */

function normalizeDomain(input: string): string {
  try {
    const withProto = input.startsWith("http") ? input : `https://${input}`
    const url = new URL(withProto)
    return url.hostname.replace(/^www\./, "")
  } catch {
    return input.trim()
  }
}

function nameFromUrl(url: string): string {
  try {
    const domain = normalizeDomain(url)
    // "mail.google.com" → "Google", "github.com" → "Github"
    const parts = domain.split(".")
    const main = parts.length >= 2 ? parts[parts.length - 2] : parts[0]
    return main.charAt(0).toUpperCase() + main.slice(1)
  } catch {
    return url
  }
}

/* ─── Auto-detect platform from CSV headers ─── */

export function detectPlatform(headers: string[]): ImportPlatform | null {
  const h = new Set(headers.map((s) => s.trim().toLowerCase()))

  // Bitwarden has unique column names
  if (h.has("login_uri") || h.has("login_username") || h.has("login_password")) return "bitwarden"

  // Firefox has httpRealm / formActionOrigin
  if (h.has("httprealm") || h.has("formactionorigin")) return "firefox"

  // 1Password uses "Title" (capitalized) with "Url" (capitalized)
  const raw = new Set(headers.map((s) => s.trim()))
  if (raw.has("Title") && raw.has("Url") && raw.has("Username")) return "1password"

  // KeePass uses "UserName" (camelCase) and "Title"
  if (raw.has("UserName") && raw.has("Title") && raw.has("URL")) return "keepass"

  // LastPass has "extra" and "grouping" columns
  if (h.has("extra") && h.has("grouping")) return "lastpass"

  // Chrome uses lowercase "name", "url", "username", "password"
  if (h.has("name") && h.has("url") && h.has("username") && h.has("password")) return "chrome"

  return null
}

/* ─── CSV Parsing ─── */

export function parseCSVHeaders(fileContent: string): string[] {
  const result = Papa.parse<Record<string, string>>(fileContent, {
    header: true,
    preview: 1,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  })
  return result.meta.fields ?? []
}

export function parseCSV(
  fileContent: string,
  platform: ImportPlatform
): ParsedCredential[] {
  const config = PLATFORM_CONFIGS[platform]
  const { columns, deriveName } = config

  const result = Papa.parse<Record<string, string>>(fileContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  })

  if (result.errors.length > 0 && result.data.length === 0) {
    return []
  }

  const credentials: ParsedCredential[] = []

  for (const row of result.data) {
    const url = (row[columns.url] || "").trim()
    const username = (row[columns.username] || "").trim()
    const password = (row[columns.password] || "").trim()
    const notes = columns.notes ? (row[columns.notes] || "").trim() : ""
    let name = columns.name ? (row[columns.name] || "").trim() : ""

    // Derive name from URL if not present or if platform requires it
    if (!name && (deriveName || !columns.name)) {
      name = url ? nameFromUrl(url) : ""
    }

    // Derive service from URL
    const service = url ? normalizeDomain(url) : ""

    // Validate
    const errors: string[] = []
    if (!username && !password) {
      errors.push("Missing username and password")
    }
    if (!password) {
      errors.push("Missing password")
    }
    if (!service && !url) {
      errors.push("Missing URL/service")
    }
    if (name.length > 200) errors.push("Name too long")
    if (service.length > 500) errors.push("Service too long")
    if (username.length > 500) errors.push("Username too long")
    if (password.length > 1000) errors.push("Password too long")
    if (notes.length > 2000) errors.push("Notes too long")

    const valid = errors.length === 0 && !!password && !!service

    credentials.push({
      name: name || service || "Unnamed",
      service,
      username,
      password,
      notes,
      valid,
      error: errors.length > 0 ? errors.join(", ") : undefined,
    })
  }

  return credentials
}
