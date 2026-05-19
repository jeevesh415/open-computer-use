/**
 * Server-side decryption for chat-flow screenshots.
 *
 * Mirrors the format produced by `backend/app/utils/encryption.py:encrypt_bytes`
 * so messages encrypted on the Python side can be decrypted here:
 *
 *   Sentinel:   `"enc:v1:"` prefix on the string value
 *   Algorithm:  AES-256-GCM
 *   Nonce:      12 random bytes, prepended to ciphertext
 *   Auth tag:   16 bytes, appended after ciphertext
 *   Wire form:  `"enc:v1:" + base64(nonce || ciphertext || tag)`
 *   Key:        32 bytes, base64-encoded in ENCRYPTION_KEY env var
 *
 * Why a different format than `lib/encryption.ts`
 * -----------------------------------------------
 * The BYOK helper at `lib/encryption.ts` uses a hex-with-colon format
 * (`ciphertext_hex:tag_hex` + separate iv field) that's suited to short
 * secrets stored in a normalized column. For screenshots — large binary
 * blobs stored inline in JSONB — hex doubles the on-disk size. This module
 * uses the more compact base64-concat format that the Python helper
 * produces, so the two runtimes can round-trip the same bytes.
 *
 * Why this module is SERVER-ONLY
 * ------------------------------
 * Decryption requires the master ENCRYPTION_KEY. Shipping that key to the
 * browser would be a critical security regression. Therefore: importing this
 * module from a "use client" file is a bug. The module is named so that
 * Next.js's import-tracing will flag the violation at build time
 * (`crypto` is a Node built-in that can't be bundled for the browser).
 */
import { createDecipheriv } from "crypto"

export const SCREENSHOT_ENC_SENTINEL = "enc:v1:" as const

const NONCE_BYTES = 12
const TAG_BYTES = 16
const ALGORITHM = "aes-256-gcm"

let _resolvedKey: Buffer | null = null
let _keyLookupFailed = false

/**
 * Lazily resolves the ENCRYPTION_KEY into a Buffer. Returns null on any
 * failure mode (unset / malformed / wrong length) and caches the failure so
 * we don't re-parse on every read. The cache is cleared on process restart;
 * that's fine — there's no legitimate reason to rotate the key live.
 */
function resolveKey(): Buffer | null {
  if (_resolvedKey !== null) return _resolvedKey
  if (_keyLookupFailed) return null
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) {
    _keyLookupFailed = true
    return null
  }
  try {
    const key = Buffer.from(raw, "base64")
    if (key.length !== 32) {
      _keyLookupFailed = true
      return null
    }
    _resolvedKey = key
    return _resolvedKey
  } catch {
    _keyLookupFailed = true
    return null
  }
}

/**
 * True when `value` is a string carrying the encryption sentinel. Plaintext
 * strings, non-strings, and undefined return false.
 */
export function isEncryptedScreenshot(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(SCREENSHOT_ENC_SENTINEL)
}

/**
 * Decrypt a single `frontendScreenshot` value.
 *
 * - Plaintext (no sentinel)        → returned unchanged
 * - Encrypted + key available      → returned as the decrypted base64 string
 * - Encrypted + no key             → returns null (caller should treat as
 *                                    "unreadable" — usually drop the field)
 * - Encrypted + tampered / wrong key→ returns null (auth tag check failed)
 *
 * Never throws. Callers that need to fail loudly should check the return
 * value; the typical use is to drop the screenshot rather than ship garbage.
 */
export function maybeDecryptScreenshot(value: unknown): string | null {
  if (typeof value !== "string") return null
  if (!value.startsWith(SCREENSHOT_ENC_SENTINEL)) return value
  const key = resolveKey()
  if (!key) return null
  const payloadB64 = value.slice(SCREENSHOT_ENC_SENTINEL.length)
  let blob: Buffer
  try {
    blob = Buffer.from(payloadB64, "base64")
  } catch {
    return null
  }
  if (blob.length < NONCE_BYTES + TAG_BYTES) return null
  const nonce = blob.subarray(0, NONCE_BYTES)
  const tag = blob.subarray(blob.length - TAG_BYTES)
  const ct = blob.subarray(NONCE_BYTES, blob.length - TAG_BYTES)
  try {
    const decipher = createDecipheriv(ALGORITHM, key, nonce)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ct), decipher.final()])
    return plaintext.toString("utf8")
  } catch {
    return null
  }
}

/**
 * Walk a `messages.parts` JSONB value and decrypt every encrypted
 * `frontendScreenshot` inside a `tool-invocation` part. Returns a new array;
 * the input is not mutated.
 *
 * Decryption failures (wrong key, tampered bytes, missing ENCRYPTION_KEY)
 * result in the `frontendScreenshot` field being REMOVED from that part —
 * the rest of the message renders normally. This is the safer failure mode
 * than returning garbage that the `<img>` tag can't decode.
 *
 * Tolerant to malformed input: non-arrays / non-objects pass through.
 */
// Module-scoped flag: emit the "decrypt failed" diagnostic once per process so
// CloudWatch picks up the env-mismatch signal without spamming on every reload.
let _decryptFailureWarned = false

export function decryptScreenshotsInParts<T = unknown>(parts: T): T {
  if (!Array.isArray(parts)) return parts
  let touched = false
  const out = parts.map((part) => {
    if (!part || typeof part !== "object") return part
    const inv = (part as { toolInvocation?: unknown }).toolInvocation
    if (!inv || typeof inv !== "object") return part
    const i = inv as Record<string, unknown>
    if (!isEncryptedScreenshot(i.frontendScreenshot)) return part
    const decrypted = maybeDecryptScreenshot(i.frontendScreenshot)
    touched = true
    if (decrypted === null) {
      // Drop the frontendScreenshot; keep everything else so the tool-call
      // text + args + result still render.
      //
      // Logging note (2026-05-17 audit, SCREENSHOT-4): on the first decrypt
      // failure of a process lifetime, emit one structured WARN so operators
      // can see this in CloudWatch.  The previous silent-drop was the smoking
      // gun for a class of "no screenshots after page reload" reports where
      // `ENCRYPTION_KEY` between the Next.js process and the Python backend
      // got out of sync.  We deliberately do NOT log per-row (could be
      // thousands per page render after a key rotation) — one-shot is enough
      // to surface the env-mismatch.
      if (!_decryptFailureWarned) {
        _decryptFailureWarned = true
        console.warn(
          "[screenshot-encryption] DECRYPT_FAILED — ENCRYPTION_KEY mismatch " +
            "between Node and Python (or key unset / tampered ciphertext). " +
            "Stripping `frontendScreenshot` from this part. " +
            "Verify ENCRYPTION_KEY env var parity across services."
        )
      }
      const cleaned: Record<string, unknown> = {}
      for (const k of Object.keys(i)) {
        if (k !== "frontendScreenshot") cleaned[k] = i[k]
      }
      return { ...(part as Record<string, unknown>), toolInvocation: cleaned }
    }
    return {
      ...(part as Record<string, unknown>),
      toolInvocation: { ...i, frontendScreenshot: decrypted },
    }
  })
  // Return the original reference when nothing was encrypted so callers
  // that compare by identity (e.g. memoised renderers) don't see a fake
  // change.
  return (touched ? out : parts) as T
}

/**
 * Convenience: walk an array of message rows (with `parts` JSONB fields)
 * and decrypt each row's parts. Returns a new array of the same shape — the
 * generic preserves the caller's row type so downstream consumers (e.g. the
 * Supabase row type from `database.types.ts`) don't lose their non-`parts`
 * field types.
 *
 * Tolerant to malformed rows (missing parts, parts that isn't an array, null
 * elements). The constraint requires an optional `parts` field with an
 * unknown shape — wide enough to match both Supabase's Json | null and our
 * AI-SDK Message DTOs which have `parts?: UIMessagePart[]`.
 */
export function decryptScreenshotsInMessages<M>(messages: M[]): M[] {
  return messages.map((m): M => {
    if (!m || typeof m !== "object") return m
    const parts = (m as { parts?: unknown }).parts
    if (parts === undefined || parts === null) return m
    const decryptedParts = decryptScreenshotsInParts(parts)
    if (decryptedParts === parts) return m
    return { ...(m as object), parts: decryptedParts } as M
  })
}
