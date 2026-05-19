/**
 * OSS-mode detection + API-key storage for the Electron main process.
 *
 * Web-side equivalent: lib/oss-mode.ts. The semantics differ slightly:
 * - Web: env vars decide at process start.
 * - Electron: a stored encrypted key file decides per-launch. The user pastes
 *   their key once; we encrypt with safeStorage (OS keychain) and persist to
 *   userData. On subsequent launches we transparently decrypt and run in OSS
 *   mode.
 */
import { app, safeStorage } from 'electron'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as crypto from 'node:crypto'

const KEY_FILENAME = '.coasty-key.enc'

let _cachedKey: string | null = null
let _checked = false

/** Reset internal cache — exposed for tests only. */
export function _resetOssModeCacheForTests(): void {
  _cachedKey = null
  _checked = false
}

export async function getStoredKey(): Promise<string | null> {
  if (_checked) return _cachedKey
  _checked = true
  try {
    const filePath = path.join(app.getPath('userData'), KEY_FILENAME)
    const buf = await fs.readFile(filePath)
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[coasty-oss] safeStorage unavailable — refusing to decrypt key')
      return null
    }
    _cachedKey = safeStorage.decryptString(buf)
    return _cachedKey
  } catch (e: any) {
    if (e?.code !== 'ENOENT') console.warn('[coasty-oss] decrypt failed:', e?.message)
    return null
  }
}

export async function setStoredKey(key: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS keychain (safeStorage) is not available — cannot persist API key securely')
  }
  const filePath = path.join(app.getPath('userData'), KEY_FILENAME)
  const enc = safeStorage.encryptString(key)
  await fs.writeFile(filePath, enc, { mode: 0o600 })
  _cachedKey = key
  _checked = true
}

export async function clearStoredKey(): Promise<void> {
  try {
    const filePath = path.join(app.getPath('userData'), KEY_FILENAME)
    await fs.unlink(filePath)
  } catch (e: any) {
    if (e?.code !== 'ENOENT') throw e
  }
  _cachedKey = null
  _checked = false
}

export async function isOssMode(): Promise<boolean> {
  // Force-overrides via env (for dev/testing)
  if (process.env.COASTY_FORCE_PRODUCTION_MODE === '1') return false
  if (process.env.COASTY_OSS_MODE === '1') return true
  // Auto-detect: stored key present
  const key = await getStoredKey()
  return key !== null
}

/**
 * Validate the key by hitting /v1/credits. Returns { ok: true, tier } on
 * success, { ok: false, message } on auth failure or transport error.
 */
export async function validateKey(
  key: string,
  baseUrl?: string,
): Promise<{ ok: true; tier?: string } | { ok: false; message: string }> {
  const url =
    (baseUrl || process.env.COASTY_API_BASE_URL || 'https://coasty.ai').replace(/\/$/, '') +
    '/v1/credits'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-Key': key,
        'User-Agent': 'coasty-electron/1.0',
        'X-Coasty-Source': 'electron-oss',
        Accept: 'application/json',
      },
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (resp.status === 401 || resp.status === 403) return { ok: false, message: 'Invalid API key' }
    if (!resp.ok) return { ok: false, message: `Unexpected ${resp.status} from coasty.ai` }
    const body: any = await resp.json().catch(() => ({}))
    return { ok: true, tier: body?.tier }
  } catch (e: any) {
    clearTimeout(timer)
    if (e?.name === 'AbortError') return { ok: false, message: 'Timed out reaching coasty.ai' }
    return { ok: false, message: e?.message ?? 'Network error' }
  }
}

export function getCoastyApiBaseUrl(): string {
  return (process.env.COASTY_API_BASE_URL || 'https://coasty.ai').replace(/\/$/, '')
}

/**
 * Hash the API key into a stable, opaque pseudo-user-id. Used as the
 * `userId` field for the synthetic session and machine-id derivation in
 * OSS mode so the backend / renderer code paths that key off "user id"
 * still get a stable, non-empty value without leaking the API key.
 */
export function hashApiKeyToUserId(key: string): string {
  // SHA-256 then truncate to a UUID-shaped string. Output is deterministic
  // for a given key, so multiple launches under the same key yield the
  // same machine-id derivation.
  const hash = crypto.createHash('sha256').update(`coasty-oss-user:${key}`).digest('hex')
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    // Force version-5-ish nibble — purely cosmetic so it parses as a UUID.
    '5' + hash.slice(13, 16),
    // Force RFC-4122 variant nibble (8/9/a/b).
    ((parseInt(hash.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join('-')
}
