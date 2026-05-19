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

// ─── Error-code contract ──────────────────────────────────────────────────
//
// The 2026-05-14 production audit found 23 occurrences of the literal
// string `Screenshot failed: undefined` on a single macOS client. Root
// cause: the catch block interpolated `error.message` directly, and on
// Darwin 23.2.0 when Screen Recording permission is revoked,
// `desktopCapturer.getSources()` can reject with a non-Error value whose
// `.message` is undefined. The user saw `undefined`, the backend had
// nothing actionable to surface, and the agent retried 3 times before
// giving up — all with the same useless string.
//
// This contract makes every failure path produce a structured response
// the backend can branch on. Codes are STABLE — changing them is a
// breaking change for the backend's error-prompt mapping.

/** Stable error codes returned in the `code` field on capture failure. */
export type ScreenshotErrorCode =
  | 'permission_denied'      // macOS Screen Recording permission denied
  | 'no_sources'             // desktopCapturer returned 0 sources
  | 'empty_capture'          // capture returned a 0x0 thumbnail
  | 'native_helper_failed'   // Swift helper compiled but execFile errored
  | 'jpeg_encode_failed'     // toJPEG() returned empty buffer
  | 'unknown_error'          // anything else (formatter still produces a useful message)

/** Shape of the response from `captureScreenshot()`. */
export type CaptureScreenshotResult =
  | {
      success: true
      screenshot: string         // data:image/jpeg;base64,...
      frontendScreenshot: string // same as above (backend filters this out)
      resolution: string         // e.g. "1920x1080"
      capturePath: 'native' | 'desktopCapturer' | 'desktopCapturer-fallback'
    }
  | {
      success: false
      error: string                // human-readable, NEVER "undefined" or "null"
      code: ScreenshotErrorCode    // machine-readable, branch on this in backend
      action?: 'open_screen_recording_settings' // hint to the backend / frontend
      origin?: string              // which code path produced this (for log triage)
      // These two fields mirror the desktop-automation accessibility flow
      // (see desktop-automation.ts `requireAccessibility`) so that
      // local-executor.ts's existing `result?.permissionDenied` dispatch
      // path also fires the `permission:denied` IPC event for screenshot
      // failures. The renderer's PermissionToast listens for that event.
      permissionDenied?: true
      permissionType?: 'screen-recording'
    }

/**
 * Format an unknown error value into a non-empty human-readable string.
 *
 * Defensive against every thing JavaScript can `throw`:
 *   - Real Error objects with `.message` (the happy path)
 *   - Strings: `throw 'permission denied'` → string itself
 *   - Plain objects: `throw { code: 5 }` → JSON
 *   - null / undefined: `throw null` → fallback constant
 *   - Custom error classes with `.toString()` but no `.message`
 *   - Electron IPC rejections that wrap the original
 *
 * Guarantees the returned string is:
 *   - Non-empty (length >= 1)
 *   - Not literally "undefined" or "null"
 *   - Truncated to 500 chars so the JSON wire payload stays bounded
 */
export function formatScreenshotError(error: unknown): string {
  // Real Error instance — most common path
  if (error instanceof Error) {
    const msg = error.message
    if (typeof msg === 'string' && msg.length > 0) return truncate(msg)
  }
  // String-shaped throw (`throw "permission denied"`)
  if (typeof error === 'string' && error.length > 0) return truncate(error)
  // Object with .message that isn't an Error instance
  if (error && typeof error === 'object') {
    const maybeMsg = (error as { message?: unknown }).message
    if (typeof maybeMsg === 'string' && maybeMsg.length > 0) return truncate(maybeMsg)
    // Fall back to toString() if it's not the default object stringifier
    try {
      const s = (error as { toString?: () => string }).toString?.()
      if (typeof s === 'string' && s.length > 0 && s !== '[object Object]') {
        return truncate(s)
      }
      // Last resort: JSON stringify
      const json = JSON.stringify(error)
      if (typeof json === 'string' && json.length > 2) return truncate(json)
    } catch {
      // toString or JSON.stringify threw — fall through to the constant
    }
  }
  // null, undefined, number, boolean, symbol, function, or anything else
  // whose string form is empty / useless
  return 'unknown error (no message)'
}

function truncate(s: string): string {
  return s.length > 500 ? s.slice(0, 500) + '...[truncated]' : s
}

/**
 * Build the structured failure response. Centralised so every failure
 * branch returns the SAME shape and tests can pin on the exact fields.
 */
function failure(
  error: unknown,
  code: ScreenshotErrorCode,
  origin: string,
  action?: 'open_screen_recording_settings',
): Extract<CaptureScreenshotResult, { success: false }> {
  const msg = formatScreenshotError(error)
  const result: Extract<CaptureScreenshotResult, { success: false }> = {
    success: false,
    error: `Screenshot failed: ${msg}`,
    code,
    origin,
  }
  if (action) result.action = action
  // Permission-denied failures are routed to the renderer's
  // PermissionToast via local-executor.ts's existing IPC dispatch
  // (which keys on `result.permissionDenied`). Wire those fields up
  // here so screenshot uses the SAME plumbing as accessibility denials
  // from desktop-automation.ts — no separate UI dispatch code needed.
  if (code === 'permission_denied') {
    result.permissionDenied = true
    result.permissionType = 'screen-recording'
  }
  // Diagnostic logging — every failure leaves an operator-greppable trail.
  // Origin tag tells which code path produced the error, code tells
  // which user-facing surface should fire. Tests rely on this format.
  console.warn(
    `[Screenshot] FAILURE origin=${origin} code=${code} msg=${JSON.stringify(msg)}`,
  )
  return result
}

export async function captureScreenshot(): Promise<CaptureScreenshotResult> {
  // ── No pre-flight permission check ────────────────────────────────────
  //
  // The earlier (Bug #1) fix added a `checkAllPermissions()` pre-flight
  // before the real capture. That gave us a structured `permission_denied`
  // code for the 2026-05-14 "undefined" symptom — but it ALSO introduced a
  // second failure path: any false negative in the permission check (the
  // bitmap fallback can be wrong, see permissions.ts) would block a
  // capture that would have otherwise succeeded. Nitish hit exactly that:
  // permission was granted, but the pre-check returned `denied`, so every
  // screenshot failed with no recourse.
  //
  // New contract: the REAL capture is the source of truth. If macOS won't
  // let us capture, `desktopCapturer.getSources()` rejects OR returns an
  // empty thumbnail — both of which we already detect downstream and map
  // to `permission_denied` with `action: open_screen_recording_settings`.
  // No double-check, no double-failure.
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
        capturePath: 'native',
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

  // Track the capturePath for the success response. macOS that reached
  // here means native fell through; everything else is just desktopCapturer.
  const capturePath: 'desktopCapturer' | 'desktopCapturer-fallback' =
    process.platform === 'darwin' ? 'desktopCapturer-fallback' : 'desktopCapturer'

  try {
    // Use Electron's built-in desktopCapturer — works reliably in packaged apps
    // unlike screenshot-desktop which needs asar-unpacked .bat files on Windows
    let sources
    try {
      sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width, height },
      })
    } catch (sourcesErr) {
      // getSources itself rejected — this is the path that produced the
      // 2026-05-14 `Screenshot failed: undefined` bug on Darwin 23.2.0.
      // Re-show overlay before we return.
      if (needsHiding) {
        showAfterScreenshot()
        showRainbowAfterScreenshot()
      }
      // On macOS, an `getSources` rejection almost always means TCC
      // denied the request. Surface that with the actionable code even
      // though our pre-check didn't catch it (race: permission revoked
      // between pre-check and getSources call).
      if (process.platform === 'darwin') {
        return failure(
          sourcesErr,
          'permission_denied',
          'desktopCapturer.getSources',
          'open_screen_recording_settings',
        )
      }
      return failure(sourcesErr, 'no_sources', 'desktopCapturer.getSources')
    }

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
      if (needsHiding) {
        showAfterScreenshot()
        showRainbowAfterScreenshot()
      }
      return failure(
        new Error('Empty screenshot — check Screen Recording permission'),
        'empty_capture',
        'desktopCapturer.thumbnail',
        process.platform === 'darwin' ? 'open_screen_recording_settings' : undefined,
      )
    }

    // Send at full logical resolution — do NOT resize here.
    // The backend's detect_screen_resolution() reads the image dimensions to
    // learn the actual screen size, then GroundAgent.resize_coordinates()
    // scales from grounding space (1280x720) to screen space. Pre-resizing
    // to 1280 defeated that scaling and caused inaccurate clicks on Windows.
    const jpegBuf = thumbnail.toJPEG(JPEG_QUALITY)
    if (!jpegBuf || jpegBuf.length === 0) {
      if (needsHiding) {
        showAfterScreenshot()
        showRainbowAfterScreenshot()
      }
      return failure(
        new Error('JPEG encoding produced an empty buffer'),
        'jpeg_encode_failed',
        'thumbnail.toJPEG',
      )
    }
    const base64 = jpegBuf.toString('base64')

    if (needsHiding) {
      showAfterScreenshot()
      showRainbowAfterScreenshot()
    }

    return {
      success: true,
      screenshot: `data:image/jpeg;base64,${base64}`,
      frontendScreenshot: `data:image/jpeg;base64,${base64}`,
      resolution: `${width}x${height}`,
      capturePath,
    }
  } catch (error: unknown) {
    // Always re-show the overlay even if screenshot fails
    if (needsHiding) {
      showAfterScreenshot()
      showRainbowAfterScreenshot()
    }
    // The catch-all. Errors from `thumbnail.toJPEG()` or the
    // sources-empty `throw new Error('No screen sources found')` land
    // here. Use the defensive formatter so we never produce the
    // `Screenshot failed: undefined` literal again.
    return failure(error, 'unknown_error', 'captureScreenshot.catch')
  }
}
