import { create } from 'zustand'

// Must mirror ws-bridge.ts in the main process.
// 'error'      → transient connection error, auto-retry continues
// 'auth_error' → backend rejected JWT, fatal (triggers sign-out in App.tsx)
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error' | 'auth_error'

interface ConnectionStoreState {
  state: ConnectionState
  machineId: string | null

  connect: () => Promise<boolean>
  disconnect: () => Promise<void>
  setState: (state: ConnectionState) => void
  init: () => () => void
}

export const useConnectionStore = create<ConnectionStoreState>((set) => ({
  state: 'disconnected',
  machineId: null,

  connect: async () => {
    set({ state: 'connecting' })
    try {
      const result = await window.coasty.connectBridge()
      if (result.success) {
        set({ state: 'connected', machineId: result.machineId || null })
        return true
      }
      set({ state: 'error' })
      return false
    } catch {
      set({ state: 'error' })
      return false
    }
  },

  disconnect: async () => {
    await window.coasty.disconnectBridge()
    set({ state: 'disconnected' })
  },

  setState: (state) => set({ state }),

  // Subscribe to connection state changes from main process
  init: () => {
    const cleanup = window.coasty.onConnectionStateChanged((state) => {
      set({ state: state as ConnectionState })
    })
    return cleanup
  },
}))
