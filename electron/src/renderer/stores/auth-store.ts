import { create } from 'zustand'

interface AuthUser {
  id: string
  email: string | null
  name: string | null
  avatar?: string
}

interface AuthResult {
  success: boolean
  error?: string
}

interface AuthState {
  isAuthenticated: boolean
  user: AuthUser | null
  machineId: string | null
  loading: boolean
  /** True when waiting for user to click email link (sign-up confirmation or magic link) */
  waitingForEmail: boolean
  /** Last session-death reason, if any. Cleared on new sign-in. Used
   *  by the AuthScreen to show a contextual banner ("your session
   *  expired", "we lost connection to the server", etc.) instead of
   *  just dumping the user back to a blank sign-in form. */
  lastSessionDiedReason: string | null

  checkSession: () => Promise<void>
  signIn: () => Promise<boolean>
  signInWithEmail: (email: string, password: string) => Promise<AuthResult>
  signUpWithEmail: (email: string, password: string) => Promise<AuthResult>
  signInWithMagicLink: (email: string) => Promise<AuthResult>
  resetPassword: (email: string) => Promise<AuthResult>
  cancelAuth: () => Promise<void>
  signOut: () => Promise<void>
  /** Subscribe to the main process's ``auth:session-died`` IPC event.
   *  Returns the cleanup function. Called once at app start from
   *  App.tsx (NOT from each component — the listener is global). */
  initSessionDeathListener: () => () => void
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isAuthenticated: false,
  user: null,
  machineId: null,
  loading: true,
  waitingForEmail: false,
  lastSessionDiedReason: null,

  checkSession: async () => {
    try {
      const session = await window.coasty.getSession()
      set({
        isAuthenticated: session.isAuthenticated,
        user: session.isAuthenticated
          ? { id: session.userId!, email: session.email, name: session.name, avatar: session.avatar ?? undefined }
          : null,
        machineId: session.machineId,
        loading: false,
      })
    } catch {
      set({ isAuthenticated: false, user: null, loading: false })
    }
  },

  signIn: async () => {
    try {
      const result = await window.coasty.signIn()
      if (result.success && result.user) {
        const session = await window.coasty.getSession()
        set({
          isAuthenticated: true,
          user: result.user,
          machineId: session.machineId,
        })
        return true
      }
      return false
    } catch {
      return false
    }
  },

  signInWithEmail: async (email: string, password: string) => {
    try {
      const result = await window.coasty.signInWithEmail(email, password)
      if (result.success && result.user) {
        const session = await window.coasty.getSession()
        set({
          isAuthenticated: true,
          user: result.user,
          machineId: session.machineId,
        })
        return { success: true }
      }
      return { success: false, error: result.error }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  // Long-running: waits for user to click confirmation email link
  signUpWithEmail: async (email: string, password: string) => {
    set({ waitingForEmail: true })
    try {
      const result = await window.coasty.signUpWithEmail(email, password)
      if (result.success && result.user) {
        const session = await window.coasty.getSession()
        set({
          isAuthenticated: true,
          user: result.user,
          machineId: session.machineId,
          waitingForEmail: false,
        })
        return { success: true }
      }
      set({ waitingForEmail: false })
      return { success: false, error: result.error }
    } catch (err: any) {
      set({ waitingForEmail: false })
      return { success: false, error: err.message }
    }
  },

  // Two-phase magic link: send OTP first, then wait for callback
  signInWithMagicLink: async (email: string) => {
    try {
      // Phase 1: Send magic link OTP (returns quickly, may fail for non-existing users)
      const sendResult = await window.coasty.sendMagicLink(email)
      if (!sendResult.success) {
        return { success: false, error: sendResult.error }
      }

      // Phase 2: OTP sent — now wait for user to click the link
      set({ waitingForEmail: true })
      const result = await window.coasty.awaitMagicLink()
      if (result.success && result.user) {
        const session = await window.coasty.getSession()
        set({
          isAuthenticated: true,
          user: result.user,
          machineId: session.machineId,
          waitingForEmail: false,
        })
        return { success: true }
      }
      set({ waitingForEmail: false })
      return { success: false, error: result.error }
    } catch (err: any) {
      set({ waitingForEmail: false })
      return { success: false, error: err.message }
    }
  },

  resetPassword: async (email: string) => {
    try {
      const result = await window.coasty.resetPassword(email)
      if (result.success) {
        return { success: true }
      }
      return { success: false, error: result.error }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  cancelAuth: async () => {
    await window.coasty.cancelAuth()
    set({ waitingForEmail: false })
  },

  signOut: async () => {
    await window.coasty.signOut()
    // Clear permission-related localStorage so the next user gets a clean state
    try {
      localStorage.removeItem('coasty_permissions_dismissed')
      localStorage.removeItem('coasty_permissions_granted')
    } catch { /* localStorage may be unavailable */ }
    set({ isAuthenticated: false, user: null, machineId: null })
  },

  /**
   * Wire up the main process's ``auth:session-died`` event.
   *
   * When the auth layer in main declares the session permanently
   * dead (refresh failed, network error, scheduled refresh failed,
   * bridge auth_rejected, ...), this listener fires and we
   * IMMEDIATELY sign the user out at the UI level — even before
   * the next IPC call would have failed with 401. The user goes
   * straight to the AuthScreen with a reason flag set, so the
   * sign-in surface can show "Your session expired" or "We lost
   * connection — please sign in again" depending on the cause.
   *
   * The contract from the user: "if there are any issues just sign
   * the user out simple as that". This is the implementation. No
   * retry loops, no zombie states, no half-authenticated UI.
   *
   * Idempotency: signOut on an already-signed-out store is a no-op
   * after the local clear; multiple session-died events for the
   * same death are coalesced by the main process's
   * ``sessionDeadFired`` latch so the renderer never sees them.
   */
  initSessionDeathListener: () => {
    const cleanup = window.coasty.onSessionDied(async ({ reason }) => {
      console.warn(`[auth-store] session-died received: reason="${reason}" — signing out`)
      // Stash the reason BEFORE the signOut() call clears state so
      // the AuthScreen can read it after the navigation.
      set({ lastSessionDiedReason: reason })
      // Re-use signOut so we clear localStorage etc.
      try {
        await get().signOut()
      } catch (err) {
        // If signOut fails (e.g. IPC torn down), still clear local
        // state so the UI returns to AuthScreen.
        console.error('[auth-store] signOut on session-died failed:', err)
        set({ isAuthenticated: false, user: null, machineId: null })
      }
    })
    return cleanup
  },
}))
