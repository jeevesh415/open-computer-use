// SERVER ONLY: do not import from client components.
//
// This module reads/writes `.env.local` on the local filesystem. Any leak
// into the client bundle would be both useless (browsers can't touch the
// filesystem) and a footgun (it imports `node:fs` and `node:crypto`, which
// would crash a webpack client build). Next.js doesn't have a hard
// `"server-only"` import at the dependency level here (the `server-only` npm
// package isn't installed in this repo — see lib/oss-mode.ts:1-16 for the
// same convention), so the invariant is enforced via:
//
//   1. This banner comment, scanned by code review.
//   2. The runtime guard at the bottom of this file that throws if `window`
//      is defined when the module is evaluated.
//
// Phase 8 of the OSS-mode rollout: when the dev server starts and
// CSRF_SECRET / ENCRYPTION_KEY are missing, auto-generate them and persist
// to `.env.local` with a comment marker. Production deployments must set
// these explicitly — auto-generating in prod would silently rotate tokens
// across deploys, breaking signed cookies and decrypting BYOK secrets. The
// `isOssMode()` gate plus the Vercel safety check below guarantee this code
// path stays out of prod.

import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { isOssMode } from "@/lib/oss-mode"

const TARGET_FILE = ".env.local"
const MARKER = "# coasty-auto-generated"

interface SecretSpec {
  name: string
  generate: () => string
}

/**
 * The list of secrets we'll auto-generate on first boot when running in OSS
 * mode. Each entry's `generate()` MUST return a value that satisfies the
 * downstream validator:
 *
 *   - CSRF_SECRET   — opaque string, used as a HMAC-style salt in
 *                     `lib/csrf.ts`. 64 hex chars (32 bytes) is plenty.
 *   - ENCRYPTION_KEY — base64 of exactly 32 bytes; `lib/encryption.ts`
 *                     `getKey()` rejects anything else.
 */
const SECRETS: SecretSpec[] = [
  {
    name: "CSRF_SECRET",
    generate: () => crypto.randomBytes(32).toString("hex"),
  },
  {
    name: "ENCRYPTION_KEY",
    generate: () => crypto.randomBytes(32).toString("base64"),
  },
]

/**
 * On first boot in OSS mode, generate any missing CSRF_SECRET /
 * ENCRYPTION_KEY values and append them to `.env.local`, also injecting
 * them into `process.env` so the running process picks them up immediately.
 *
 * This is a no-op (returns silently) if any of:
 *
 *   - `isOssMode()` returns false — production deploys must set these
 *     explicitly so token rotation is intentional, not surprise behavior.
 *   - Both env vars are already set in the current process env (because the
 *     user supplied them via `.env`, OS env, or a previous run that wrote
 *     `.env.local`).
 *   - The values are already present in `.env.local` on disk (we never
 *     overwrite — the user's choice to delete the marker block triggers a
 *     fresh generation, which IS a deliberate token rotation).
 *
 * Defense-in-depth: even if `isOssMode()` somehow returned true on a
 * managed deploy (e.g. a stray `COASTY_OSS_MODE=1` env var on Vercel), we
 * additionally refuse to write the file when `NODE_ENV=production` AND
 * `VERCEL` is set. The values still go into `process.env` for the current
 * process, but we never persist — letting the operator notice the warning
 * and fix the misconfig instead of silently rotating prod secrets on every
 * deploy.
 *
 * Failure handling: filesystem errors (read or write) are downgraded to
 * `console.warn`. The values still land in `process.env`, so the boot
 * proceeds. This matters in containerized envs with a read-only project
 * directory — the operator can either bind-mount a writable `.env.local`
 * or accept the regenerate-per-boot behavior.
 */
export function ensureLocalSecrets(): void {
  // Gate: only run in OSS mode. See doc comment above for the rationale.
  if (!isOssMode()) return

  const cwd = process.cwd()
  const envPath = path.join(cwd, TARGET_FILE)

  // Read the existing `.env.local` (if any) so we can detect keys that are
  // present in the file but not yet loaded into `process.env` — e.g. when
  // the framework hasn't finished loading dotenv files in the current boot.
  let existing = ""
  try {
    existing = fs.readFileSync(envPath, "utf8")
  } catch (e: unknown) {
    const code = (e as { code?: string } | null)?.code
    if (code !== "ENOENT") {
      const msg = (e as { message?: string } | null)?.message ?? String(e)
      console.warn(
        `[coasty-auto-secrets] could not read ${TARGET_FILE}: ${msg}`,
      )
      // Bail out — we'd rather not write a fresh file on top of one we
      // couldn't read; that risks losing user content.
      return
    }
    existing = ""
  }

  const missing: string[] = []
  for (const spec of SECRETS) {
    if (process.env[spec.name]) continue
    // Match e.g. `CSRF_SECRET=...` or whitespace-prefixed; ignore commented
    // lines (a leading `#` would not match `^\s*${name}=`).
    if (new RegExp(`^\\s*${spec.name}=`, "m").test(existing)) continue
    missing.push(spec.name)
  }

  if (missing.length === 0) return

  // Generate values and inject into the live process env regardless of
  // whether the file write succeeds — that way the rest of the boot can
  // proceed even on a read-only filesystem.
  const additions = missing
    .map((name) => {
      const spec = SECRETS.find((s) => s.name === name)
      // Defensive: SECRETS is a const, so spec is always defined when
      // `name` came from SECRETS via the loop above. The fallback throw
      // exists to make this invariant explicit for future maintainers.
      if (!spec) {
        throw new Error(
          `[coasty-auto-secrets] internal: no spec for ${name}`,
        )
      }
      const value = spec.generate()
      process.env[name] = value
      return `${name}=${value}`
    })
    .join("\n")

  // Defense-in-depth: never write to `.env.local` from a managed prod env.
  // The `isOssMode()` gate above should already keep us out, but a misconfig
  // (someone setting COASTY_OSS_MODE=1 on Vercel) shouldn't be able to start
  // silently rotating prod secrets. process.env is still updated above, so
  // the current process boots cleanly; only the persistent write is skipped.
  if (
    process.env.NODE_ENV === "production" &&
    process.env.VERCEL
  ) {
    console.warn(
      "[coasty-auto-secrets] refusing to write .env.local in a managed " +
        "production environment (NODE_ENV=production, VERCEL set). " +
        "Generated secrets are in-process only; set them explicitly in your " +
        "deployment env to make them persistent.",
    )
    return
  }

  const block =
    `\n${MARKER}: ${new Date().toISOString()} — generated for OSS mode ` +
    `(you can delete and we will regenerate)\n` +
    `${additions}\n`

  try {
    // 0o600 — file is sensitive, only the owner should read it.
    // `appendFileSync` creates the file if missing (with the given mode);
    // if the file already exists, the mode is preserved.
    fs.appendFileSync(envPath, block, { mode: 0o600 })
    console.log(
      `[coasty-auto-secrets] generated ${missing.join(", ")} → ${TARGET_FILE}`,
    )
  } catch (e: unknown) {
    const msg = (e as { message?: string } | null)?.message ?? String(e)
    console.warn(
      `[coasty-auto-secrets] could not write ${TARGET_FILE}: ${msg}. ` +
        "Generated secrets are in-process only — they will regenerate on " +
        "next boot, which will rotate CSRF tokens and break any encrypted-" +
        "at-rest BYOK secrets stored from this run.",
    )
  }
}

// Runtime guard: bail loudly if this module is somehow evaluated in a
// browser context. Mirrors lib/oss-mode.ts:113-120.
if (typeof window !== "undefined") {
  throw new Error(
    "lib/auto-secrets.ts was imported in a client environment. " +
      "This module is server-only and reads/writes the filesystem.",
  )
}
