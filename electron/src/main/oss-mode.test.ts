/**
 * Tests for OSS-mode helpers (key storage, mode detection, validateKey).
 *
 * Mocks Electron's `app.getPath` + `safeStorage` and node:fs/promises so the
 * tests run cross-platform with no real keychain access.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────

const mockUserData = process.platform === 'win32'
  ? 'C:\\Users\\testuser\\AppData\\Roaming\\Coasty Desktop'
  : '/tmp/coasty-test-userdata'

const mockEncryptString = vi.fn((s: string) => Buffer.from('ENC:' + s, 'utf8'))
const mockDecryptString = vi.fn((b: Buffer) => b.toString('utf8').replace(/^ENC:/, ''))
const mockIsEncryptionAvailable = vi.fn(() => true)

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => name === 'userData' ? mockUserData : ''),
  },
  safeStorage: {
    encryptString: (s: string) => mockEncryptString(s),
    decryptString: (b: Buffer) => mockDecryptString(b),
    isEncryptionAvailable: () => mockIsEncryptionAvailable(),
  },
}))

const mockReadFile = vi.fn()
const mockWriteFile = vi.fn()
const mockUnlink = vi.fn()

vi.mock('node:fs/promises', () => ({
  readFile: (...args: any[]) => mockReadFile(...args),
  writeFile: (...args: any[]) => mockWriteFile(...args),
  unlink: (...args: any[]) => mockUnlink(...args),
}))

// ── Imports (after mocks) ────────────────────────────────────────────────

import {
  getStoredKey,
  setStoredKey,
  clearStoredKey,
  isOssMode,
  validateKey,
  getCoastyApiBaseUrl,
  hashApiKeyToUserId,
  _resetOssModeCacheForTests,
} from './oss-mode'

// ── Setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  // mockReset wipes the implementation queue (mockResolvedValueOnce / mockRejectedValueOnce)
  // — clearAllMocks alone leaves dangling one-time mocks queued from earlier tests.
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
  mockUnlink.mockReset()
  mockEncryptString.mockClear()
  mockDecryptString.mockClear()
  // Re-establish default implementations (mockReset wipes those too).
  mockEncryptString.mockImplementation((s: string) => Buffer.from('ENC:' + s, 'utf8'))
  mockDecryptString.mockImplementation((b: Buffer) => b.toString('utf8').replace(/^ENC:/, ''))
  _resetOssModeCacheForTests()
  delete process.env.COASTY_FORCE_PRODUCTION_MODE
  delete process.env.COASTY_OSS_MODE
  delete process.env.COASTY_API_BASE_URL
  mockIsEncryptionAvailable.mockReturnValue(true)
})

afterEach(() => {
  _resetOssModeCacheForTests()
})

// ── Tests ────────────────────────────────────────────────────────────────

describe('getStoredKey', () => {
  it('returns null when the key file does not exist', async () => {
    const err: any = new Error('not found')
    err.code = 'ENOENT'
    mockReadFile.mockRejectedValueOnce(err)

    const key = await getStoredKey()
    expect(key).toBeNull()
  })

  it('decrypts and returns the stored key', async () => {
    mockReadFile.mockResolvedValueOnce(Buffer.from('ENC:my-secret-key', 'utf8'))

    const key = await getStoredKey()
    expect(key).toBe('my-secret-key')
    expect(mockDecryptString).toHaveBeenCalledOnce()
  })

  it('caches the result so a second read does not hit disk', async () => {
    mockReadFile.mockResolvedValueOnce(Buffer.from('ENC:cached-key', 'utf8'))

    const k1 = await getStoredKey()
    const k2 = await getStoredKey()
    expect(k1).toBe('cached-key')
    expect(k2).toBe('cached-key')
    expect(mockReadFile).toHaveBeenCalledOnce()
  })

  it('returns null and warns when safeStorage is unavailable', async () => {
    mockIsEncryptionAvailable.mockReturnValue(false)
    mockReadFile.mockResolvedValueOnce(Buffer.from('ENC:foo', 'utf8'))

    const key = await getStoredKey()
    expect(key).toBeNull()
    expect(mockDecryptString).not.toHaveBeenCalled()
  })

  it('returns null on non-ENOENT read errors', async () => {
    mockReadFile.mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: 'EACCES' }))

    const key = await getStoredKey()
    expect(key).toBeNull()
  })
})

describe('setStoredKey', () => {
  it('encrypts and writes to userData with mode 0o600', async () => {
    mockWriteFile.mockResolvedValueOnce(undefined)

    await setStoredKey('test-key-123')

    expect(mockEncryptString).toHaveBeenCalledWith('test-key-123')
    expect(mockWriteFile).toHaveBeenCalledOnce()
    const [pathArg, contentArg, opts] = mockWriteFile.mock.calls[0]
    expect(String(pathArg)).toContain('.coasty-key.enc')
    expect(Buffer.isBuffer(contentArg)).toBe(true)
    expect(opts).toEqual({ mode: 0o600 })
  })

  it('throws when safeStorage is unavailable', async () => {
    mockIsEncryptionAvailable.mockReturnValue(false)

    await expect(setStoredKey('x')).rejects.toThrow(/safeStorage|keychain/i)
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('updates the in-memory cache so a subsequent getStoredKey skips disk', async () => {
    mockWriteFile.mockResolvedValueOnce(undefined)

    await setStoredKey('new-key')
    const k = await getStoredKey()

    expect(k).toBe('new-key')
    expect(mockReadFile).not.toHaveBeenCalled()
  })
})

describe('clearStoredKey', () => {
  it('unlinks the key file and resets the cache', async () => {
    mockUnlink.mockResolvedValueOnce(undefined)
    // First seed the cache so we can verify it is cleared.
    mockReadFile.mockResolvedValueOnce(Buffer.from('ENC:seed', 'utf8'))
    await getStoredKey()

    await clearStoredKey()

    expect(mockUnlink).toHaveBeenCalledOnce()
    // After clear, the cache is gone — next read hits disk again.
    const err: any = new Error('not found')
    err.code = 'ENOENT'
    mockReadFile.mockRejectedValueOnce(err)
    const k = await getStoredKey()
    expect(k).toBeNull()
  })

  it('treats ENOENT as a no-op', async () => {
    const err: any = new Error('not found')
    err.code = 'ENOENT'
    mockUnlink.mockRejectedValueOnce(err)

    await expect(clearStoredKey()).resolves.toBeUndefined()
  })

  it('rethrows non-ENOENT unlink errors', async () => {
    mockUnlink.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'EBUSY' }))

    await expect(clearStoredKey()).rejects.toThrow(/boom/)
  })
})

describe('isOssMode', () => {
  it('returns true when COASTY_OSS_MODE=1', async () => {
    process.env.COASTY_OSS_MODE = '1'
    const err: any = new Error('not found')
    err.code = 'ENOENT'
    mockReadFile.mockRejectedValueOnce(err)

    expect(await isOssMode()).toBe(true)
  })

  it('returns false when COASTY_FORCE_PRODUCTION_MODE=1 even if a key is stored', async () => {
    process.env.COASTY_FORCE_PRODUCTION_MODE = '1'
    mockReadFile.mockResolvedValueOnce(Buffer.from('ENC:k', 'utf8'))

    expect(await isOssMode()).toBe(false)
  })

  it('returns true when a key is stored on disk', async () => {
    mockReadFile.mockResolvedValueOnce(Buffer.from('ENC:k', 'utf8'))

    expect(await isOssMode()).toBe(true)
  })

  it('returns false when no key is stored', async () => {
    const err: any = new Error('not found')
    err.code = 'ENOENT'
    mockReadFile.mockRejectedValueOnce(err)

    expect(await isOssMode()).toBe(false)
  })
})

describe('validateKey', () => {
  let originalFetch: typeof fetch | undefined
  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch
  })

  it('returns ok=true with tier when /v1/credits succeeds', async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ tier: 'free' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as any

    const r = await validateKey('k')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.tier).toBe('free')
  })

  it('sends X-API-Key header and X-Coasty-Source=electron-oss', async () => {
    const fetchMock: any = vi.fn(async (..._args: any[]) =>
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    globalThis.fetch = fetchMock

    await validateKey('the-key', 'https://coasty.ai/')

    expect(fetchMock).toHaveBeenCalledOnce()
    const call = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(call[0]).toBe('https://coasty.ai/v1/credits')
    const headers = call[1].headers as Record<string, string>
    expect(headers['X-API-Key']).toBe('the-key')
    expect(headers['X-Coasty-Source']).toBe('electron-oss')
    expect(headers['User-Agent']).toMatch(/coasty-electron/)
  })

  it('returns "Invalid API key" on 401', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 401 })) as any

    const r = await validateKey('bad')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/Invalid API key/i)
  })

  it('returns "Invalid API key" on 403', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 403 })) as any

    const r = await validateKey('bad')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/Invalid API key/i)
  })

  it('returns a generic error on other non-OK statuses', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 500 })) as any

    const r = await validateKey('k')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/500/)
  })

  it('returns a network error on transport failure', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED') }) as any

    const r = await validateKey('k')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/ECONNREFUSED|Network/i)
  })

  it('respects the COASTY_API_BASE_URL env override', async () => {
    process.env.COASTY_API_BASE_URL = 'https://staging.coasty.ai'
    const fetchMock: any = vi.fn(async (..._args: any[]) =>
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    globalThis.fetch = fetchMock

    await validateKey('k')

    const call = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(call[0]).toBe('https://staging.coasty.ai/v1/credits')
  })
})

describe('getCoastyApiBaseUrl', () => {
  it('defaults to https://coasty.ai', () => {
    expect(getCoastyApiBaseUrl()).toBe('https://coasty.ai')
  })

  it('strips trailing slash from env override', () => {
    process.env.COASTY_API_BASE_URL = 'https://coasty.ai/'
    expect(getCoastyApiBaseUrl()).toBe('https://coasty.ai')
  })

  it('honors a self-hosted base URL', () => {
    process.env.COASTY_API_BASE_URL = 'http://localhost:8001'
    expect(getCoastyApiBaseUrl()).toBe('http://localhost:8001')
  })
})

describe('hashApiKeyToUserId', () => {
  it('produces a UUID-shaped, deterministic string', () => {
    const a = hashApiKeyToUserId('key-1')
    const b = hashApiKeyToUserId('key-1')
    const c = hashApiKeyToUserId('key-2')

    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('does not include the key directly', () => {
    const id = hashApiKeyToUserId('SUPER-SECRET-KEY')
    expect(id).not.toContain('SUPER-SECRET-KEY')
  })
})
