import React from 'react'
import { useAuthStore } from '../stores/auth-store'

/**
 * First-run UI for OSS mode. Single textarea — paste a `COASTY_API_KEY`,
 * press Validate, key is verified against /v1/credits and persisted via
 * safeStorage for future launches.
 *
 * Visual language matches AuthScreen.tsx (frameless card on neutral-950
 * background, white primary CTA, subtle hairline borders).
 *
 * Optional escape hatch: "I have a Coasty account" link reveals the
 * existing AuthScreen for production-mode sign-in. We only do that if the
 * build was wired with Supabase env vars — otherwise the link stays hidden
 * to avoid promising a flow that can't complete.
 */
export function OssKeyScreen({ onSwitchToProduction }: { onSwitchToProduction?: () => void }) {
  const { submitOssKey } = useAuthStore()
  const [key, setKey] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [success, setSuccess] = React.useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!key.trim()) {
      setError('Please paste your API key')
      return
    }
    setError(null)
    setSuccess(null)
    setSubmitting(true)
    const result = await submitOssKey(key)
    setSubmitting(false)
    if (!result.success) {
      setError(result.error || 'Failed to validate key')
      return
    }
    setSuccess(result.tier ? `Validated. Tier: ${result.tier}.` : 'Validated.')
    // No further action — checkSession in App.tsx flips us to Overlay
    // automatically once isAuthenticated becomes true.
  }

  const openDevPortal = () => {
    // Opens via the safe-external-url path in main process (window.open is
    // intercepted and routed through shell.openExternal there).
    window.open('https://coasty.ai/developers', '_blank', 'noopener')
  }

  const inputClass =
    'w-full px-3 py-2 bg-neutral-800/60 border border-neutral-700/50 rounded-lg text-[12px] text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-600 transition-colors font-mono'
  const btnPrimary =
    'w-full flex items-center justify-center gap-2.5 px-4 py-2 bg-white text-neutral-900 rounded-lg font-medium text-[13px] hover:bg-neutral-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'

  const titleBar = (
    <div className="titlebar-drag flex items-center justify-between px-4 py-1.5 flex-shrink-0">
      <span className="text-[11px] text-neutral-600 font-medium">Coasty Desktop</span>
      <div className="titlebar-no-drag flex items-center gap-1">
        <button
          onClick={() => window.close()}
          className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-neutral-800 text-neutral-500 hover:text-neutral-300 transition-colors"
          title="Close"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  )

  const logoSvg = (
    <svg className="w-12 h-12" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="ossLogo" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(255,255,255,0)" stopOpacity={0} />
          <stop offset="30%" stopColor="rgba(255,255,255,0.1)" stopOpacity={1} />
          <stop offset="50%" stopColor="rgba(255,255,255,0.3)" stopOpacity={1} />
          <stop offset="70%" stopColor="rgba(255,255,255,0.6)" stopOpacity={1} />
          <stop offset="100%" stopColor="rgba(255,255,255,1)" stopOpacity={1} />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="100" fill="url(#ossLogo)" />
    </svg>
  )

  return (
    <div className="flex flex-col h-screen bg-neutral-950 rounded-xl overflow-hidden">
      {titleBar}

      <div className="flex flex-col items-center justify-center flex-1 px-7">
        <div className="w-full max-w-sm space-y-4 text-center">
          <div className="flex flex-col items-center gap-3">
            {logoSvg}
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Coasty</h1>
              <p className="mt-1 text-neutral-400 text-[13px]">Your computer, autopiloted.</p>
            </div>
          </div>

          <div className="bg-neutral-900/80 border border-neutral-800/60 rounded-xl p-4 space-y-3 text-left">
            {error && (
              <p className="text-red-400 text-[11px] bg-red-500/10 rounded-lg px-2.5 py-1.5">{error}</p>
            )}
            {success && (
              <p className="text-emerald-400 text-[11px] bg-emerald-500/10 rounded-lg px-2.5 py-1.5">{success}</p>
            )}

            <div>
              <label className="block text-[11px] text-neutral-400 mb-1.5">
                Paste your <span className="text-white font-medium">COASTY_API_KEY</span>
              </label>
              <form onSubmit={handleSubmit} className="space-y-2.5">
                <textarea
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  disabled={submitting}
                  autoFocus
                  spellCheck={false}
                  rows={3}
                  placeholder="coasty_..."
                  className={inputClass}
                />
                <button type="submit" disabled={submitting || !key.trim()} className={btnPrimary}>
                  {submitting ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Validating...
                    </>
                  ) : (
                    'Validate & continue'
                  )}
                </button>
              </form>
            </div>

            <p className="text-center text-[11px] text-neutral-500">
              No key yet?{' '}
              <button
                type="button"
                onClick={openDevPortal}
                className="text-white hover:underline"
              >
                Get a free sandbox key
              </button>
            </p>

            {onSwitchToProduction && (
              <p className="text-center text-[11px] text-neutral-500">
                Have a Coasty account?{' '}
                <button
                  type="button"
                  onClick={onSwitchToProduction}
                  className="text-white hover:underline"
                >
                  Sign in instead
                </button>
              </p>
            )}
          </div>

          <p className="text-neutral-600 text-[10px]">
            Your key is stored encrypted with your OS keychain. It never leaves this device.
          </p>
        </div>
      </div>
    </div>
  )
}
