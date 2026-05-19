import React from 'react'
import { useAuthStore } from './stores/auth-store'
import { useConnectionStore } from './stores/connection-store'
import { useWindowStore } from './stores/window-store'
import { useChatStore } from './stores/chat-store'
import { useApprovalStore } from './stores/approval-store'
import { AuthScreen } from './components/AuthScreen'
import { Overlay } from './components/Overlay'
import { PermissionsGuard } from './components/PermissionsGuard'
import { PermissionToast } from './components/PermissionToast'
import { ErrorBoundary } from './components/ErrorBoundary'

// Install the renderer's global error listeners ONCE at module load time.
// They forward into the main-process reporter via the preload bridge.
//
// Why module-level rather than inside the component? React's StrictMode
// double-mounts effects in dev, which would install the listener twice.
// At module level we install exactly once per renderer process — and
// renderer processes don't "unmount" so we don't need a teardown.
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => {
    try {
      window.coasty?.reportRendererError({
        message: e.message || String(e.error || 'Unknown error'),
        stack: e.error?.stack,
        url: e.filename,
        line: e.lineno,
        col: e.colno,
        userAgent: navigator.userAgent,
        from: 'window',
      })
    } catch { /* nothing more we can do */ }
  })
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason
    try {
      window.coasty?.reportRendererError({
        message: typeof reason === 'string'
          ? reason
          : reason?.message || JSON.stringify(reason).slice(0, 200),
        stack: reason?.stack,
        userAgent: navigator.userAgent,
        from: 'unhandledrejection',
      })
    } catch { /* nothing more we can do */ }
  })
}

function AppInner() {
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

  // Subscribe to the main process's ``auth:session-died`` event.
  // When the auth layer declares the session permanently dead
  // (refresh failed, network error during refresh, scheduled refresh
  // failed, bridge auth_rejected, ...), this listener fires and the
  // auth-store auto-signs-out → UI returns to AuthScreen. Zero retry
  // loops, zero zombie state, zero "the app keeps saying not
  // authenticated" UX.
  React.useEffect(() => {
    return useAuthStore.getState().initSessionDeathListener()
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

  // ── Auto-expand on AWAITING_HUMAN handoff, auto-collapse on resume ──
  //
  // When the agent enters the human-handoff stage (the user needs to sign in
  // somewhere, complete a CAPTCHA, etc), the user often has the overlay in
  // its compact pill form — they could miss the prompt entirely. Auto-expand
  // so the AwaitingHumanBanner is visible. When they click "Done, Continue"
  // and the chat store clears `awaitingHuman`, collapse back to compact —
  // BUT only if WE were the ones who auto-expanded. If the user manually
  // expanded the overlay before the handoff, leave them in expanded; yanking
  // them back to compact while they're reading the chat would be jarring.
  const awaitingHuman = useChatStore((s) => s.awaitingHuman)
  const autoExpandedRef = React.useRef(false)
  React.useEffect(() => {
    if (awaitingHuman) {
      // Handoff stage entered. If we're in compact, expand and remember
      // we did it so the resume effect can undo it.
      if (mode === 'compact') {
        autoExpandedRef.current = true
        setMode('expanded')
      }
      // If already expanded, leave the overlay alone — the banner will
      // render in-place. autoExpandedRef stays false in that case so
      // the resume path doesn't auto-collapse them.
    } else {
      // Handoff cleared (user clicked Done, Continue OR the agent
      // resumed on its own). Only auto-collapse if WE auto-expanded.
      if (autoExpandedRef.current && mode === 'expanded') {
        autoExpandedRef.current = false
        setMode('compact')
      } else {
        // Reset the flag in case we never expanded but it somehow got
        // set (defensive — keeps state machine clean).
        autoExpandedRef.current = false
      }
    }
    // We deliberately depend ONLY on `awaitingHuman` here. Including
    // `mode` would re-fire this effect every time the user manually
    // toggles compact/expanded mid-handoff, fighting their intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingHuman])

  // Auto sign-out ONLY when the backend explicitly rejects the JWT
  // ('auth_error' state is set from ws-bridge.ts on an auth_failed message).
  //
  // Previously this fired on ANY 'error' state — which includes transient
  // connection errors (TLS handshake blip, brief 503, DNS hiccup, WS upgrade
  // rejected).  The result was: sign-in succeeds → bridge:connect → first WS
  // error → auto-sign-out → back to AuthScreen, making it look like sign-in
  // is broken.  Gate strictly on 'auth_error' so genuine sign-outs still
  // happen when the token is revoked, but connectivity blips don't kick the
  // user.
  React.useEffect(() => {
    if (connectionState === 'auth_error' && isAuthenticated) {
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

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  )
}
