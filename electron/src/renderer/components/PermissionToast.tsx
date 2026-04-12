import React from 'react'

/**
 * Toast notification that appears when a desktop automation action fails
 * due to missing macOS permissions. Shows actionable buttons to grant
 * permission or restart the app.
 */
export function PermissionToast() {
  const [visible, setVisible] = React.useState(false)
  const [permType, setPermType] = React.useState<string>('')
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    const cleanup = window.coasty.onPermissionDenied((data) => {
      setPermType(data.type)
      setVisible(true)

      // Auto-dismiss after 12 seconds
      if (hideTimer.current) clearTimeout(hideTimer.current)
      hideTimer.current = setTimeout(() => setVisible(false), 12000)
    })

    return () => {
      cleanup()
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [])

  if (!visible) return null

  const handleGrant = () => {
    if (permType === 'accessibility') {
      window.coasty.requestAccessibility()
    } else {
      window.coasty.openScreenRecordingSettings()
    }
  }

  const handleRestart = () => {
    window.coasty.relaunch()
  }

  const title = permType === 'accessibility'
    ? 'Accessibility Permission Required'
    : 'Screen Recording Permission Required'

  const description = permType === 'accessibility'
    ? 'Coasty needs Accessibility access to control mouse, keyboard, and scroll on your Mac.'
    : 'Coasty needs Screen Recording access to capture screenshots on your Mac.'

  return (
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[9999] w-[340px] animate-slide-down">
      <div className="bg-neutral-900 border border-amber-500/30 rounded-xl shadow-2xl shadow-black/40 overflow-hidden">
        {/* Amber accent bar */}
        <div className="h-[2px] bg-gradient-to-r from-amber-500/60 via-amber-400 to-amber-500/60" />

        <div className="px-4 py-3 space-y-2.5">
          {/* Header */}
          <div className="flex items-start gap-2.5">
            <div className="flex-shrink-0 mt-0.5 w-7 h-7 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-white leading-snug">{title}</div>
              <div className="text-[11px] text-neutral-400 leading-relaxed mt-0.5">{description}</div>
            </div>
            <button
              onClick={() => setVisible(false)}
              className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-neutral-800 text-neutral-600 hover:text-neutral-300 transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Steps */}
          <div className="text-[10.5px] text-neutral-500 leading-relaxed pl-0.5">
            1. Click <span className="text-neutral-300">Grant Access</span> below to open System Settings.
            {' '}2. Enable <span className="text-neutral-300">Coasty</span> in the list.
            {' '}3. Click <span className="text-neutral-300">Restart</span> for changes to take effect.
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleGrant}
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
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-700/50 text-[12px] font-medium text-neutral-400 hover:text-neutral-200 hover:border-neutral-600 transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 2v6h-6" />
                <path d="M3 12a9 9 0 0115-6.7L21 8" />
              </svg>
              Restart
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
