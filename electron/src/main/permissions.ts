import { systemPreferences, desktopCapturer, shell } from 'electron'

export interface PermissionStatus {
  screenRecording: 'granted' | 'denied' | 'not-applicable'
  accessibility: 'granted' | 'denied' | 'not-applicable'
}

// ─── Bitmap-fallback tuning (2026-05-14 hardening) ───────────────────────
//
// The bitmap fallback exists for ONE specific case: `getMediaAccessStatus`
// returns `'not-determined'` even though the user has either granted OR
// denied Screen Recording. macOS does this surprisingly often, especially
// on first launch after install. The fallback captures a real screen
// thumbnail and looks for non-black pixels — if the OS would have produced
// a full-black frame, permission is denied; if the frame contains real
// desktop pixels, permission is granted.
//
// Three robustness fixes vs the original 100×100 corner scan:
//
//  1. **Larger thumbnail** (256×256, ~6.5× more pixels than 100×100). A
//     larger sample reduces the chance that the entire region happens to
//     correspond to a genuinely dark area of the user's desktop (e.g.
//     dark wallpaper, dark menu bar) at the moment we sample.
//
//  2. **Sparse grid sampling** instead of sequential byte scan. The
//     original loop scanned from byte 0 and exited on the first non-zero
//     RGB pixel. On most desktops that succeeded immediately, but in
//     pathological cases where the leftmost columns happen to be dark
//     (e.g. dock with dark icons against a dark wallpaper) the scan
//     could traverse most of the buffer before finding light pixels —
//     wasted work. The grid samples points across the FULL image so a
//     dark corner can't dominate. Each grid cell contributes one sample.
//
//  3. **Brightness threshold** (`R+G+B > BRIGHTNESS_FLOOR`) rather than
//     "anything non-zero counts". macOS rendering pipelines sometimes
//     emit near-black noise (`R=1,G=2,B=0`) in regions that are visually
//     black — those single bits of leakage would have spoofed the
//     original `bitmap[i] !== 0` test into thinking permission was
//     granted. A floor of 30 over the RGB triplet means we require a
//     pixel that's *visibly* lit, not just numerically non-zero.
//
//  4. **Multi-sample confirmation** — require N lit pixels, not just one.
//     A single stray hot pixel from sensor noise (very rare but possible
//     on virtual display setups) shouldn't tip us toward "granted".
const FALLBACK_THUMBNAIL_SIZE = 256
const SAMPLE_GRID = 8                 // 8×8 = 64 samples across the image
const BRIGHTNESS_FLOOR = 30           // R+G+B > 30 counts as lit
const MIN_LIT_SAMPLES = 3             // ≥3 lit samples → confident "granted"

/**
 * Inspect a captured thumbnail to decide whether macOS is showing us a
 * real screen (permission granted) or a black image (permission denied).
 *
 * Exported for unit tests; production callers go through
 * `checkAllPermissions()`.
 *
 * @returns `'granted'` when ≥MIN_LIT_SAMPLES samples are lit,
 *          `'denied'` otherwise (including 0×0 thumbnails, empty
 *          bitmaps, and entirely-black images).
 */
export function inspectThumbnailForPermission(
  size: { width: number; height: number },
  bitmap: Buffer,
): 'granted' | 'denied' {
  if (!size || size.width <= 0 || size.height <= 0) return 'denied'
  if (!bitmap || bitmap.length === 0) return 'denied'

  // BGRA/RGBA on every platform Electron supports → 4 bytes per pixel.
  // (Channel order doesn't matter for brightness: R+G+B == B+G+R.)
  const BYTES_PER_PIXEL = 4
  let litCount = 0

  for (let gy = 0; gy < SAMPLE_GRID; gy++) {
    for (let gx = 0; gx < SAMPLE_GRID; gx++) {
      // Sample at the centre of each grid cell, not at the cell origin —
      // an 8×8 grid on a 256-wide image samples columns
      // {16, 48, 80, 112, 144, 176, 208, 240}, which spreads coverage
      // across the full width rather than clustering near x=0.
      const px = Math.floor((gx + 0.5) * size.width / SAMPLE_GRID)
      const py = Math.floor((gy + 0.5) * size.height / SAMPLE_GRID)
      const idx = (py * size.width + px) * BYTES_PER_PIXEL
      if (idx + 2 >= bitmap.length) continue
      // Sum the three colour channels (skip the alpha at idx+3). Channel
      // order is irrelevant — we're computing total luminance proxy.
      const brightness = bitmap[idx] + bitmap[idx + 1] + bitmap[idx + 2]
      if (brightness > BRIGHTNESS_FLOOR) {
        litCount++
        if (litCount >= MIN_LIT_SAMPLES) return 'granted'
      }
    }
  }
  return 'denied'
}

/** Check all macOS permissions required for desktop automation. */
export async function checkAllPermissions(): Promise<PermissionStatus> {
  if (process.platform !== 'darwin') {
    return {
      screenRecording: 'not-applicable',
      accessibility: 'not-applicable',
    }
  }

  // --- Accessibility ---
  const accessibilityGranted = systemPreferences.isTrustedAccessibilityClient(false)

  // --- Screen Recording ---
  //
  // The macOS API has THREE plausible outputs we care about:
  //
  //   'granted'        → user has granted permission to this signed
  //                      bundle. AUTHORITATIVE — trust this and skip the
  //                      bitmap test.
  //   'denied'         → user has denied. AUTHORITATIVE — trust this
  //                      and skip the bitmap test. (After-grant staleness
  //                      requires the user to relaunch the app; the
  //                      bitmap test would not see a fresh grant from the
  //                      same running process anyway, so there's no
  //                      reason to second-guess the API here.)
  //   'restricted'     → MDM / parental controls block this. Definitive
  //                      denial; treated as 'denied'.
  //   'not-determined' → user has not been asked yet OR the API hasn't
  //                      caught up after a recent grant. This is where
  //                      the bitmap fallback earns its keep: try a real
  //                      capture and infer from the result.
  //
  // The previous implementation ran the bitmap fallback whenever the API
  // didn't say `'granted'` — which meant on a TRUE denial we still
  // executed a real capture (wasted work, plus risk of false-positive
  // from a noisy bitmap heuristic). New rule: bitmap is ONLY consulted
  // when the API is genuinely ambiguous.
  let screenRecording: 'granted' | 'denied'
  const apiStatus = systemPreferences.getMediaAccessStatus('screen')

  if (apiStatus === 'granted') {
    screenRecording = 'granted'
  } else if (apiStatus === 'not-determined') {
    // Try a real capture; if we get colored pixels, permission is granted
    // even though the API hasn't caught up yet.
    screenRecording = await runBitmapFallback()
  } else {
    // 'denied' / 'restricted' / 'unknown' → trust the API.
    screenRecording = 'denied'
  }

  if (process.env.NODE_ENV === 'development') {
    // Debug-only — never returned to the renderer (P2-01 fix).
    console.log(
      '[permissions]',
      JSON.stringify({
        apiStatus,
        screenRecording,
        accessibilityGranted,
        usedBitmap: apiStatus === 'not-determined',
      }),
    )
  }

  return {
    screenRecording,
    accessibility: accessibilityGranted ? 'granted' : 'denied',
  }
}

/**
 * Run the bitmap-based confirmation capture. Isolated for testability
 * and so the main `checkAllPermissions()` flow stays readable.
 *
 * Returns 'granted' if a real screen is captured, 'denied' if the
 * capture is missing / empty / fully black.
 */
async function runBitmapFallback(): Promise<'granted' | 'denied'> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: FALLBACK_THUMBNAIL_SIZE,
        height: FALLBACK_THUMBNAIL_SIZE,
      },
    })
    if (!sources || sources.length === 0) return 'denied'

    // Inspect EVERY source's thumbnail rather than just the first one.
    // On multi-monitor setups the agent's active display may not be index
    // 0 — checking all of them means even one lit display is enough to
    // confirm "permission is genuinely granted, the API is just stale".
    for (const src of sources) {
      const thumb = src?.thumbnail
      if (!thumb) continue
      try {
        const size = thumb.getSize()
        const bitmap = thumb.toBitmap()
        if (inspectThumbnailForPermission(size, bitmap) === 'granted') {
          return 'granted'
        }
      } catch {
        // Per-source failure shouldn't abort the whole fallback —
        // try the next source.
      }
    }
    return 'denied'
  } catch {
    // getSources threw — almost always means TCC denial on macOS.
    return 'denied'
  }
}

/** Quick check whether Accessibility is granted (non-macOS always returns true). */
export function isAccessibilityGranted(): boolean {
  if (process.platform !== 'darwin') return true
  return systemPreferences.isTrustedAccessibilityClient(false)
}

/** Prompt for Accessibility permission via the system dialog. */
export function requestAccessibility(): boolean {
  if (process.platform !== 'darwin') return true
  return systemPreferences.isTrustedAccessibilityClient(true)
}

/** Open System Settings to Screen Recording pane. */
export function openScreenRecordingSettings(): void {
  shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  )
}

/** Open System Settings to Accessibility pane. */
export function openAccessibilitySettings(): void {
  shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  )
}
