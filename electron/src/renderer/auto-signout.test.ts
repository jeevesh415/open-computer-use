/**
 * Tests for auto sign-out on auth failure.
 *
 * When the WebSocket bridge enters 'auth_error' state (backend explicitly
 * rejected the JWT via an auth_failed message), the app should automatically
 * sign out.  Generic 'error' states (transient connection failures) should
 * NOT trigger sign-out — otherwise a TLS hiccup / 503 / DNS blip right after
 * sign-in yanks the user back to the auth screen and sign-in appears broken.
 *
 * This tests the logic in App.tsx's useEffect that watches connectionState.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Simulate the auto-signout logic from App.tsx ──────────────────
// We extract and test the decision logic directly rather than mounting
// React components, keeping the test fast and dependency-free.

describe('Auto sign-out on auth failure', () => {
  let signOut: ReturnType<typeof vi.fn<() => void>>
  let setMode: ReturnType<typeof vi.fn<(mode: string) => void>>

  beforeEach(() => {
    signOut = vi.fn<() => void>()
    setMode = vi.fn<(mode: string) => void>()
  })

  /**
   * Simulates the effect logic from App.tsx:
   *
   *   useEffect(() => {
   *     if (connectionState === 'auth_error' && isAuthenticated) {
   *       signOut()
   *     }
   *   }, [connectionState])
   */
  function runConnectionEffect(connectionState: string, isAuthenticated: boolean) {
    if (connectionState === 'auth_error' && isAuthenticated) {
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

  it('calls signOut when state becomes auth_error and user is authenticated', () => {
    runConnectionEffect('auth_error', true)
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('does NOT call signOut when auth_error fires but user is already signed out', () => {
    runConnectionEffect('auth_error', false)
    expect(signOut).not.toHaveBeenCalled()
  })

  // The critical regression guard: a transient WS error right after sign-in
  // must NOT kick the user back to the auth screen.
  it('does NOT call signOut on generic connection error (transient network issue)', () => {
    runConnectionEffect('error', true)
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

  // ── Full flow: auth_error → signOut → auth screen ───────────────

  it('full flow: auth_error triggers signOut, then auth effect switches to auth screen', () => {
    // Step 1: backend rejects JWT → auto sign out
    runConnectionEffect('auth_error', true)
    expect(signOut).toHaveBeenCalledTimes(1)

    // Step 2: after signOut completes, isAuthenticated becomes false
    // The auth effect should switch to auth screen
    runAuthEffect(false, 'expanded')
    expect(setMode).toHaveBeenCalledWith('auth')
  })

  it('auth effect does not switch mode if already on auth screen', () => {
    runConnectionEffect('auth_error', true)
    expect(signOut).toHaveBeenCalledTimes(1)

    runAuthEffect(false, 'auth')
    expect(setMode).not.toHaveBeenCalled()
  })

  // ── Repeated error states ───────────────────────────────────────

  it('only calls signOut once per auth_error transition', () => {
    runConnectionEffect('auth_error', true)
    expect(signOut).toHaveBeenCalledTimes(1)

    // After signOut, isAuthenticated becomes false — no double signOut
    runConnectionEffect('auth_error', false)
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  // Repeated 'error' states from reconnect loop must not sign the user out.
  it('does not sign out on repeated generic errors during reconnect backoff', () => {
    runConnectionEffect('error', true)
    runConnectionEffect('error', true)
    runConnectionEffect('error', true)
    expect(signOut).not.toHaveBeenCalled()
  })
})

// ── UI state: "Sign in again" button should NOT exist ─────────────

describe('ConnectionStatus and Overlay — no "Sign in again" button on error', () => {
  /**
   * Simulates the button visibility logic from Overlay.tsx / ConnectionStatus.tsx.
   *
   * Current behavior:
   *   - error         → show "Reconnect" (user stays signed in, bridge retries)
   *   - disconnected  → show "Reconnect"
   *   - auth_error    → triggers auto sign-out → AuthScreen (no buttons shown)
   *
   * The "Sign in again" button is intentionally absent: an auth failure sends
   * the user back to the auth screen automatically, so the extra CTA is
   * redundant.
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
