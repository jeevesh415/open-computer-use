import { systemPreferences, desktopCapturer, shell } from 'electron'

export interface PermissionStatus {
  screenRecording: 'granted' | 'denied' | 'not-applicable'
  accessibility: 'granted' | 'denied' | 'not-applicable'
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
  // Use multiple signals: the system API can report 'granted' reliably,
  // but often returns 'not-determined' even after the user grants it.
  // Fall back to a real capture test when the API is inconclusive.
  const screenApiStatus = systemPreferences.getMediaAccessStatus('screen')
  let screenGranted = screenApiStatus === 'granted'

  if (!screenGranted) {
    // API didn't say granted — try an actual capture to double-check.
    // getMediaAccessStatus often returns 'not-determined' even after granting.
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 100, height: 100 },
      })
      if (sources.length > 0) {
        const thumb = sources[0].thumbnail
        const size = thumb.getSize()
        if (size.width > 0 && size.height > 0) {
          // Check only RGB channels (every 4th byte is alpha, always 255).
          // When denied, macOS returns a fully black image (R=0,G=0,B=0).
          const bitmap = thumb.toBitmap()
          let hasRGBContent = false
          for (let i = 0; i < bitmap.length; i += 4) {
            // Check R, G, B (skip A at i+3)
            if (bitmap[i] !== 0 || bitmap[i + 1] !== 0 || bitmap[i + 2] !== 0) {
              hasRGBContent = true
              break
            }
          }
          screenGranted = hasRGBContent
        }
      }
    } catch {
      // Capture failed — stick with API result
    }
  }

  const result = {
    screenRecording: screenGranted ? 'granted' as const : 'denied' as const,
    accessibility: accessibilityGranted ? 'granted' as const : 'denied' as const,
    _debug: {
      screenApiStatus,
      screenGranted,
      accessibilityGranted,
    },
  }
  console.log('[permissions]', JSON.stringify(result._debug))

  return result
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
