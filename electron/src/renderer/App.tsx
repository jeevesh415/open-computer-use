import React from 'react'
import { useAuthStore } from './stores/auth-store'
import { useConnectionStore } from './stores/connection-store'
import { useWindowStore } from './stores/window-store'
import { useApprovalStore } from './stores/approval-store'
import { AuthScreen } from './components/AuthScreen'
import { Overlay } from './components/Overlay'
import { PermissionsGuard } from './components/PermissionsGuard'
import { PermissionToast } from './components/PermissionToast'

export default function App() {
  const { isAuthenticated, loading, checkSession, signOut } = useAuthStore()
  const { connect, init: initConnection, state: connectionState } = useConnectionStore()
  const { mode, setMode, init: initWindow } = useWindowStore()

  // Check session on mount
  React.useEffect(() => {
    checkSession()
  }, [])

  // Subscribe to connection state changes from main process
  React.useEffect(() => {
    return initConnection()
  }, [])

  // Subscribe to window mode changes from main process
  React.useEffect(() => {
    return initWindow()
  }, [])

  // Initialize approval store (IPC subscriptions + persisted mode)
  React.useEffect(() => {
    return useApprovalStore.getState().init()
  }, [])

  // After auth succeeds, connect bridge
  // When signed out, switch back to auth mode
  React.useEffect(() => {
    if (isAuthenticated) {
      connect()
    } else if (mode !== 'auth') {
      setMode('auth')
    }
  }, [isAuthenticated])

  // Auto sign-out when backend rejects authentication
  React.useEffect(() => {
    if (connectionState === 'error' && isAuthenticated) {
      signOut()
    }
  }, [connectionState])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-neutral-950 rounded-2xl">
        <div className="flex items-center gap-3 text-neutral-400">
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading...
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <AuthScreen />
  }

  return (
    <PermissionsGuard>
      <Overlay />
      <PermissionToast />
    </PermissionsGuard>
  )
}
