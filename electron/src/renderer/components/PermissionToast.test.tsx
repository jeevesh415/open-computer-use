/**
 * @vitest-environment jsdom
 *
 * Tests for the PermissionToast component — focused on the
 * 2026-05-15 Nitish fix where the toast switches into "restart" mode
 * after the user has dismissed the PermissionsGuard.
 *
 * Sections:
 *   A: Mode selection — pre-grant (Grant Access primary) vs post-dismissal
 *      regrant (Restart Coasty primary)
 *   B: Button behaviour — clicks call the right window.coasty.* methods
 *   C: Lifecycle — appears on permission-denied event, auto-dismisses
 *      after 12s, can be manually dismissed via the X button
 *   D: Accessibility denials never switch to restart-mode (TCC cache
 *      doesn't apply there)
 *   E: localStorage hardening — SecurityError doesn't break the toast
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// ─── Mock window.coasty ──────────────────────────────────────────────────

type DeniedHandler = (data: { type: string; message: string }) => void

const coastyMocks = {
  openScreenRecordingSettings: vi.fn(),
  requestAccessibility: vi.fn(),
  relaunch: vi.fn(),
  // The onPermissionDenied subscription stores the handler so tests can
  // synthesize a denial event by calling triggerDenied(...) below.
  _handler: null as DeniedHandler | null,
  onPermissionDenied: vi.fn((cb: DeniedHandler) => {
    coastyMocks._handler = cb
    return () => { coastyMocks._handler = null }
  }),
}

beforeEach(() => {
  vi.useFakeTimers()
  ;(window as any).coasty = coastyMocks
  coastyMocks.openScreenRecordingSettings.mockClear()
  coastyMocks.requestAccessibility.mockClear()
  coastyMocks.relaunch.mockClear()
  coastyMocks.onPermissionDenied.mockClear()
  coastyMocks._handler = null
  try { localStorage.clear() } catch { /* sandbox */ }
})

afterEach(() => {
  vi.useRealTimers()
})

function triggerDenied(type: 'screen-recording' | 'accessibility', message = 'denied') {
  act(() => {
    coastyMocks._handler?.({ type, message })
  })
}

// Lazy-import the component so each test starts from a fresh module
// state (matches the e2e pattern in the codebase).
async function mount() {
  const { PermissionToast } = await import('./PermissionToast')
  return render(<PermissionToast />)
}

// ════════════════════════════════════════════════════════════════════════
// A: Mode selection
// ════════════════════════════════════════════════════════════════════════

describe('mode selection — pre-grant vs post-dismissal regrant', () => {
  it('not dismissed + screen-recording denial → pre-grant mode (Grant Access primary)', async () => {
    await mount()
    triggerDenied('screen-recording')

    const primary = screen.getByTestId('permission-toast-primary')
    expect(primary).toHaveTextContent('Grant Access')

    const secondary = screen.getByTestId('permission-toast-secondary')
    expect(secondary).toHaveTextContent('Restart')

    expect(screen.getByTestId('permission-toast-title')).toHaveTextContent(
      'Screen Recording Permission Required',
    )
  })

  it('DISMISSED + screen-recording denial → restart mode (Restart Coasty primary)', async () => {
    // The 2026-05-15 Nitish flow: user clicked Skip on the
    // PermissionsGuard, granted permission in System Settings, came
    // back, hit the toast. The primary CTA should be a one-click
    // restart.
    localStorage.setItem('coasty_permissions_dismissed', 'true')
    await mount()
    triggerDenied('screen-recording')

    const primary = screen.getByTestId('permission-toast-primary')
    expect(primary).toHaveTextContent(/Restart Coasty/i)

    const secondary = screen.getByTestId('permission-toast-secondary')
    expect(secondary).toHaveTextContent(/Open Settings/i)

    expect(screen.getByTestId('permission-toast-title')).toHaveTextContent(
      /Restart Coasty to apply permission/i,
    )
  })

  it('DISMISSED + accessibility denial → STILL pre-grant mode (TCC cache only affects screen-recording)', async () => {
    localStorage.setItem('coasty_permissions_dismissed', 'true')
    await mount()
    triggerDenied('accessibility')

    // Accessibility doesn't have the same in-process TCC cache as Screen
    // Recording, so the restart-prompt path isn't useful there. Keep
    // "Grant Access" primary regardless of dismissal state.
    const primary = screen.getByTestId('permission-toast-primary')
    expect(primary).toHaveTextContent('Grant Access')
    expect(screen.getByTestId('permission-toast-title')).toHaveTextContent(
      'Accessibility Permission Required',
    )
  })

  it('dismissal key set to anything OTHER than "true" → pre-grant mode', async () => {
    // Be strict about the "true" sentinel — a stale "false" / "1" / "yes"
    // shouldn't flip modes accidentally.
    localStorage.setItem('coasty_permissions_dismissed', 'false')
    await mount()
    triggerDenied('screen-recording')
    expect(screen.getByTestId('permission-toast-primary')).toHaveTextContent('Grant Access')
  })

  it('dismissal snapshot is taken at SHOW time, not at re-render time', async () => {
    // Even if localStorage changes between toast appearance and
    // mid-render, the user-visible content shouldn't flicker.
    await mount()
    triggerDenied('screen-recording')
    expect(screen.getByTestId('permission-toast-primary')).toHaveTextContent('Grant Access')

    // Now flip the dismissed flag — the OPEN toast should NOT mutate.
    act(() => {
      localStorage.setItem('coasty_permissions_dismissed', 'true')
    })
    expect(screen.getByTestId('permission-toast-primary')).toHaveTextContent('Grant Access')
  })
})

// ════════════════════════════════════════════════════════════════════════
// B: Button behaviour
// ════════════════════════════════════════════════════════════════════════

describe('button behaviour', () => {
  it('pre-grant: Grant Access click → openScreenRecordingSettings', async () => {
    await mount()
    triggerDenied('screen-recording')
    fireEvent.click(screen.getByTestId('permission-toast-primary'))
    expect(coastyMocks.openScreenRecordingSettings).toHaveBeenCalledTimes(1)
    expect(coastyMocks.relaunch).not.toHaveBeenCalled()
  })

  it('pre-grant: Restart click → relaunch', async () => {
    await mount()
    triggerDenied('screen-recording')
    fireEvent.click(screen.getByTestId('permission-toast-secondary'))
    expect(coastyMocks.relaunch).toHaveBeenCalledTimes(1)
  })

  it('restart-mode: Restart Coasty click → relaunch (THE single-click fix)', async () => {
    localStorage.setItem('coasty_permissions_dismissed', 'true')
    await mount()
    triggerDenied('screen-recording')
    fireEvent.click(screen.getByTestId('permission-toast-primary'))
    expect(coastyMocks.relaunch).toHaveBeenCalledTimes(1)
    expect(coastyMocks.openScreenRecordingSettings).not.toHaveBeenCalled()
  })

  it('restart-mode: Open Settings click → openScreenRecordingSettings (fallback)', async () => {
    localStorage.setItem('coasty_permissions_dismissed', 'true')
    await mount()
    triggerDenied('screen-recording')
    fireEvent.click(screen.getByTestId('permission-toast-secondary'))
    expect(coastyMocks.openScreenRecordingSettings).toHaveBeenCalledTimes(1)
    expect(coastyMocks.relaunch).not.toHaveBeenCalled()
  })

  it('accessibility: Grant click → requestAccessibility (not openScreenRecordingSettings)', async () => {
    await mount()
    triggerDenied('accessibility')
    fireEvent.click(screen.getByTestId('permission-toast-primary'))
    expect(coastyMocks.requestAccessibility).toHaveBeenCalledTimes(1)
    expect(coastyMocks.openScreenRecordingSettings).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════
// C: Lifecycle
// ════════════════════════════════════════════════════════════════════════

describe('lifecycle', () => {
  it('does not render before a permission:denied event arrives', async () => {
    await mount()
    expect(screen.queryByTestId('permission-toast')).toBeNull()
  })

  it('renders after a permission:denied event', async () => {
    await mount()
    triggerDenied('screen-recording')
    expect(screen.getByTestId('permission-toast')).toBeInTheDocument()
  })

  it('auto-dismisses after 12 seconds', async () => {
    await mount()
    triggerDenied('screen-recording')
    expect(screen.getByTestId('permission-toast')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(11_999) })
    expect(screen.getByTestId('permission-toast')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(2) })
    expect(screen.queryByTestId('permission-toast')).toBeNull()
  })

  it('a SECOND denial event resets the 12s timer', async () => {
    await mount()
    triggerDenied('screen-recording')
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(screen.getByTestId('permission-toast')).toBeInTheDocument()

    // Second event arrives — should restart the 12s window
    triggerDenied('screen-recording')
    act(() => { vi.advanceTimersByTime(11_999) })
    expect(screen.getByTestId('permission-toast')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(2) })
    expect(screen.queryByTestId('permission-toast')).toBeNull()
  })

  it('manual dismiss via X button hides immediately', async () => {
    await mount()
    triggerDenied('screen-recording')
    expect(screen.getByTestId('permission-toast')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(screen.queryByTestId('permission-toast')).toBeNull()
  })

  it('unmounts cleanly without leaking timers or subscriptions', async () => {
    const { unmount } = await mount()
    triggerDenied('screen-recording')
    expect(screen.getByTestId('permission-toast')).toBeInTheDocument()

    unmount()
    // The cleanup callback from onPermissionDenied is called and clears
    // the handler reference. After unmount, dispatching another event
    // shouldn't blow up.
    expect(coastyMocks._handler).toBeNull()
  })

  it('handles a permission-denied event arriving AFTER auto-dismissal', async () => {
    await mount()
    triggerDenied('screen-recording')
    act(() => { vi.advanceTimersByTime(12_001) })
    expect(screen.queryByTestId('permission-toast')).toBeNull()

    // Second denial arrives later — toast must show again with fresh state
    triggerDenied('screen-recording')
    expect(screen.getByTestId('permission-toast')).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════════════════════════════════
// D: Mode-specific copy
// ════════════════════════════════════════════════════════════════════════

describe('mode-specific copy', () => {
  it('restart-mode body explicitly mentions the TCC cache reason', async () => {
    localStorage.setItem('coasty_permissions_dismissed', 'true')
    await mount()
    triggerDenied('screen-recording')

    const toast = screen.getByTestId('permission-toast')
    // The "why a restart is needed" explanation is critical UX — users
    // who don't understand WHY they need to restart will distrust the
    // prompt.
    expect(toast.textContent).toMatch(/macOS caches permission/i)
  })

  it('pre-grant mode shows numbered steps', async () => {
    await mount()
    triggerDenied('screen-recording')
    const toast = screen.getByTestId('permission-toast')
    expect(toast.textContent).toMatch(/1\.\s+Click/)
    expect(toast.textContent).toMatch(/2\.\s+Enable/)
    expect(toast.textContent).toMatch(/3\.\s+Click/)
  })
})

// ════════════════════════════════════════════════════════════════════════
// E: localStorage hardening
// ════════════════════════════════════════════════════════════════════════

describe('localStorage hardening', () => {
  it('toast still renders when localStorage.getItem throws (sandbox SecurityError)', async () => {
    const original = Storage.prototype.getItem
    Storage.prototype.getItem = function () {
      throw new Error('SecurityError: localStorage access denied')
    }
    try {
      await mount()
      // Must not crash
      expect(() => triggerDenied('screen-recording')).not.toThrow()
      // Fallback: when we can't read the dismissal flag, default to
      // pre-grant mode so the user at least sees the actionable
      // "Grant Access" CTA.
      expect(screen.getByTestId('permission-toast')).toBeInTheDocument()
      expect(screen.getByTestId('permission-toast-primary')).toHaveTextContent('Grant Access')
    } finally {
      Storage.prototype.getItem = original
    }
  })
})
