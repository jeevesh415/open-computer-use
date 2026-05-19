import React from 'react'

/**
 * Toast notification that appears when a desktop automation action or a
 * screenshot fails due to missing macOS permissions.
 *
 * ─── Two display modes ───────────────────────────────────────────────────
 *
 *  1. **Pre-grant** (default): user has never granted, or PermissionsGuard
 *     wasn't dismissed. Shows "Grant Access" + "Restart" as separate
 *     actions — the user still needs to go to System Settings first.
 *
 *  2. **Post-dismissal regrant prompt**: user previously dismissed the
 *     PermissionsGuard (skipped onboarding) and then hit a denial. The
 *     toast wording changes to "Granted permission in Settings? Restart
 *     to apply." and the primary CTA becomes single-click "Restart" —
 *     this is the 90%-fix case for Nitish-shaped reports where the user
 *     DID grant in Settings but the running process can't see it. The
 *     "Open Settings" path is still there as a secondary action for the
 *     "actually I haven't granted yet" case.
 *
 * ─── How we know which mode to use ───────────────────────────────────────
 *
 * The PermissionsGuard component writes one of these localStorage keys
 * when it closes:
 *   - `coasty_permissions_granted` = "true"  → all perms reported OK at mount
 *   - `coasty_permissions_dismissed` = "true" → user clicked Skip
 *
 * If `dismissed === "true"` we use mode 2. Otherwise mode 1.
 */

// Keep these in sync with PermissionsGuard.tsx (they're the same keys).
const PERMISSIONS_DISMISSED_KEY = 'coasty_permissions_dismissed'

function readDismissed(): boolean {
  try {
    return typeof localStorage !== 'undefined'
      && localStorage.getItem(PERMISSIONS_DISMISSED_KEY) === 'true'
  } catch {
    // localStorage can throw in sandboxed contexts (SecurityError); the
    // toast should still render usefully when it does.
    return false
  }
}

export function PermissionToast() {
  const [visible, setVisible] = React.useState(false)
  const [permType, setPermType] = React.useState<string>('')
  // Snapshot dismissal state at the moment the toast is shown so the
  // copy doesn't flicker mid-render if localStorage changes underneath.
  const [dismissedAtShow, setDismissedAtShow] = React.useState(false)
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    const cleanup = window.coasty.onPermissionDenied((data) => {
      setPermType(data.type)
      setDismissedAtShow(readDismissed())
      setVisible(true)

      // Auto-dismiss after 12 seconds so the toast doesn't linger forever
      // if the user ignores it. Same timing for both modes — restart
      // prompts shouldn't be sticker than grant prompts.
      if (hideTimer.current) clearTimeout(hideTimer.current)
      hideTimer.current = setTimeout(() => setVisible(false), 12000)
    })

    return () => {
      cleanup()
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [])

  if (!visible) return null

  const isAccessibility = permType === 'accessibility'
  // "Regrant restart" mode applies to screen-recording denials that
  // arrive AFTER the user dismissed the PermissionsGuard. Accessibility
  // denials don't have the same TCC-cache issue (the API reflects
  // changes live for Accessibility), so we keep the "Grant Access" CTA
  // primary there even after dismissal.
  const restartMode = dismissedAtShow && !isAccessibility

  const handleGrant = () => {
    if (isAccessibility) {
      window.coasty.requestAccessibility()
    } else {
      window.coasty.openScreenRecordingSettings()
    }
  }

  const handleRestart = () => {
    window.coasty.relaunch()
  }

  // ─── Copy ──────────────────────────────────────────────────────────────
  let title: string
  let description: string
  let steps: React.ReactNode

  if (restartMode) {
    // Post-dismissal screen-recording denial. The user almost certainly
    // already granted permission in Settings — they just need to restart
    // for the running process to pick it up. Make THAT the primary
    // message, with "actually open Settings" as the fallback.
    title = 'Restart Coasty to apply permission'
    description = 'You granted Screen Recording in System Settings. Coasty needs a restart for the change to take effect.'
    steps = (
      <>
        macOS caches permission per running app process.
        {' '}<span className="text-neutral-300">Restart Coasty</span> and you're good to go.
        {' '}Haven't granted yet? Use <span className="text-neutral-300">Open Settings</span>.
      </>
    )
  } else if (isAccessibility) {
    title = 'Accessibility Permission Required'
    description = 'Coasty needs Accessibility access to control mouse, keyboard, and scroll on your Mac.'
    steps = (
      <>
        1. Click <span className="text-neutral-300">Grant Access</span> below to open System Settings.
        {' '}2. Enable <span className="text-neutral-300">Coasty</span> in the list.
        {' '}3. Click <span className="text-neutral-300">Restart</span> for changes to take effect.
      </>
    )
  } else {
    title = 'Screen Recording Permission Required'
    description = 'Coasty needs Screen Recording access to capture screenshots on your Mac.'
    steps = (
      <>
        1. Click <span className="text-neutral-300">Grant Access</span> below to open System Settings.
        {' '}2. Enable <span className="text-neutral-300">Coasty</span> in the list.
        {' '}3. Click <span className="text-neutral-300">Restart</span> for changes to take effect.
      </>
    )
  }

  return (
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[9999] w-[340px] animate-slide-down" data-testid="permission-toast">
      <div className="bg-neutral-900 border border-amber-500/30 rounded-xl shadow-2xl shadow-black/40 overflow-hidden">
        {/* Amber accent bar */}
        <div className="h-[2px] bg-gradient-to-r from-amber-500/60 via-amber-400 to-amber-500/60" />

        <div className="px-4 py-3 space-y-2.5">
          {/* Header */}
          <div className="flex items-start gap-2.5">
            <div className="flex-shrink-0 mt-0.5 w-7 h-7 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              {restartMode ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
                  <path d="M21 2v6h-6" />
                  <path d="M3 12a9 9 0 0115-6.7L21 8" />
                  <path d="M3 22v-6h6" />
                  <path d="M21 12a9 9 0 01-15 6.7L3 16" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-white leading-snug" data-testid="permission-toast-title">{title}</div>
              <div className="text-[11px] text-neutral-400 leading-relaxed mt-0.5">{description}</div>
            </div>
            <button
              onClick={() => setVisible(false)}
              className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-neutral-800 text-neutral-600 hover:text-neutral-300 transition-colors"
              aria-label="Dismiss"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Steps */}
          <div className="text-[10.5px] text-neutral-500 leading-relaxed pl-0.5">
            {steps}
          </div>

          {/* Actions — order depends on mode */}
          <div className="flex items-center gap-2">
            {restartMode ? (
              <>
                <button
                  onClick={handleRestart}
                  data-testid="permission-toast-primary"
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-neutral-900 rounded-lg font-semibold text-[12px] transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 2v6h-6" />
                    <path d="M3 12a9 9 0 0115-6.7L21 8" />
                  </svg>
                  Restart Coasty
                </button>
                <button
                  onClick={handleGrant}
                  data-testid="permission-toast-secondary"
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-700/50 text-[12px] font-medium text-neutral-400 hover:text-neutral-200 hover:border-neutral-600 transition-colors"
                >
                  Open Settings
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleGrant}
                  data-testid="permission-toast-primary"
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-neutral-900 rounded-lg font-semibold text-[12px] transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                  Grant Access
                </button>
                <button
                  onClick={handleRestart}
                  data-testid="permission-toast-secondary"
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-700/50 text-[12px] font-medium text-neutral-400 hover:text-neutral-200 hover:border-neutral-600 transition-colors"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 2v6h-6" />
                    <path d="M3 12a9 9 0 0115-6.7L21 8" />
                  </svg>
                  Restart
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
