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

  checkSession: () => Promise<void>
  signIn: () => Promise<boolean>
  signInWithEmail: (email: string, password: string) => Promise<AuthResult>
  signUpWithEmail: (email: string, password: string) => Promise<AuthResult>
  signInWithMagicLink: (email: string) => Promise<AuthResult>
  resetPassword: (email: string) => Promise<AuthResult>
  cancelAuth: () => Promise<void>
  signOut: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  user: null,
  machineId: null,
  loading: true,
  waitingForEmail: false,

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
}))
