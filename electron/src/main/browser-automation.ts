import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { execFileSync } from 'child_process'

let puppeteer: typeof import('puppeteer-core') | null = null
let browser: any = null
let page: any = null
let userDataDir: string | null = null

async function getPuppeteer() {
  if (!puppeteer) {
    puppeteer = require('puppeteer-core')
  }
  return puppeteer!
}

function findChromePath(): string | null {
  const candidates: string[] = []

  if (process.platform === 'win32') {
    const pf = process.env['PROGRAMFILES'] || 'C:\\Program Files'
    const pf86 = process.env['PROGRAMFILES(X86)'] || process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const localApp = process.env['LOCALAPPDATA'] || path.join(os.homedir(), 'AppData', 'Local')

    // Chrome
    candidates.push(
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(localApp, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    )
    // Edge (very common on Windows, reliable fallback)
    candidates.push(
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    )
    // Brave
    candidates.push(
      path.join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(localApp, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    )
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    )
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/usr/bin/microsoft-edge',
      '/usr/bin/brave-browser',
    )
  }

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        console.log(`[Browser] Found browser at: ${candidate}`)
        return candidate
      }
    } catch { /* skip */ }
  }

  // Windows fallback: use 'where' to find chrome/msedge on PATH.
  // ``where.exe`` output is normally a few hundred bytes — well below
  // any conceivable maxBuffer — but we set the 10 MB cap consistently
  // across every exec callsite so a corrupted PATH (rare but seen on
  // CI runners with thousands of entries) can't trip the 1 MB default.
  // See terminal.ts MAX_OUTPUT_BUFFER_BYTES for the 2026-05-17 fix.
  if (process.platform === 'win32') {
    for (const exe of ['chrome.exe', 'msedge.exe']) {
      try {
        const result = execFileSync('where', [exe], {
          timeout: 5000,
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024,
        })
        const firstLine = result.trim().split('\n')[0]?.trim()
        if (firstLine && fs.existsSync(firstLine)) {
          console.log(`[Browser] Found browser via PATH: ${firstLine}`)
          return firstLine
        }
      } catch { /* not on PATH */ }
    }
  }

  // macOS/Linux fallback: use 'which'
  if (process.platform !== 'win32') {
    for (const exe of ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium', 'microsoft-edge']) {
      try {
        const result = execFileSync('which', [exe], {
          timeout: 5000,
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024,
        })
        const firstLine = result.trim().split('\n')[0]?.trim()
        if (firstLine && fs.existsSync(firstLine)) {
          console.log(`[Browser] Found browser via which: ${firstLine}`)
          return firstLine
        }
      } catch { /* not found */ }
    }
  }

  console.error('[Browser] No Chrome/Edge/Chromium found. Searched:', candidates)
  return null
}

/** Create a temp user data directory so Puppeteer doesn't conflict with an existing Chrome session. */
function getOrCreateUserDataDir(): string {
  if (!userDataDir) {
    userDataDir = path.join(os.tmpdir(), `coasty-puppeteer-${process.pid}`)
    try {
      fs.mkdirSync(userDataDir, { recursive: true })
    } catch { /* already exists */ }
  }
  return userDataDir
}

/** Clean up temp user data dir when browser closes. */
function cleanupUserDataDir(): void {
  if (userDataDir) {
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    } catch { /* ignore */ }
    userDataDir = null
  }
}

async function ensureBrowser(): Promise<boolean> {
  if (browser && page) {
    try {
      // Check if browser is still alive
      await page.evaluate(() => true)
      return true
    } catch {
      browser = null
      page = null
    }
  }
  return false
}

export async function openBrowser(params: { url?: string } = {}): Promise<any> {
  try {
    // If a browser is already open and healthy, just navigate
    if (await ensureBrowser()) {
      if (params.url) {
        await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      }
      return { success: true, message: 'Browser already open', url: params.url || page.url() }
    }

    // Close any stale browser instance
    if (browser) {
      try { await browser.close() } catch { /* ignore */ }
      browser = null
      page = null
    }

    const pptr = await getPuppeteer()
    const chromePath = findChromePath()

    if (!chromePath) {
      return {
        success: false,
        error: 'Chrome/Edge/Chromium not found. Install Google Chrome or Microsoft Edge.',
      }
    }

    console.log(`[Browser] Launching: ${chromePath}`)

    // Use a separate user-data-dir to avoid conflicts with existing Chrome sessions.
    // This is the #1 cause of Puppeteer failures on Windows — if Chrome is already
    // running, it locks the default profile directory.
    const dataDir = getOrCreateUserDataDir()

    browser = await pptr.launch({
      executablePath: chromePath,
      headless: false,
      defaultViewport: null,
      userDataDir: dataDir,
      args: [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    })

    // Handle browser disconnect (user closed the window, crash, etc.)
    browser.on('disconnected', () => {
      console.log('[Browser] Browser disconnected')
      browser = null
      page = null
      cleanupUserDataDir()
    })

    const pages = await browser.pages()
    page = pages[0] || await browser.newPage()

    if (params.url) {
      await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    }

    console.log(`[Browser] Opened successfully${params.url ? ` at ${params.url}` : ''}`)
    return { success: true, message: 'Browser opened', url: params.url || 'about:blank' }
  } catch (error: any) {
    console.error('[Browser] Launch failed:', error.message)
    // Clean up on failure
    browser = null
    page = null
    cleanupUserDataDir()
    return { success: false, error: `Browser launch failed: ${error.message}` }
  }
}

export async function navigateBrowser(params: { url: string }): Promise<any> {
  try {
    if (!await ensureBrowser()) {
      await openBrowser()
    }

    await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    const title = await page.title()

    return {
      success: true,
      url: page.url(),
      title,
      message: `Navigated to ${params.url}`,
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function clickBrowser(params: {
  selector?: string
  x?: number
  y?: number
  text?: string
}): Promise<any> {
  try {
    if (!await ensureBrowser()) {
      return { success: false, error: 'Browser not open' }
    }

    if (params.selector) {
      await page.click(params.selector)
    } else if (params.x !== undefined && params.y !== undefined) {
      await page.mouse.click(params.x, params.y)
    } else if (params.text) {
      // Find element by text content
      const element = await page.evaluateHandle((text: string) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        while (walker.nextNode()) {
          if (walker.currentNode.textContent?.includes(text)) {
            return walker.currentNode.parentElement
          }
        }
        return null
      }, params.text)

      if (element) {
        await element.click()
      } else {
        return { success: false, error: `Element with text "${params.text}" not found` }
      }
    }

    return { success: true, message: 'Clicked' }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function typeBrowser(params: {
  selector?: string
  text: string
  clear?: boolean
}): Promise<any> {
  try {
    if (!await ensureBrowser()) {
      return { success: false, error: 'Browser not open' }
    }

    if (params.selector) {
      if (params.clear) {
        await page.click(params.selector, { clickCount: 3 })
      }
      await page.type(params.selector, params.text)
    } else {
      await page.keyboard.type(params.text)
    }

    return { success: true, message: `Typed "${params.text.slice(0, 50)}..."` }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function getBrowserDom(params: {} = {}): Promise<any> {
  try {
    if (!await ensureBrowser()) {
      return { success: false, error: 'Browser not open' }
    }

    const html = await page.evaluate(() => document.documentElement.outerHTML)
    return {
      success: true,
      html: html.slice(0, 5000),
      url: page.url(),
      title: await page.title(),
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function getBrowserClickables(params: {} = {}): Promise<any> {
  try {
    if (!await ensureBrowser()) {
      return { success: false, error: 'Browser not open' }
    }

    const clickables = await page.evaluate(() => {
      const elements = document.querySelectorAll('a, button, input, select, textarea, [onclick], [role="button"]')
      return Array.from(elements).slice(0, 50).map((el, i) => ({
        index: i,
        tag: el.tagName.toLowerCase(),
        text: (el as HTMLElement).innerText?.slice(0, 100) || '',
        type: (el as HTMLInputElement).type || '',
        href: (el as HTMLAnchorElement).href || '',
        id: el.id || '',
        className: el.className?.toString()?.slice(0, 100) || '',
      }))
    })

    return { success: true, clickables, count: clickables.length }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function getBrowserState(params: {} = {}): Promise<any> {
  try {
    if (!await ensureBrowser()) {
      return { success: false, error: 'Browser not open', is_open: false }
    }

    return {
      success: true,
      is_open: true,
      url: page.url(),
      title: await page.title(),
    }
  } catch (error: any) {
    return { success: false, error: error.message, is_open: false }
  }
}

export async function getBrowserInfo(params: {} = {}): Promise<any> {
  return getBrowserState(params)
}

export async function scrollBrowser(params: {
  direction?: 'up' | 'down'
  amount?: number
}): Promise<any> {
  try {
    if (!await ensureBrowser()) {
      return { success: false, error: 'Browser not open' }
    }

    const amount = params.amount || 500
    const direction = params.direction === 'up' ? -amount : amount

    await page.evaluate((scrollAmount: number) => {
      window.scrollBy(0, scrollAmount)
    }, direction)

    return { success: true, message: `Scrolled ${params.direction || 'down'} by ${amount}px` }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function closeBrowser(params: {} = {}): Promise<any> {
  try {
    if (browser) {
      await browser.close()
      browser = null
      page = null
      cleanupUserDataDir()
    }
    return { success: true, message: 'Browser closed' }
  } catch (error: any) {
    browser = null
    page = null
    cleanupUserDataDir()
    return { success: false, error: error.message }
  }
}

export async function executeBrowser(params: { script?: string; code?: string }): Promise<any> {
  try {
    if (!await ensureBrowser()) {
      return { success: false, error: 'Browser not open' }
    }

    const script = params.script || params.code || ''
    if (!script) {
      return { success: false, error: 'No script/code provided' }
    }

    // Pass script as a serialized argument (not string concatenation) to prevent
    // IIFE breakout injection. AsyncFunction constructor supports await in the body.
    const result = await page.evaluate(async (code: string) => {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
      return await new AsyncFunction(code)()
    }, script)

    return {
      success: true,
      result: result !== undefined ? String(result) : 'Script executed',
      message: 'JavaScript executed successfully',
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function waitBrowser(params: {
  selector?: string
  timeout?: number
  text?: string
}): Promise<any> {
  try {
    if (!await ensureBrowser()) {
      return { success: false, error: 'Browser not open' }
    }

    const timeout = Math.min(params.timeout || 5000, 30000)

    if (params.selector) {
      await page.waitForSelector(params.selector, { timeout })
      return { success: true, message: `Element "${params.selector}" found` }
    }

    if (params.text) {
      // Poll for text on page
      await page.waitForFunction(
        (text: string) => document.body.innerText.includes(text),
        { timeout },
        params.text,
      )
      return { success: true, message: `Text "${params.text}" found on page` }
    }

    // Fallback: just wait for the timeout duration
    await new Promise((resolve) => setTimeout(resolve, timeout))
    return { success: true, message: `Waited ${timeout}ms` }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function screenshotBrowser(params: {} = {}): Promise<any> {
  try {
    if (!await ensureBrowser()) {
      // Browser not open — fall back to desktop screenshot
      return null // Signal caller to use desktop screenshot
    }

    const buf = await page.screenshot({ type: 'png', fullPage: false })
    const base64 = buf.toString('base64')

    return {
      success: true,
      screenshot: `data:image/png;base64,${base64}`,
      frontendScreenshot: `data:image/png;base64,${base64}`,
      url: page.url(),
      title: await page.title(),
    }
  } catch {
    return null // Signal caller to use desktop screenshot
  }
}

export async function listBrowserTabs(params: {} = {}): Promise<any> {
  try {
    if (!browser) {
      return { success: true, tabs: [], count: 0, message: 'Browser not open' }
    }

    const pages = await browser.pages()
    const tabs = await Promise.all(
      pages.map(async (p: any, i: number) => ({
        index: i,
        url: p.url(),
        title: await p.title().catch(() => ''),
        active: p === page,
      })),
    )

    return { success: true, tabs, count: tabs.length }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function openBrowserTab(params: { url?: string } = {}): Promise<any> {
  try {
    if (!browser) {
      return openBrowser(params)
    }

    const newPage = await browser.newPage()
    page = newPage // Switch focus to new tab

    if (params.url) {
      await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    }

    return {
      success: true,
      message: `Opened new tab${params.url ? ` at ${params.url}` : ''}`,
      url: page.url(),
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function closeBrowserTab(params: { index?: number } = {}): Promise<any> {
  try {
    if (!browser) {
      return { success: false, error: 'Browser not open' }
    }

    const pages = await browser.pages()
    if (pages.length <= 1) {
      return { success: false, error: 'Cannot close the last tab' }
    }

    const idx = params.index ?? pages.indexOf(page)
    if (idx >= 0 && idx < pages.length) {
      await pages[idx].close()
      // Switch to the last remaining tab
      const remaining = await browser.pages()
      page = remaining[remaining.length - 1]
      return { success: true, message: `Closed tab ${idx}` }
    }

    return { success: false, error: `Tab index ${idx} out of range` }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function switchBrowserTab(params: { index: number }): Promise<any> {
  try {
    if (!browser) {
      return { success: false, error: 'Browser not open' }
    }

    const pages = await browser.pages()
    if (params.index >= 0 && params.index < pages.length) {
      page = pages[params.index]
      await page.bringToFront()
      return {
        success: true,
        message: `Switched to tab ${params.index}`,
        url: page.url(),
        title: await page.title(),
      }
    }

    return { success: false, error: `Tab index ${params.index} out of range (${pages.length} tabs)` }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}
