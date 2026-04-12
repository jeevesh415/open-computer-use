import { desktopCapturer } from 'electron'
import { hideForScreenshot, showAfterScreenshot, contentProtectionReliable } from './window-manager'
import { hideRainbowForScreenshot, showRainbowAfterScreenshot } from './rainbow-border'
import { captureScreenNative } from './native-screenshot'
import { getActiveDisplay } from './display-manager'

const JPEG_QUALITY = 70

/**
 * Screenshot capture strategy per platform:
 *
 * Windows 10 2004+ (build 19041+):
 *   setContentProtection(true) → WDA_EXCLUDEFROMCAPTURE → windows invisible to
 *   all capture APIs. No hiding needed at all.
 *
 * Windows pre-2004:
 *   Content protection uses WDA_MONITOR which shows a BLACK RECTANGLE — worse
 *   than original. Falls back to opacity-based hiding via desktopCapturer.
 *
 * macOS 14+ with Xcode CLI tools:
 *   Native Swift helper uses ScreenCaptureKit SCContentFilter to exclude our
 *   app's windows at the OS level. No hiding needed.
 *
 * macOS < 14 / no Xcode CLI tools / permission issues:
 *   Falls back to opacity-based hiding with desktopCapturer (smooth, no
 *   win.hide() animation).
 *
 * Linux:
 *   Opacity-based hiding with desktopCapturer.
 *
 * Multi-monitor: Captures the user-selected display (via display-manager).
 * Falls back to primary display if the selected display is disconnected.
 */

export async function captureScreenshot(): Promise<any> {
  const display = getActiveDisplay()
  const { width, height } = display.size

  // ── macOS: try ScreenCaptureKit native capture (zero flicker) ─────────
  if (process.platform === 'darwin') {
    // Pass the display ID so the Swift helper captures the correct monitor
    const native = await captureScreenNative(width, height, JPEG_QUALITY / 100, display.id)
    if (native) {
      return {
        success: true,
        screenshot: `data:image/jpeg;base64,${native.base64}`,
        frontendScreenshot: `data:image/jpeg;base64,${native.base64}`,
        resolution: native.resolution,
      }
    }
    // Native capture failed — fall through to desktopCapturer with opacity hiding
    console.warn('[Screenshot] Native capture unavailable, falling back to desktopCapturer')
  }

  // ── Windows 10 2004+: content protection makes our windows invisible ──
  // ── All other platforms/versions: opacity-based hiding (smooth fallback)
  const needsHiding = !contentProtectionReliable

  if (needsHiding) {
    hideRainbowForScreenshot()
    await hideForScreenshot()
  }

  try {
    // Use Electron's built-in desktopCapturer — works reliably in packaged apps
    // unlike screenshot-desktop which needs asar-unpacked .bat files on Windows
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height },
    })

    if (!sources || sources.length === 0) {
      throw new Error('No screen sources found')
    }

    // Match the selected display by display_id.
    // source.display_id is a string matching Electron's Display.id.
    // Falls back to first source if no match (e.g. display_id empty on old Electron/Linux).
    let source = sources.find((s) => s.display_id === String(display.id))
    if (!source) {
      source = sources[0]
    }

    const thumbnail = source.thumbnail
    const thumbSize = thumbnail.getSize()

    // Guard against empty captures (e.g. Screen Recording permission denied)
    if (thumbSize.width === 0 || thumbSize.height === 0) {
      throw new Error('Empty screenshot — check Screen Recording permission')
    }

    // Send at full logical resolution — do NOT resize here.
    // The backend's detect_screen_resolution() reads the image dimensions to
    // learn the actual screen size, then GroundAgent.resize_coordinates()
    // scales from grounding space (1280x720) to screen space. Pre-resizing
    // to 1280 defeated that scaling and caused inaccurate clicks on Windows.
    const base64 = thumbnail.toJPEG(JPEG_QUALITY).toString('base64')

    if (needsHiding) {
      showAfterScreenshot()
      showRainbowAfterScreenshot()
    }

    return {
      success: true,
      screenshot: `data:image/jpeg;base64,${base64}`,
      frontendScreenshot: `data:image/jpeg;base64,${base64}`,
      resolution: `${width}x${height}`,
    }
  } catch (error: any) {
    // Always re-show the overlay even if screenshot fails
    if (needsHiding) {
      showAfterScreenshot()
      showRainbowAfterScreenshot()
    }
    return {
      success: false,
      error: `Screenshot failed: ${error.message}`,
    }
  }
}
