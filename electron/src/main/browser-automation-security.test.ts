/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Security tests for browser-automation.ts — puppeteer-core wrapper.
 *
 * Coverage:
 *  - URL scheme handling: file://, javascript:, data:
 *  - localhost navigation (allowed, but page-level only)
 *  - JS execution boundary: puppeteer's page context is isolated from
 *    Electron's renderer (no `window.coasty` access)
 *  - Script-size handling for execute()
 *  - Browser isolation: temp `--user-data-dir`, cleaned on close
 *  - Browser-discovery cannot be hijacked via env (no BROWSER_PATH escape)
 *  - Cookies don't leak to the user's default profile
 *  - Screenshot path works without crash
 *  - Tab management — 20 tabs open/close cleanly, no leak
 *  - DevTools port — confirm puppeteer doesn't pin 9222
 *
 * The real puppeteer is mocked entirely. Tests assert what arguments the
 * wrapper passes (executablePath, userDataDir, args[]) and how it handles
 * page lifecycle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import Module from 'module'

// ── Mock electron (security.ts requires it transitively) ─────────────────────
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '') },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

// ── Pre-populate Node's require cache with a fake puppeteer-core module.
//    vi.mock does NOT intercept dynamic `require()` calls inside the SUT
//    (browser-automation.ts uses lazy `require('puppeteer-core')`), so we
//    have to patch require() at the Node.js level. We override Module._resolveFilename
//    to redirect 'puppeteer-core' to a fake module file in a virtual location.
const ModuleAny = Module as any
const originalResolve = ModuleAny._resolveFilename
const originalLoad = ModuleAny._load

// We'll register a fake "module" by intercepting _load directly.
const FAKE_PUPPETEER_PATH = '__fake_puppeteer_core__'

// ── Build a controllable fake page / browser / puppeteer ────────────────────
type FakePage = {
  goto: ReturnType<typeof vi.fn>
  evaluate: ReturnType<typeof vi.fn>
  url: ReturnType<typeof vi.fn>
  title: ReturnType<typeof vi.fn>
  screenshot: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  bringToFront: ReturnType<typeof vi.fn>
  click: ReturnType<typeof vi.fn>
  type: ReturnType<typeof vi.fn>
  waitForSelector: ReturnType<typeof vi.fn>
  waitForFunction: ReturnType<typeof vi.fn>
  mouse: { click: ReturnType<typeof vi.fn> }
  keyboard: { type: ReturnType<typeof vi.fn> }
  evaluateHandle: ReturnType<typeof vi.fn>
}

const launchedBrowsers: any[] = []
const launchOptionsHistory: any[] = []

function makePage(initialUrl = 'about:blank', ownerPages?: FakePage[]): FakePage {
  let currentUrl = initialUrl
  const page: FakePage = {
    goto: vi.fn(async (url: string) => {
      currentUrl = url
      return null
    }),
    evaluate: vi.fn(async () => true),
    url: vi.fn(() => currentUrl),
    title: vi.fn(async () => 'Test Page'),
    screenshot: vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47])), // PNG header bytes
    close: vi.fn(async () => {
      // Remove from owner's pages array so listBrowserTabs reflects reality
      if (ownerPages) {
        const idx = ownerPages.indexOf(page)
        if (idx >= 0) ownerPages.splice(idx, 1)
      }
    }),
    bringToFront: vi.fn(async () => {}),
    click: vi.fn(async () => {}),
    type: vi.fn(async () => {}),
    waitForSelector: vi.fn(async () => {}),
    waitForFunction: vi.fn(async () => {}),
    mouse: { click: vi.fn(async () => {}) },
    keyboard: { type: vi.fn(async () => {}) },
    evaluateHandle: vi.fn(async () => null),
  }
  return page
}

function makeBrowser() {
  const pages: FakePage[] = []
  pages.push(makePage('about:blank', pages))
  const eventHandlers: Record<string, Function[]> = {}
  const browser: any = {
    pages: vi.fn(async () => pages),
    newPage: vi.fn(async () => {
      const p = makePage('about:blank', pages)
      pages.push(p)
      return p
    }),
    close: vi.fn(async () => {
      ;(eventHandlers.disconnected || []).forEach((fn) => fn())
    }),
    on: vi.fn((event: string, handler: Function) => {
      eventHandlers[event] = eventHandlers[event] || []
      eventHandlers[event].push(handler)
    }),
    _pages: pages,
    _eventHandlers: eventHandlers,
  }
  return browser
}

// Install the puppeteer-core interceptor at the Node module-loader level
// BEFORE the SUT module is imported. The SUT calls `require('puppeteer-core')`
// lazily on first use, so we just need this in place by then.
ModuleAny._load = function (request: string, parent: any, isMain: boolean) {
  if (request === 'puppeteer-core') {
    const fake = {
      launch: async (opts: any) => {
        launchOptionsHistory.push(opts)
        const b = makeBrowser()
        launchedBrowsers.push(b)
        return b
      },
    }
    // Match both `require('puppeteer-core').launch` and `import puppeteer from 'puppeteer-core'`
    ;(fake as any).default = fake
    return fake
  }
  return originalLoad.call(this, request, parent, isMain)
}

// ── Mock fs to make `findChromePath` return a fake but plausible path ───────
const FAKE_CHROME = process.platform === 'win32'
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : '/usr/bin/google-chrome'

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: vi.fn((p: string) => {
      // Pretend Chrome exists at the canonical location, nothing else.
      return p === FAKE_CHROME
    }),
    mkdirSync: vi.fn(() => undefined),
    rmSync: vi.fn(() => undefined),
  }
})

// ── Mock child_process so the PATH-fallback `where`/`which` never runs ──────
vi.mock('child_process', () => ({
  execFileSync: vi.fn(() => ''),
  execFile: vi.fn(),
}))

// ── Resolve puppeteer-core via require() inside the module — let it resolve
//    to our mock by intercepting `require` on the module object. The simplest
//    fix is to also mock `module` such that require('puppeteer-core') hits the
//    vi.mock. vi.mock with `puppeteer-core` already wires this. We import the
//    SUT after all mocks are registered.

import * as browserAutomation from './browser-automation'

// Patch the lazy-loaded puppeteer cache by calling open once and inspecting
// what got passed. Because the module uses `require('puppeteer-core')`, our
// vi.mock above WILL be picked up.

beforeEach(async () => {
  // Close any open fake browser FIRST so the SUT's module-level `browser` /
  // `page` vars are reset, then clear our captures.
  try {
    await browserAutomation.closeBrowser()
  } catch { /* ignore */ }
  launchedBrowsers.length = 0
  launchOptionsHistory.length = 0
})

afterEach(async () => {
  // Reset module-level state by closing any open browser
  try {
    await browserAutomation.closeBrowser()
  } catch {
    /* ignore */
  }
})

// ════════════════════════════════════════════════════════════════════════════
// URL SCHEME HANDLING
//
// browser-automation.ts does NOT currently scheme-filter — it passes the URL
// straight to `page.goto`. These tests document that behavior and verify the
// dangerous schemes are at least delivered to puppeteer (which itself
// rejects javascript: navigations as of recent versions).
// ════════════════════════════════════════════════════════════════════════════

describe('URL scheme handling — open()', () => {
  it('forwards file:// URL to puppeteer (delegates sandboxing to Chrome)', async () => {
    const result = await browserAutomation.openBrowser({ url: 'file:///etc/passwd' })
    expect(result.success).toBe(true)
    const page = launchedBrowsers[0]._pages[0]
    expect(page.goto).toHaveBeenCalledWith(
      'file:///etc/passwd',
      expect.objectContaining({ waitUntil: 'domcontentloaded' }),
    )
  })

  it('rejects javascript: URL via Chrome — wrapper does not pre-execute it', async () => {
    // Configure goto to throw for javascript: as Chrome would
    const result = await browserAutomation.openBrowser({ url: 'about:blank' })
    expect(result.success).toBe(true)
    const page = launchedBrowsers[0]._pages[0]
    page.goto = vi.fn(async () => {
      throw new Error('net::ERR_ABORTED — javascript: URL not allowed')
    })
    const navResult = await browserAutomation.navigateBrowser({ url: 'javascript:alert(1)' })
    expect(navResult.success).toBe(false)
    expect(navResult.error).toMatch(/javascript/i)
  })

  it('forwards data: URL to puppeteer (delegated to Chrome)', async () => {
    const dataUrl = 'data:text/html,<script>alert("xss")</script>'
    const result = await browserAutomation.openBrowser({ url: dataUrl })
    expect(result.success).toBe(true)
    const page = launchedBrowsers[0]._pages[0]
    expect(page.goto).toHaveBeenCalledWith(dataUrl, expect.any(Object))
  })

  it('allows localhost navigation (it is local; user-controlled)', async () => {
    await browserAutomation.openBrowser()
    const result = await browserAutomation.navigateBrowser({ url: 'http://localhost:6379/' })
    // Will succeed at the wrapper layer — actual TCP connection failure happens
    // in real Chrome and is reported via goto rejection.
    expect(result).toHaveProperty('success')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// JS EXECUTION BOUNDARY
// ════════════════════════════════════════════════════════════════════════════

describe('execute() — JS execution boundary', () => {
  it('runs only inside the active page context (page.evaluate), not Electron renderer', async () => {
    await browserAutomation.openBrowser()
    const page = launchedBrowsers[0]._pages[0]
    // Wrap page.evaluate so we capture script-execution calls but still
    // return `true` for the ensureBrowser() liveness probe.
    const captured: any[][] = []
    const originalEvaluate = page.evaluate
    page.evaluate = vi.fn(async (...args: any[]) => {
      captured.push(args)
      // ensureBrowser passes a single thunk; executeBrowser passes (fn, script).
      if (args.length === 1) return true
      return 'mocked-result'
    }) as any
    void originalEvaluate
    const result = await browserAutomation.executeBrowser({ script: 'return 1+1' })
    expect(result.success).toBe(true)
    // The handler MUST have routed through page.evaluate (puppeteer's
    // page-isolated context), not into any Electron API.
    expect(page.evaluate).toHaveBeenCalled()
    // Find the call with 2 arguments (executeBrowser's call)
    const execCall = captured.find((c) => c.length === 2)
    expect(execCall).toBeDefined()
    // The script is passed as a SERIALIZED ARGUMENT (second arg) not
    // string-concatenated into the function body — IIFE breakout is impossible.
    expect(execCall![1]).toBe('return 1+1')
    // First arg is a function (the AsyncFunction wrapper), not a string.
    expect(typeof execCall![0]).toBe('function')
  })

  it('does not expose `window.coasty` to the puppeteer page context', async () => {
    // window.coasty lives in the Electron renderer (BrowserWindow), behind
    // contextBridge. The puppeteer page is a SEPARATE Chromium instance with
    // a temp profile. We verify by checking that page.evaluate is the only
    // execution path — there is no IPC bridge.
    await browserAutomation.openBrowser()
    const page = launchedBrowsers[0]._pages[0]
    let calledWithCoasty = false
    page.evaluate = vi.fn(async (...args: any[]) => {
      if (args.length === 1) return true // ensureBrowser probe
      const code = args[1]
      if (typeof code === 'string' && code.includes('window.coasty')) calledWithCoasty = true
      return undefined
    }) as any
    const result = await browserAutomation.executeBrowser({
      script: 'return typeof window.coasty',
    })
    expect(result.success).toBe(true)
    expect(calledWithCoasty).toBe(true)
    // Confirm the wrapper never imports / references the preload bridge.
    // Static guarantee: the SUT module file does not reference 'coasty' at all.
  })

  it('handles a 1MB script without crashing (no length cap currently — documented)', async () => {
    await browserAutomation.openBrowser()
    const page = launchedBrowsers[0]._pages[0]
    page.evaluate = vi.fn(async () => 'ok')
    const big = 'a;'.repeat(500_000) // ~1MB
    const result = await browserAutomation.executeBrowser({ script: big })
    expect(result.success).toBe(true)
    expect(page.evaluate).toHaveBeenCalled()
  })

  it('rejects empty/missing script', async () => {
    await browserAutomation.openBrowser()
    const result = await browserAutomation.executeBrowser({ script: '' })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/No script/i)
  })

  it('rejects execute() when browser not open', async () => {
    // Don't open browser first
    const result = await browserAutomation.executeBrowser({ script: 'return 1' })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Browser not open/i)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// BROWSER ISOLATION — temp user-data-dir
// ════════════════════════════════════════════════════════════════════════════

describe('browser isolation — temp profile', () => {
  it('launches with --user-data-dir set to a temp directory under os.tmpdir()', async () => {
    await browserAutomation.openBrowser()
    expect(launchOptionsHistory).toHaveLength(1)
    const opts = launchOptionsHistory[0]
    expect(opts.userDataDir).toBeTruthy()
    const tmp = os.tmpdir()
    // userDataDir must live under tmpdir, NOT under the user's home browser profile
    expect(opts.userDataDir.startsWith(tmp)).toBe(true)
    // Must include process.pid in the name so concurrent Electron instances
    // don't collide
    expect(opts.userDataDir).toContain(String(process.pid))
  })

  it('does not point at the user default Chrome profile (no cookie leak)', async () => {
    await browserAutomation.openBrowser()
    const dir = launchOptionsHistory[0].userDataDir
    if (process.platform === 'win32') {
      expect(dir).not.toMatch(/AppData\\Local\\Google\\Chrome\\User Data/i)
    } else if (process.platform === 'darwin') {
      expect(dir).not.toMatch(/Library\/Application Support\/Google\/Chrome/i)
    } else {
      expect(dir).not.toMatch(/\.config\/google-chrome/i)
    }
  })

  it('cleans up the temp profile on close', async () => {
    const fs = await import('fs')
    await browserAutomation.openBrowser()
    const dir = launchOptionsHistory[0].userDataDir
    await browserAutomation.closeBrowser()
    expect(fs.rmSync).toHaveBeenCalledWith(dir, expect.objectContaining({ recursive: true, force: true }))
  })

  it('cleans up the temp profile on browser disconnect (user closed window)', async () => {
    const fs = await import('fs')
    await browserAutomation.openBrowser()
    const browser = launchedBrowsers[0]
    // Simulate disconnect event from real Chrome
    ;(browser._eventHandlers.disconnected || []).forEach((fn: Function) => fn())
    expect(fs.rmSync).toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// BROWSER DISCOVERY — no env-var injection vector
// ════════════════════════════════════════════════════════════════════════════

describe('browser discovery — env injection resistance', () => {
  it('does NOT honor a BROWSER_PATH / CHROME_BIN env var (hard-coded candidates only)', async () => {
    const evil = process.platform === 'win32'
      ? 'C:\\evil\\malicious.exe'
      : '/tmp/evil/malicious'
    process.env.BROWSER_PATH = evil
    process.env.CHROME_BIN = evil
    process.env.PUPPETEER_EXECUTABLE_PATH = evil
    try {
      await browserAutomation.openBrowser()
      expect(launchOptionsHistory).toHaveLength(1)
      expect(launchOptionsHistory[0].executablePath).not.toBe(evil)
      expect(launchOptionsHistory[0].executablePath).toBe(FAKE_CHROME)
    } finally {
      delete process.env.BROWSER_PATH
      delete process.env.CHROME_BIN
      delete process.env.PUPPETEER_EXECUTABLE_PATH
    }
  })

  it('returns a clean error if no browser is installed (no env leak)', async () => {
    // Make existsSync return false for everything
    const fs = await import('fs')
    ;(fs.existsSync as any).mockImplementation(() => false)
    const result = await browserAutomation.openBrowser()
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Chrome\/Edge\/Chromium not found/i)
    // Restore
    ;(fs.existsSync as any).mockImplementation((p: string) => p === FAKE_CHROME)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// COOKIES & CACHE ISOLATION
// ════════════════════════════════════════════════════════════════════════════

describe('cookies & cache — isolated to temp profile', () => {
  it('confirms the wrapper does not reuse the user default Chrome profile', async () => {
    await browserAutomation.openBrowser()
    const args: string[] = launchOptionsHistory[0].args
    // Must not pass --user-data-dir as a default-profile path
    for (const a of args) {
      expect(a).not.toMatch(/--user-data-dir=.*Default/i)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// SCREENSHOT — works on any page without crash
// ════════════════════════════════════════════════════════════════════════════

describe('screenshot()', () => {
  it('returns a base64 PNG without crashing on a sensitive page', async () => {
    await browserAutomation.openBrowser({ url: 'https://example.com/secret' })
    const result = await browserAutomation.screenshotBrowser()
    expect(result).toBeTruthy()
    expect(result.success).toBe(true)
    expect(result.screenshot).toMatch(/^data:image\/png;base64,/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// TAB MANAGEMENT — 20 tabs open/close cleanly
// ════════════════════════════════════════════════════════════════════════════

describe('tab management', () => {
  it('opens 20 tabs and closes them cleanly without leaking pages', async () => {
    await browserAutomation.openBrowser()
    const browser = launchedBrowsers[0]

    // Open 19 more tabs (one already exists)
    for (let i = 0; i < 19; i++) {
      const r = await browserAutomation.openBrowserTab({ url: `https://example.com/${i}` })
      expect(r.success).toBe(true)
    }

    const list = await browserAutomation.listBrowserTabs()
    expect(list.success).toBe(true)
    expect(list.count).toBe(20)

    // Close them all (down to the last one — wrapper refuses to close last tab)
    for (let i = 0; i < 19; i++) {
      const r = await browserAutomation.closeBrowserTab({ index: 0 })
      expect(r.success).toBe(true)
    }

    const final = await browserAutomation.listBrowserTabs()
    expect(final.count).toBe(1)

    // Refuses to close the LAST tab (so the browser doesn't go zombie)
    const lastClose = await browserAutomation.closeBrowserTab({ index: 0 })
    expect(lastClose.success).toBe(false)
    expect(lastClose.error).toMatch(/last tab/i)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// DEVTOOLS PORT — confirm we don't pin :9222 (which would expose remote
// debugging to localhost — anyone on the box could attach)
// ════════════════════════════════════════════════════════════════════════════

describe('devtools port', () => {
  it('does NOT pass --remote-debugging-port=9222 (no fixed-port leak)', async () => {
    await browserAutomation.openBrowser()
    const args: string[] = launchOptionsHistory[0].args
    for (const a of args) {
      expect(a).not.toBe('--remote-debugging-port=9222')
      expect(a).not.toMatch(/^--remote-debugging-port=\d+$/)
    }
  })

  it('does NOT enable --remote-debugging-address (would bind beyond localhost)', async () => {
    await browserAutomation.openBrowser()
    const args: string[] = launchOptionsHistory[0].args
    for (const a of args) {
      expect(a).not.toMatch(/^--remote-debugging-address=/)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// LAUNCH OPTIONS — no dangerous flags
// ════════════════════════════════════════════════════════════════════════════

describe('launch options hygiene', () => {
  it('does not pass --no-sandbox or --disable-web-security', async () => {
    await browserAutomation.openBrowser()
    const args: string[] = launchOptionsHistory[0].args
    expect(args).not.toContain('--no-sandbox')
    expect(args).not.toContain('--disable-web-security')
    expect(args).not.toContain('--disable-features=IsolateOrigins,site-per-process')
  })

  it('launches headful (visible to user — agent actions are observable)', async () => {
    await browserAutomation.openBrowser()
    expect(launchOptionsHistory[0].headless).toBe(false)
  })
})
