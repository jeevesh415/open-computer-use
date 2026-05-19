/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Security tests for auto-updater.ts.
 *
 * Coverage:
 *  - Update feed URL is HTTPS only (configured in electron-builder.yml)
 *  - signature/checksum verification is delegated to electron-updater (which
 *    enforces SHA-512 sums + code signing by default — assert we don't disable it)
 *  - 5s initial delay before first check
 *  - 4-hour interval, NOT a faster timer
 *  - Doesn't auto-relaunch unless user calls quitAndInstall()
 *  - Update URL is NOT modifiable via env var (hard-coded in publish config)
 *  - Invalid signature → error event surfaces sanitised message, status='error',
 *    no install attempted
 *  - Version-downgrade behavior — current implementation accepts whatever
 *    electron-updater serves; we assert we don't override that decision.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// ── Mock electron-updater so the SUT module-load doesn't try to talk to a real server.
// We use vi.hoisted() so the mock object is created BEFORE the vi.mock factory runs
// (vi.mock is hoisted to the top of the file by Vitest's transform).
type Handler = (...args: any[]) => void
const { mockAutoUpdater, updaterHandlers } = vi.hoisted(() => {
  const handlers: Record<string, Handler[]> = {}
  return {
    updaterHandlers: handlers,
    mockAutoUpdater: {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      on: vi.fn((event: string, handler: Handler) => {
        handlers[event] = handlers[event] || []
        handlers[event].push(handler)
      }),
      checkForUpdates: vi.fn(() => Promise.resolve()),
      quitAndInstall: vi.fn(),
      setFeedURL: vi.fn(),
    },
  }
})

vi.mock('electron-updater', () => ({
  autoUpdater: mockAutoUpdater,
}))

// ── Mock electron's BrowserWindow so setStatus → broadcast doesn't crash
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '') },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      {
        webContents: {
          send: vi.fn(),
        },
      },
    ]),
  },
}))

// Import AFTER mocks
import {
  initAutoUpdater,
  checkForUpdates,
  quitAndInstall,
  getUpdateStatus,
  getUpdateVersion,
  getUpdateErrorMessage,
  sanitizeUpdateError,
} from './auto-updater'

beforeEach(() => {
  for (const k of Object.keys(updaterHandlers)) delete updaterHandlers[k]
  mockAutoUpdater.checkForUpdates.mockClear()
  mockAutoUpdater.quitAndInstall.mockClear()
  mockAutoUpdater.on.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

function fireEvent(name: string, ...args: any[]) {
  ;(updaterHandlers[name] || []).forEach((fn) => fn(...args))
}

// ════════════════════════════════════════════════════════════════════════════
// FEED URL — HTTPS, hard-coded
// ════════════════════════════════════════════════════════════════════════════

describe('feed URL — HTTPS, hard-coded', () => {
  const builderYmlPath = path.join(__dirname, '..', '..', 'electron-builder.yml')

  it('confirms electron-builder.yml publish.url is https:// (not http)', () => {
    const yml = fs.readFileSync(builderYmlPath, 'utf-8')
    // Find the generic provider's url. The publish block is a YAML list
    // (github + generic), so match the list-item form: `- provider: generic`
    // followed (after indented `url:`) by `https://`.
    expect(yml).toMatch(/-\s*provider:\s*generic\s*\n\s+url:\s*https:\/\//)
    // Explicitly: no http:// in publish url
    const publishMatch = yml.match(/publish:[\s\S]*?(?=\n\S|\n$)/)
    expect(publishMatch).toBeTruthy()
    expect(publishMatch![0]).toMatch(/url:\s*https:\/\/updates\.coasty\.ai/)
    expect(publishMatch![0]).not.toMatch(/url:\s*http:\/\//)
  })

  it('rejects HTTP update URL in published config (regression guard)', () => {
    const yml = fs.readFileSync(builderYmlPath, 'utf-8')
    // The whole publish block must use https
    expect(yml).not.toMatch(/provider:\s*generic[\s\S]*?url:\s*http:\/\//)
  })

  it('does not call autoUpdater.setFeedURL — feed URL is hard-coded by electron-builder, not modifiable at runtime', () => {
    initAutoUpdater()
    expect(mockAutoUpdater.setFeedURL).not.toHaveBeenCalled()
  })

  it('rejects environment-variable override of update URL (regression guard)', () => {
    process.env.COASTY_UPDATE_URL = 'http://evil.example.com/'
    process.env.UPDATE_URL = 'http://evil.example.com/'
    process.env.ELECTRON_UPDATER_URL = 'http://evil.example.com/'
    try {
      initAutoUpdater()
      // Even after init, no setFeedURL was called with an env-derived value
      expect(mockAutoUpdater.setFeedURL).not.toHaveBeenCalled()
      // And the source file does not reference any of the candidate env vars
      const src = fs.readFileSync(path.join(__dirname, 'auto-updater.ts'), 'utf-8')
      expect(src).not.toMatch(/process\.env\.[A-Z_]*UPDATE_URL/)
      expect(src).not.toMatch(/setFeedURL/)
    } finally {
      delete process.env.COASTY_UPDATE_URL
      delete process.env.UPDATE_URL
      delete process.env.ELECTRON_UPDATER_URL
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// SIGNATURE / INTEGRITY VERIFICATION
//
// electron-updater enforces SHA-512 sums (latest.yml) + Authenticode signature
// on Windows / Apple notarization on macOS BY DEFAULT. We must not disable it.
// ════════════════════════════════════════════════════════════════════════════

describe('signature verification', () => {
  it('does not disable electron-updater verification (no `disableDifferentialDownload` or `verifyUpdateCodeSignature` overrides)', () => {
    const src = fs.readFileSync(path.join(__dirname, 'auto-updater.ts'), 'utf-8')
    expect(src).not.toMatch(/verifyUpdateCodeSignature\s*=\s*null/)
    expect(src).not.toMatch(/verifyUpdateCodeSignature\s*=\s*\(\)\s*=>/)
    expect(src).not.toMatch(/disableWebInstaller\s*=\s*true/)
    // Don't disable the auto-built-in checks
    expect(src).not.toMatch(/allowDowngrade\s*=\s*true/)
  })

  it('confirms Windows installer is Azure-signed (publisherName configured)', () => {
    const yml = fs.readFileSync(path.join(__dirname, '..', '..', 'electron-builder.yml'), 'utf-8')
    expect(yml).toMatch(/azureSignOptions:/)
    expect(yml).toMatch(/codeSigningAccountName:/)
    expect(yml).toMatch(/certificateProfileName:/)
  })

  it('confirms macOS build is hardened-runtime + notarized (signature chain)', () => {
    const yml = fs.readFileSync(path.join(__dirname, '..', '..', 'electron-builder.yml'), 'utf-8')
    expect(yml).toMatch(/hardenedRuntime:\s*true/)
    expect(yml).toMatch(/notarize:\s*true/)
    expect(yml).toMatch(/entitlements:/)
  })

  it('refuses to install when error event fires with checksum/signature failure (status → error, no quitAndInstall)', () => {
    initAutoUpdater()
    fireEvent('error', new Error('sha512 checksum mismatch'))
    expect(getUpdateStatus()).toBe('error')
    // Caller did not call quitAndInstall, and no auto-call should have happened
    expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled()
    // Sanitised user-facing message
    expect(getUpdateErrorMessage()).toMatch(/integrity check failed|corrupt/i)
  })

  it('sanitises signature-related errors so paths/URLs/cert details do not leak', () => {
    expect(sanitizeUpdateError(new Error('sha512 mismatch in /tmp/update.exe')))
      .toBe('Update integrity check failed. The download may be corrupt.')
    expect(sanitizeUpdateError(new Error('SSL certificate self-signed for updates.coasty.ai')))
      .toBe('Update server certificate error. Try again later.')
    expect(sanitizeUpdateError(new Error('signature verification failed: cert chain broken')))
      .toBe('Update integrity check failed. The download may be corrupt.')
  })

  it('does NOT install on update-downloaded — only sets status to "ready"', () => {
    initAutoUpdater()
    fireEvent('update-downloaded', { version: '99.0.0' })
    expect(getUpdateStatus()).toBe('ready')
    expect(getUpdateVersion()).toBe('99.0.0')
    // CRITICAL: must NOT auto-relaunch
    expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// VERSION DOWNGRADE — behavior pin
// ════════════════════════════════════════════════════════════════════════════

describe('version downgrade behavior', () => {
  it('relies on electron-updater default (allowDowngrade=false) — code does not override', () => {
    const src = fs.readFileSync(path.join(__dirname, 'auto-updater.ts'), 'utf-8')
    // Documented behavior: no explicit downgrade-allow flag
    expect(src).not.toMatch(/allowDowngrade\s*=/)
    // electron-updater default is `allowDowngrade=false`, meaning a downgrade
    // would be rejected at the channel level. We pin that we don't flip it.
  })

  it('accepts whatever update-available info electron-updater reports (no version compare in our wrapper)', () => {
    initAutoUpdater()
    fireEvent('update-available', { version: '0.0.1' })
    // Our wrapper just transitions status — the version-validity decision is
    // electron-updater's responsibility. We pin we don't second-guess it.
    expect(getUpdateStatus()).toBe('available')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// TIMING — 5s initial delay, 4h interval
// ════════════════════════════════════════════════════════════════════════════

describe('timing — 5s initial check, 4h interval', () => {
  it('does NOT call checkForUpdates synchronously during init', () => {
    initAutoUpdater()
    // Should be 0 — there's a 5s delay before first call
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('calls checkForUpdates after a 5-second delay (not 30s, not 0s)', async () => {
    vi.useFakeTimers()
    initAutoUpdater()

    // Just before 5s — should not have fired
    await vi.advanceTimersByTimeAsync(4_999)
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled()

    // Exactly at 5s — fires once
    await vi.advanceTimersByTimeAsync(2)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('repeats at exactly 4-hour intervals (not 30s, not 1h)', async () => {
    vi.useFakeTimers()
    initAutoUpdater()

    // Skip past the initial 5s
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)

    // Advance 30s — must NOT fire again
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)

    // Advance 1h — still not yet
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)

    // Advance to exactly 4h after the initial 5s
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)

    // Another 4h
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(3)
  })

  it('rejects a hypothetical 30-second polling interval (regression guard)', () => {
    const src = fs.readFileSync(path.join(__dirname, 'auto-updater.ts'), 'utf-8')
    // The setInterval body must reference the 4-hour computation
    expect(src).toMatch(/setInterval\([\s\S]*?4\s*\*\s*60\s*\*\s*60\s*\*\s*1000/)
    // Must NOT use a short-poll interval expression like `30 * 1000`
    expect(src).not.toMatch(/setInterval\([\s\S]*?\b30\s*\*\s*1000\b/)
    expect(src).not.toMatch(/setInterval\([\s\S]*?\b60_000\b/)
    expect(src).not.toMatch(/setInterval\([\s\S]*?\b30_000\b/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// AUTO-RELAUNCH — only on explicit user action
// ════════════════════════════════════════════════════════════════════════════

describe('auto-relaunch policy', () => {
  it('does not call quitAndInstall during init', () => {
    initAutoUpdater()
    expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('does not call quitAndInstall on download-progress / update-available / update-downloaded', () => {
    initAutoUpdater()
    fireEvent('checking-for-update')
    fireEvent('update-available', { version: '99.0.0' })
    fireEvent('download-progress', { percent: 50 })
    fireEvent('update-downloaded', { version: '99.0.0' })
    expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('only calls quitAndInstall when the wrapper exports it (user-triggered)', () => {
    initAutoUpdater()
    expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled()
    quitAndInstall()
    expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('autoInstallOnAppQuit is true (silent install on natural quit) but autoDownload requires no user action — confirm no surprise relaunches', () => {
    initAutoUpdater()
    expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(true)
    // Note: this means a downloaded update WILL apply the next time the user
    // closes the app naturally. That's the documented contract — not a
    // surprise relaunch — but pin the behavior so a regression to
    // `autoInstall=true` (which would force-quit) is caught.
    expect(mockAutoUpdater.autoDownload).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// MANUAL CHECK
// ════════════════════════════════════════════════════════════════════════════

describe('checkForUpdates() public API', () => {
  it('forwards to electron-updater.checkForUpdates without arguments', () => {
    checkForUpdates()
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(mockAutoUpdater.checkForUpdates.mock.calls[0]).toHaveLength(0)
  })

  it('swallows rejection silently (no unhandled promise / no error throw)', async () => {
    mockAutoUpdater.checkForUpdates.mockRejectedValueOnce(new Error('network down'))
    expect(() => checkForUpdates()).not.toThrow()
    // Allow microtask queue to drain
    await Promise.resolve()
  })
})
