/**
 * Window-mode transitions: auth → compact → expanded → compact.
 *
 * These transitions are the load-bearing animation in the app and have
 * regressed multiple times — most recently the Windows always-on-top z-order
 * fix that needed hide→bounds→show retries at 600ms/1200ms/2000ms/3000ms.
 *
 * Vitest mocks BrowserWindow.setBounds, so this spec is the only place the
 * real OS-level window manager is exercised under test.
 */
import { test, expect } from '@playwright/test'
import { launchApp, closeApp, waitForMainWindow, LaunchedApp } from './fixtures/launch'

let launched: LaunchedApp | null = null

test.afterEach(async () => {
  await closeApp(launched)
  launched = null
})

// Animation duration in window-manager.ts is 320ms; we wait a touch longer
// to be sure the final ``setBounds`` frame has landed before sampling size.
const ANIMATION_SETTLE_MS = 600

async function getMode(launched: LaunchedApp): Promise<string> {
  // We infer the current mode from the window dimensions rather than poking
  // at window-manager's internal state — main is a single bundled file so
  // there's no module to dynamic-import, and exporting the mode just for
  // tests would leak test concerns into production code.
  return launched.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return 'unknown'
    const [width, height] = win.getSize()
    if (width <= 380 && height <= 80) return 'compact'
    if (width >= 480) return 'expanded'
    return 'auth'
  })
}

test('starts in auth mode (400x500)', async () => {
  launched = await launchApp()
  const page = await waitForMainWindow(launched)

  const size = await page.evaluate(() => (window as any).coasty.getWindowSize())
  expect(size.width).toBeGreaterThanOrEqual(398)
  expect(size.width).toBeLessThanOrEqual(402)
  expect(size.height).toBeGreaterThanOrEqual(498)
  expect(size.height).toBeLessThanOrEqual(502)

  const mode = await getMode(launched)
  expect(mode).toBe('auth')
})

test('window:set-mode "compact" resizes to the pill bar', async () => {
  launched = await launchApp()
  const page = await waitForMainWindow(launched)

  await page.evaluate(() => (window as any).coasty.setWindowMode('compact'))
  await new Promise((r) => setTimeout(r, ANIMATION_SETTLE_MS))

  const size = await page.evaluate(() => (window as any).coasty.getWindowSize())
  // Compact is 360x56 per MODE_CONFIG.compact. Tolerate ±4 for scale-factor
  // rounding on Windows.
  expect(size.width).toBeGreaterThanOrEqual(356)
  expect(size.width).toBeLessThanOrEqual(364)
  expect(size.height).toBeGreaterThanOrEqual(52)
  expect(size.height).toBeLessThanOrEqual(60)
})

test('window:set-mode "expanded" resizes to the chat panel', async () => {
  launched = await launchApp()
  const page = await waitForMainWindow(launched)

  await page.evaluate(() => (window as any).coasty.setWindowMode('expanded'))
  await new Promise((r) => setTimeout(r, ANIMATION_SETTLE_MS))

  const size = await page.evaluate(() => (window as any).coasty.getWindowSize())
  // Expanded is 520x680 minimum (per MODE_CONFIG.expanded + saved size). The
  // user can grow it but never shrink below 400x520; the default starting
  // size is what we assert here.
  expect(size.width).toBeGreaterThanOrEqual(400)
  expect(size.height).toBeGreaterThanOrEqual(520)
})

test('compact → expanded → compact round-trip preserves window identity', async () => {
  launched = await launchApp()
  const page = await waitForMainWindow(launched)
  const a = (sel: string) => page.evaluate((s) => (window as any).coasty.setWindowMode(s), sel)

  await a('compact')
  await new Promise((r) => setTimeout(r, ANIMATION_SETTLE_MS))
  const compactSize = await page.evaluate(() => (window as any).coasty.getWindowSize())

  await a('expanded')
  await new Promise((r) => setTimeout(r, ANIMATION_SETTLE_MS))
  const expandedSize = await page.evaluate(() => (window as any).coasty.getWindowSize())

  await a('compact')
  await new Promise((r) => setTimeout(r, ANIMATION_SETTLE_MS))
  const compactSize2 = await page.evaluate(() => (window as any).coasty.getWindowSize())

  // Expanded must be strictly larger than compact in both dimensions.
  expect(expandedSize.width).toBeGreaterThan(compactSize.width)
  expect(expandedSize.height).toBeGreaterThan(compactSize.height)

  // Returning to compact must yield the same compact dimensions as the
  // first trip. If this regresses, the animation guard isn't suppressing
  // mid-animation 'moved'/'resize' events properly.
  expect(Math.abs(compactSize2.width - compactSize.width)).toBeLessThanOrEqual(4)
  expect(Math.abs(compactSize2.height - compactSize.height)).toBeLessThanOrEqual(4)
})

test('window:set-opacity reflects back through window:get-opacity', async () => {
  launched = await launchApp()
  const page = await waitForMainWindow(launched)

  await page.evaluate(() => (window as any).coasty.setOpacity(0.5))
  const opacity = await page.evaluate(() => (window as any).coasty.getOpacity())
  expect(opacity).toBeCloseTo(0.5, 1)

  // Out-of-range opacities must be clamped — opacity <0.15 makes the window
  // invisible-but-still-grabbing-clicks, which is the worst possible UX.
  await page.evaluate(() => (window as any).coasty.setOpacity(0.01))
  const clamped = await page.evaluate(() => (window as any).coasty.getOpacity())
  expect(clamped).toBeGreaterThanOrEqual(0.15)
})
