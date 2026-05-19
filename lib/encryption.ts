import { createCipheriv, createDecipheriv, randomBytes } from "crypto"

// AES-256-GCM. The cipher mode is pinned (the source-hygiene tests in
// tests/lib/encryption-deep.test.ts assert this literal is present).
const ALGORITHM = "aes-256-gcm"

/**
 * Error thrown when an encryption operation is requested but the
 * `ENCRYPTION_KEY` environment variable is unset, malformed, or the wrong
 * length. Carries a stable `code` so callers (e.g. API route handlers) can
 * distinguish "not configured" from a runtime failure and respond with a
 * descriptive 503 instead of a generic 500.
 *
 * SECURITY: The error message intentionally mentions OSS mode so a self-host
 * deployment hitting this path understands they don't need to set the key —
 * they should be on the OSS path that doesn't write encrypted secrets to
 * Supabase.
 */
export class EncryptionUnavailableError extends Error {
  readonly code = "ENCRYPTION_UNAVAILABLE" as const
  constructor(message: string) {
    super(message)
    this.name = "EncryptionUnavailableError"
  }
}

// Module-level memoization. Once we successfully resolve a 32-byte key, we
// keep it for the lifetime of the process — a later env unset must not break
// in-flight encryptions. Tests reset this via `vi.resetModules()`.
let _resolvedKey: Buffer | null = null

/**
 * Lazily resolves and validates `ENCRYPTION_KEY`. Returns the cached buffer
 * after the first successful call. Throws `EncryptionUnavailableError` on
 * every failure mode (unset / malformed / wrong-length) with a message that
 * tells the operator exactly what's wrong.
 *
 * Read-once-then-cache means subsequent calls survive the env var being
 * removed mid-process, which matters for hot-reloaded dev servers and for
 * deployments that rotate config without restarting.
 */
function resolveKey(): Buffer {
  if (_resolvedKey !== null) return _resolvedKey

  const raw = process.env.ENCRYPTION_KEY
  if (!raw) {
    throw new EncryptionUnavailableError(
      "ENCRYPTION_KEY is not set. This is expected in oss mode (the OSS " +
        "self-host path does not store encrypted BYOK secrets). If you are " +
        "running the production deployment, set ENCRYPTION_KEY to a base64-" +
        "encoded 32-byte key.",
    )
  }

  let key: Buffer
  try {
    key = Buffer.from(raw, "base64")
  } catch (err) {
    throw new EncryptionUnavailableError(
      `ENCRYPTION_KEY is not valid base64: ${(err as Error).message}`,
    )
  }

  // `Buffer.from(..., "base64")` is lenient — non-base64 input silently
  // produces a short or empty buffer rather than throwing. Catch that here.
  if (key.length !== 32) {
    throw new EncryptionUnavailableError(
      `ENCRYPTION_KEY must decode to 32 bytes, got ${key.length} bytes. ` +
        `Generate a fresh key with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    )
  }

  _resolvedKey = key
  return _resolvedKey
}

/**
 * Returns `true` when the encryption helpers are ready to use — i.e. when a
 * resolvable, valid `ENCRYPTION_KEY` is present (or has already been
 * resolved earlier in this process). Never throws.
 *
 * Useful for OSS-mode UI gates: a self-host deployment can call this to hide
 * BYOK input fields rather than letting the user save a key that will then
 * fail to encrypt with a confusing 500.
 */
export function isEncryptionAvailable(): boolean {
  try {
    resolveKey()
    return true
  } catch {
    return false
  }
}

export function encryptKey(plaintext: string): {
  encrypted: string
  iv: string
} {
  const key = resolveKey()
  const iv = randomBytes(16)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(plaintext, "utf8", "hex")
  encrypted += cipher.final("hex")

  const authTag = cipher.getAuthTag()
  const encryptedWithTag = encrypted + ":" + authTag.toString("hex")

  return {
    encrypted: encryptedWithTag,
    iv: iv.toString("hex"),
  }
}

export function decryptKey(encryptedData: string, ivHex: string): string {
  const key = resolveKey()
  const [encrypted, authTagHex] = encryptedData.split(":")
  const iv = Buffer.from(ivHex, "hex")
  const authTag = Buffer.from(authTagHex, "hex")

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encrypted, "hex", "utf8")
  decrypted += decipher.final("utf8")

  return decrypted
}

export function maskKey(key: string): string {
  if (key.length <= 8) {
    return "*".repeat(key.length)
  }
  return key.slice(0, 4) + "*".repeat(key.length - 8) + key.slice(-4)
}
