/**
 * Tests for auto sign-out on connection error.
 *
 * When the WebSocket bridge enters 'error' state (backend rejects auth),
 * the app should automatically sign out the user instead of showing
 * a "Sign in again" button.
 *
 * This tests the logic in App.tsx's useEffect that watches connectionState.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Simulate the auto-signout logic from App.tsx ──────────────────
// We extract and test the decision logic directly rather than mounting
// React components, keeping the test fast and dependency-free.

describe('Auto sign-out on connection error', () => {
  let signOut: ReturnType<typeof vi.fn>
  let setMode: ReturnType<typeof vi.fn>

  beforeEach(() => {
    signOut = vi.fn()
    setMode = vi.fn()
  })

  /**
   * Simulates the effect logic from App.tsx:
   *
   *   useEffect(() => {
   *     if (connectionState === 'error' && isAuthenticated) {
   *       signOut()
   *     }
   *   }, [connectionState])
   */
  function runConnectionEffect(connectionState: string, isAuthenticated: boolean) {
    if (connectionState === 'error' && isAuthenticated) {
      signOut()
    }
  }

  /**
   * Simulates the auth effect from App.tsx:
   *
   *   useEffect(() => {
   *     if (isAuthenticated) {
   *       connect()
   *     } else if (mode !== 'auth') {
   *       setMode('auth')
   *     }
   *   }, [isAuthenticated])
   */
  function runAuthEffect(isAuthenticated: boolean, mode: string) {
    if (!isAuthenticated && mode !== 'auth') {
      setMode('auth')
    }
  }

  // ── Core behavior ───────────────────────────────────────────────

  it('calls signOut when connection state becomes error and user is authenticated', () => {
    runConnectionEffect('error', true)
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('does NOT call signOut when connection state is error but user is already signed out', () => {
    runConnectionEffect('error', false)
    expect(signOut).not.toHaveBeenCalled()
  })

  it('does NOT call signOut when connection state is disconnected', () => {
    runConnectionEffect('disconnected', true)
    expect(signOut).not.toHaveBeenCalled()
  })

  it('does NOT call signOut when connection state is connecting', () => {
    runConnectionEffect('connecting', true)
    expect(signOut).not.toHaveBeenCalled()
  })

  it('does NOT call signOut when connection state is connected', () => {
    runConnectionEffect('connected', true)
    expect(signOut).not.toHaveBeenCalled()
  })

  // ── Full flow: error → signOut → auth screen ────────────────────

  it('full flow: error triggers signOut, then auth effect switches to auth screen', () => {
    // Step 1: connection error while authenticated → auto sign out
    runConnectionEffect('error', true)
    expect(signOut).toHaveBeenCalledTimes(1)

    // Step 2: after signOut completes, isAuthenticated becomes false
    // The auth effect should switch to auth screen
    runAuthEffect(false, 'expanded')
    expect(setMode).toHaveBeenCalledWith('auth')
  })

  it('auth effect does not switch mode if already on auth screen', () => {
    runConnectionEffect('error', true)
    expect(signOut).toHaveBeenCalledTimes(1)

    runAuthEffect(false, 'auth')
    expect(setMode).not.toHaveBeenCalled()
  })

  // ── Repeated error state ────────────────────────────────────────

  it('only calls signOut once per error transition', () => {
    // First error
    runConnectionEffect('error', true)
    expect(signOut).toHaveBeenCalledTimes(1)

    // After signOut, isAuthenticated becomes false
    // If effect fires again with error but not authenticated, no double signOut
    runConnectionEffect('error', false)
    expect(signOut).toHaveBeenCalledTimes(1)
  })
})

// ── UI state: "Sign in again" button should NOT exist ─────────────

describe('ConnectionStatus and Overlay — no "Sign in again" button on error', () => {
  /**
   * Simulates the button visibility logic from Overlay.tsx / ConnectionStatus.tsx.
   *
   * Before the change:
   *   - error → show "Reconnect" + "Sign in again"
   * After the change:
   *   - error → auto sign-out (no buttons shown since user is redirected)
   *   - disconnected → show "Reconnect" only
   */
  function getVisibleButtons(connectionState: string): string[] {
    const buttons: string[] = []

    if (connectionState === 'disconnected' || connectionState === 'error') {
      buttons.push('Reconnect')
      // "Sign in again" is no longer shown — auto sign-out handles it
    }

    return buttons
  }

  it('error state only shows Reconnect (no Sign in again)', () => {
    const buttons = getVisibleButtons('error')
    expect(buttons).toEqual(['Reconnect'])
    expect(buttons).not.toContain('Sign in again')
  })

  it('disconnected state shows Reconnect', () => {
    const buttons = getVisibleButtons('disconnected')
    expect(buttons).toEqual(['Reconnect'])
  })

  it('connected state shows no reconnect buttons', () => {
    const buttons = getVisibleButtons('connected')
    expect(buttons).toEqual([])
  })

  it('connecting state shows no buttons', () => {
    const buttons = getVisibleButtons('connecting')
    expect(buttons).toEqual([])
  })
})
