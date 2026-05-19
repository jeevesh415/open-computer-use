/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Corner-case tests for browser-automation.ts.
 *
 * Existing coverage was security-focused (browser-automation-security.test.ts)
 * — none of the runtime failure modes were tested. The audit flagged this as
 * the highest-risk untested area in the codebase. This file fills the worst
 * gaps:
 *
 *   1. Browser binary not installed → clean actionable error
 *   2. Puppeteer launch failure → state RESET so the next call can retry
 *   3. Browser disconnect mid-session → state cleared so the next ensureBrowser
 *      reports "not open" instead of using a dead handle
 *   4. Navigation timeout → structured error, distinguishable from other errors
 *   5. Concurrent commands on shared module-level `page` → no future-mixup
 *   6. executeBrowser script throws → user-visible error preserved
 *   7. Tab management edge cases (negative/out-of-range index)
 *   8. screenshotBrowser fallback null signal
 *   9. closeBrowser cleanup robustness (locked userDataDir, throw)
 *   10. waitBrowser timeout cap
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Module from 'module'

// ── Hoisted control surface ──────────────────────────────────────────────
// Defined via vi.hoisted so the vi.mock factories below can reference it.
const h = vi.hoisted(() => {
  const FAKE_CHROME = process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '/usr/bin/google-chrome'

  const ctl = {
    chromePathExists: true,
    launchBehaviour: 'success' as 'success' | 'throw',
    launchError: 'spawn ENOENT',
    pageGotoBehaviour: 'success' as 'success' | 'timeout',
    pageEvaluateBehaviour: 'success' as 'success' | 'throw' | 'undefined',
    pageEvaluateValue: 'evaluated-result' as any,
    pageEvaluateThrowMsg: 'user script error',
    healthCheckBehaviour: 'alive' as 'alive' | 'dead',
    closeBehaviour: 'success' as 'success' | 'throw',
    rmSyncThrows: false,
    pageScreenshotThrows: false,
    disconnectListeners: [] as Array<() => void>,
  }
  return { ctl, FAKE_CHROME }
})

// ── vi.mock for fs/child_process — vitest hoists these correctly ─────────
vi.mock('fs', async () => {
  const realFs = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...realFs,
    existsSync: (p: any) => {
      if (typeof p === 'string' && /chrome\.exe|msedge\.exe|brave\.exe|google-chrome|chromium|Microsoft Edge|Brave Browser/i.test(p)) {
        return h.ctl.chromePathExists && p === h.FAKE_CHROME
      }
      return realFs.existsSync(p)
    },
    mkdirSync: () => undefined,
    rmSync: (...args: any[]) => {
      if (h.ctl.rmSyncThrows) throw new Error('EBUSY: resource locked')
      try { return (realFs.rmSync as any)(...args) } catch { /* ignore */ }
    },
  }
})

vi.mock('child_process', () => ({
  execFileSync: () => { throw new Error('not on PATH') },
}))

// ── Module._load interception for puppeteer-core (lazy `require()`) ──────
// vi.mock does NOT intercept dynamic `require()` calls. The SUT uses
// `require('puppeteer-core')` lazily, so we patch Node's loader directly.

function makePage(initialUrl: string, ownerPages: any[]) {
  const p: any = {
    _url: initialUrl,
    url() { return this._url },
    async goto(url: string, _opts?: any) {
      if (h.ctl.pageGotoBehaviour === 'timeout') {
        throw new Error('Navigation timeout of 30000 ms exceeded')
      }
      this._url = url
    },
    async title() { return 'Test Page' },
    // The health check (ensureBrowser) calls `page.evaluate(() => true)` with
    // NO extra args. Real script execution passes the script as a 2nd arg.
    // We differentiate by args.length so a "throw on user code" setting does
    // not also trip the health check.
    async evaluate(_fn: any, ...args: any[]) {
      if (args.length === 0) {
        // Health check or DOM-read path
        if (h.ctl.healthCheckBehaviour === 'dead') {
          throw new Error('Browser disconnected')
        }
        return true
      }
      // Script-execute path
      if (h.ctl.pageEvaluateBehaviour === 'throw') {
        throw new Error(h.ctl.pageEvaluateThrowMsg)
      }
      if (h.ctl.pageEvaluateBehaviour === 'undefined') return undefined
      return h.ctl.pageEvaluateValue
    },
    async click(_selector: string) { /* noop */ },
    mouse: { async click(_x: number, _y: number) { /* noop */ } },
    keyboard: { async type(_t: string) { /* noop */ } },
    async type(_sel: string, _t: string) { /* noop */ },
    async screenshot(_opts?: any) {
      if (h.ctl.pageScreenshotThrows) throw new Error('Page is detached')
      return Buffer.from([0x89, 0x50, 0x4e, 0x47]) // PNG header bytes
    },
    async waitForSelector(_sel: string, _opts?: any) { /* noop */ },
    async waitForFunction(_fn: any, _opts: any, ..._args: any[]) { /* noop */ },
    async bringToFront() { /* noop */ },
    async close() {
      const idx = ownerPages.indexOf(p)
      if (idx >= 0) ownerPages.splice(idx, 1)
    },
    async evaluateHandle(_fn: any, ..._args: any[]) {
      return { async click() { /* noop */ } }
    },
  }
  return p
}

function makeBrowser() {
  const pages: any[] = []
  pages.push(makePage('about:blank', pages))
  const handlers: Record<string, Function[]> = {}
  return {
    async pages() { return pages },
    async newPage() {
      const p = makePage('about:blank', pages)
      pages.push(p)
      return p
    },
    on(event: string, cb: () => void) {
      handlers[event] = handlers[event] || []
      handlers[event].push(cb)
      if (event === 'disconnected') h.ctl.disconnectListeners.push(cb)
    },
    async close() {
      if (h.ctl.closeBehaviour === 'throw') throw new Error('close failed')
      ;(handlers.disconnected || []).forEach((fn) => fn())
    },
  }
}

const ModuleAny = Module as any
const originalLoad = ModuleAny._load
ModuleAny._load = function (request: string, parent: any, isMain: boolean) {
  if (request === 'puppeteer-core') {
    const fake: any = {
      launch: async (_opts: any) => {
        if (h.ctl.launchBehaviour === 'throw') {
          throw new Error(h.ctl.launchError)
        }
        return makeBrowser()
      },
    }
    fake.default = fake
    return fake
  }
  return originalLoad.call(this, request, parent, isMain)
}

// SUT must be imported AFTER the loader patch is in place.
import * as ba from './browser-automation'

// ── Test setup / teardown ────────────────────────────────────────────────

function resetCtl() {
  h.ctl.chromePathExists = true
  h.ctl.launchBehaviour = 'success'
  h.ctl.launchError = 'spawn ENOENT'
  h.ctl.pageGotoBehaviour = 'success'
  h.ctl.pageEvaluateBehaviour = 'success'
  h.ctl.pageEvaluateValue = 'evaluated-result'
  h.ctl.pageEvaluateThrowMsg = 'user script error'
  h.ctl.healthCheckBehaviour = 'alive'
  h.ctl.closeBehaviour = 'success'
  h.ctl.rmSyncThrows = false
  h.ctl.pageScreenshotThrows = false
  h.ctl.disconnectListeners = []
}

beforeEach(async () => {
  resetCtl()
  // Reset module-level state by closing any browser opened by a previous test
  try { await ba.closeBrowser() } catch { /* ignore */ }
})

afterEach(async () => {
  try { await ba.closeBrowser() } catch { /* ignore */ }
})

// ════════════════════════════════════════════════════════════════════════
// 1. Browser-not-found returns clean actionable error
// ════════════════════════════════════════════════════════════════════════

describe('browser discovery', () => {
  it('no Chrome/Edge installed → clean error with install hint', async () => {
    h.ctl.chromePathExists = false
    const result = await ba.openBrowser({ url: 'https://example.com' })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Chrome.*Edge.*not found|Install Google Chrome/i)
    // Must not leak puppeteer's internal stack frame
    expect(result.error).not.toMatch(/at\s.+\(.+:\d+:\d+\)/)
  })

  it('browser-not-found does NOT corrupt module state — second call still fails cleanly', async () => {
    h.ctl.chromePathExists = false
    const r1 = await ba.openBrowser({ url: 'https://a' })
    const r2 = await ba.openBrowser({ url: 'https://b' })
    expect(r1.success).toBe(false)
    expect(r2.success).toBe(false)
    expect(r2.error).toEqual(r1.error)
  })
})

// ════════════════════════════════════════════════════════════════════════
// 2. Puppeteer launch failure resets state for retry
// ════════════════════════════════════════════════════════════════════════

describe('puppeteer launch failure', () => {
  it('launch() throws → returns structured error AND resets module state', async () => {
    h.ctl.launchBehaviour = 'throw'
    h.ctl.launchError = 'Failed to launch the browser process'
    const r = await ba.openBrowser({ url: 'https://x' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('Browser launch failed')
    expect(r.error).toContain('Failed to launch the browser process')

    // After a failed launch, recover: subsequent successful launch must work
    h.ctl.launchBehaviour = 'success'
    const r2 = await ba.openBrowser({})
    expect(r2.success).toBe(true)
  })

  it('any subsequent command before retry returns "Browser not open"', async () => {
    h.ctl.launchBehaviour = 'throw'
    await ba.openBrowser({})
    const r = await ba.clickBrowser({ selector: '#nope' })
    expect(r.success).toBe(false)
    expect(r.error).toBe('Browser not open')
  })
})

// ════════════════════════════════════════════════════════════════════════
// 3. Browser disconnect mid-session
// ════════════════════════════════════════════════════════════════════════

describe('browser disconnect mid-session', () => {
  it('disconnect event clears module state — next health check reports closed', async () => {
    await ba.openBrowser({ url: 'https://x' })
    expect(h.ctl.disconnectListeners.length).toBeGreaterThan(0)

    const before = await ba.getBrowserState({})
    expect(before.is_open).toBe(true)

    // Simulate browser crash
    h.ctl.disconnectListeners.forEach((fn) => fn())
    h.ctl.healthCheckBehaviour = 'dead'

    const after = await ba.getBrowserState({})
    expect(after.is_open).toBe(false)
    expect(after.success).toBe(false)
  })

  it('clickBrowser after disconnect → clean error, never hangs', async () => {
    await ba.openBrowser({})
    h.ctl.disconnectListeners.forEach((fn) => fn())
    h.ctl.healthCheckBehaviour = 'dead'

    const r = await ba.clickBrowser({ selector: '#x' })
    expect(r.success).toBe(false)
    expect(r.error).toBe('Browser not open')
  })
})

// ════════════════════════════════════════════════════════════════════════
// 4. Navigation timeout produces structured error
// ════════════════════════════════════════════════════════════════════════

describe('navigation timeout', () => {
  it('goto() exceeds 30s → returns clean error with "timeout" keyword preserved', async () => {
    await ba.openBrowser({})
    h.ctl.pageGotoBehaviour = 'timeout'

    const r = await ba.navigateBrowser({ url: 'https://slow.example' })
    expect(r.success).toBe(false)
    expect(r.error.toLowerCase()).toContain('timeout')
  })

  it('navigation timeout does NOT mark browser as closed', async () => {
    await ba.openBrowser({})
    h.ctl.pageGotoBehaviour = 'timeout'
    await ba.navigateBrowser({ url: 'https://slow.example' })

    h.ctl.pageGotoBehaviour = 'success'
    const state = await ba.getBrowserState({})
    expect(state.is_open).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════════════
// 5. Concurrent commands — must not corrupt module state
// ════════════════════════════════════════════════════════════════════════

describe('concurrent commands', () => {
  it('two clickBrowser calls in parallel both resolve without corrupting page state', async () => {
    await ba.openBrowser({})

    const [r1, r2] = await Promise.all([
      ba.clickBrowser({ selector: '#a' }),
      ba.clickBrowser({ selector: '#b' }),
    ])
    expect(r1.success).toBe(true)
    expect(r2.success).toBe(true)

    const state = await ba.getBrowserState({})
    expect(state.is_open).toBe(true)
  })

  it('navigate + click interleaving — neither produces a dangling promise', async () => {
    await ba.openBrowser({})

    const [nav, click] = await Promise.all([
      ba.navigateBrowser({ url: 'https://a' }),
      ba.clickBrowser({ selector: '#x' }),
    ])
    expect(nav).toHaveProperty('success')
    expect(click).toHaveProperty('success')
  })
})

// ════════════════════════════════════════════════════════════════════════
// 6. executeBrowser script failures preserved + edge cases
// ════════════════════════════════════════════════════════════════════════

describe('executeBrowser', () => {
  it('user script throws → error message preserved (not swallowed)', async () => {
    await ba.openBrowser({})
    h.ctl.pageEvaluateBehaviour = 'throw'
    h.ctl.pageEvaluateThrowMsg = 'specific user-code failure XYZ'

    const r = await ba.executeBrowser({ script: 'throw new Error("specific user-code failure XYZ")' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('specific user-code failure XYZ')
  })

  it('empty / missing script returns clean error without invoking page.evaluate', async () => {
    await ba.openBrowser({})
    const r1 = await ba.executeBrowser({})
    expect(r1.success).toBe(false)
    expect(r1.error).toBe('No script/code provided')
    const r2 = await ba.executeBrowser({ script: '' })
    expect(r2.success).toBe(false)
    expect(r2.error).toBe('No script/code provided')
  })

  it('script returns undefined → result message says executed (not a confusing "undefined")', async () => {
    await ba.openBrowser({})
    h.ctl.pageEvaluateBehaviour = 'undefined'

    const r = await ba.executeBrowser({ script: 'console.log("hi")' })
    expect(r.success).toBe(true)
    expect(r.result).toBe('Script executed')
  })

  it('aliases: `code` parameter is accepted (some agent versions emit `code` not `script`)', async () => {
    await ba.openBrowser({})
    h.ctl.pageEvaluateValue = 42
    const r = await ba.executeBrowser({ code: 'return 42' })
    expect(r.success).toBe(true)
    expect(r.result).toBe('42')
  })
})

// ════════════════════════════════════════════════════════════════════════
// 7. Tab management — index validation + edge cases
// ════════════════════════════════════════════════════════════════════════

describe('tab management edge cases', () => {
  it('switchBrowserTab with negative index → out-of-range error', async () => {
    await ba.openBrowser({})
    const r = await ba.switchBrowserTab({ index: -1 })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/out of range/i)
  })

  it('switchBrowserTab beyond tab count → out-of-range error includes actual count', async () => {
    await ba.openBrowser({})
    const r = await ba.switchBrowserTab({ index: 5 })
    expect(r.success).toBe(false)
    expect(r.error).toContain('5')
    expect(r.error).toContain('1') // actual tab count
  })

  it('closeBrowserTab when only one tab remains → refuses to close', async () => {
    await ba.openBrowser({})
    const r = await ba.closeBrowserTab({})
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/last tab/i)
  })

  it('openBrowserTab + listBrowserTabs round-trip', async () => {
    await ba.openBrowser({})
    await ba.openBrowserTab({ url: 'https://second.example' })

    const list = await ba.listBrowserTabs({})
    expect(list.success).toBe(true)
    expect(list.count).toBe(2)
    const active = list.tabs.find((t: any) => t.active)
    expect(active).toBeDefined()
  })

  it('listBrowserTabs when browser is not open → returns empty list, not error', async () => {
    const r = await ba.listBrowserTabs({})
    expect(r.success).toBe(true)
    expect(r.tabs).toEqual([])
    expect(r.count).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════════════
// 8. screenshotBrowser fallback signal
// ════════════════════════════════════════════════════════════════════════

describe('screenshotBrowser', () => {
  it('returns null when browser is not open → caller falls back to desktop screenshot', async () => {
    const r = await ba.screenshotBrowser({})
    expect(r).toBeNull()
  })

  it('page.screenshot throws → also returns null (caller falls back)', async () => {
    await ba.openBrowser({})
    h.ctl.pageScreenshotThrows = true
    const r = await ba.screenshotBrowser({})
    expect(r).toBeNull()
  })

  it('successful screenshot returns base64 data-URI', async () => {
    await ba.openBrowser({})
    const r = await ba.screenshotBrowser({})
    expect(r).not.toBeNull()
    expect(r.success).toBe(true)
    expect(r.screenshot).toMatch(/^data:image\/png;base64,/)
    expect(r.frontendScreenshot).toBe(r.screenshot)
  })
})

// ════════════════════════════════════════════════════════════════════════
// 9. Cleanup robustness
// ════════════════════════════════════════════════════════════════════════

describe('closeBrowser cleanup', () => {
  it('userDataDir locked (EBUSY on Windows) → still resets state and returns success', async () => {
    h.ctl.rmSyncThrows = true
    await ba.openBrowser({})
    const r = await ba.closeBrowser({})
    expect(r.success).toBe(true)
    h.ctl.rmSyncThrows = false
    const r2 = await ba.openBrowser({})
    expect(r2.success).toBe(true)
  })

  it('browser.close() throws → state still reset for retry', async () => {
    h.ctl.closeBehaviour = 'throw'
    await ba.openBrowser({})
    const r = await ba.closeBrowser({})
    expect(r.success).toBe(false)
    h.ctl.closeBehaviour = 'success'
    const r2 = await ba.openBrowser({})
    expect(r2.success).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════════════
// 10. waitBrowser — bounds + selector + timeout
// ════════════════════════════════════════════════════════════════════════

describe('waitBrowser', () => {
  it('caps timeout at 30000 ms (security: no infinite waits)', async () => {
    await ba.openBrowser({})
    const r = await ba.waitBrowser({ timeout: 999_999_999 })
    expect(r.success).toBe(true)
    expect(r.message).toMatch(/30000ms/)
  }, 60_000)

  it('selector + timeout passed through to waitForSelector', async () => {
    await ba.openBrowser({})
    const r = await ba.waitBrowser({ selector: '#login', timeout: 5000 })
    expect(r.success).toBe(true)
    expect(r.message).toMatch(/#login/)
  })
})
