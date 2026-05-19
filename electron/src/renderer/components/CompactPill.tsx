import React from 'react'
import { useConnectionStore } from '../stores/connection-store'
import { useWindowStore } from '../stores/window-store'
import { useAuthStore } from '../stores/auth-store'
import { useChatSubmit, type SubmitResult } from '../hooks/useChatSubmit'

function statusDot(state: string): string {
  switch (state) {
    case 'connected': return 'bg-emerald-400'
    case 'connecting': return 'bg-yellow-400 animate-pulse'
    case 'error': return 'bg-red-400'
    default: return 'bg-neutral-500'
  }
}

export function CompactPill() {
  const connectionState = useConnectionStore((s) => s.state)
  const { toggleExpanded } = useWindowStore()
  const { signOut } = useAuthStore()
  const {
    isStreaming, canSend, handleSubmit, handleStop,
    isMachineBusy, isStoppingMachine, forceStopAndSend, dismissBusyState,
    pendingInputText, pendingInputAlreadyInChat,
  } = useChatSubmit()

  const [input, setInput] = React.useState('')

  // ── Busy-state auto-dismiss ──────────────────────────────────────────
  //
  // Two ways the busy state can be reached:
  //
  //   1. Pre-check busy (handleSubmit's machine-status IPC said yes).
  //      The user's typed text is PRESERVED in the local ``input``
  //      because we no longer clear it synchronously on submit (the
  //      web-app-style flow waits for the hook's outcome). If they
  //      then explicitly clear the input, they're saying "never mind"
  //      — dismiss the yellow state. pendingInputAlreadyInChat=false
  //      in this path, so the condition below permits the dismiss.
  //
  //   2. Post-error busy (the wire call DID run, addUserMessage ran
  //      inside _doSubmit, then the backend rejected mid-flight with
  //      MACHINE_BUSY). The local input was cleared by the 'sent'
  //      branch of the onSubmit handler BEFORE the busy event came
  //      back. ``input`` is empty here but the message is in the
  //      chat thread waiting to be retried. We MUST NOT auto-dismiss
  //      — that would orphan a visible chat message with no way to
  //      resend. pendingInputAlreadyInChat=true blocks the dismiss.
  React.useEffect(() => {
    if (
      isMachineBusy
      && !input.trim()
      && !pendingInputAlreadyInChat
    ) {
      dismissBusyState()
    }
  }, [input, isMachineBusy, pendingInputAlreadyInChat, dismissBusyState])

  // ── Submit handler ───────────────────────────────────────────────────
  //
  // Matches the web app contract: the typed text stays in the input
  // until the hook tells us what actually happened to it. Three
  // outcomes:
  //
  //   'sent'     → message landed in chat thread + wire call fired.
  //                Clear the input.
  //   'busy'     → machine is running another task; yellow button is
  //                now visible. KEEP the input so the user can edit
  //                or confirm. The web app does this too — typed text
  //                is never destroyed without confirmation.
  //   'rejected' → empty input, force-stop failed, etc. KEEP the input.
  //
  // We always expand the overlay on click so the user can see the
  // chat panel and (if busy) the banner explaining the situation.
  const onSubmit = async () => {
    if (isMachineBusy) {
      // Yellow Override & Run path. If the user typed something new
      // since busy was detected, send that; otherwise use the stash.
      let result: SubmitResult
      if (input.trim()) {
        result = await forceStopAndSend(input)
      } else if (pendingInputText.trim()) {
        result = await forceStopAndSend()
      } else {
        // Both input and stash are empty — nothing actionable. The
        // auto-dismiss useEffect will tidy isMachineBusy in this case.
        return
      }
      if (result === 'sent') {
        setInput('')
      }
      toggleExpanded()
      return
    }
    if (!canSend(input)) return
    const result = await handleSubmit(input)
    if (result === 'sent') {
      setInput('')
    }
    toggleExpanded() // expand to show the conversation (or the yellow banner)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className="glow-border animate-compact-in titlebar-drag flex items-center gap-2.5 w-full h-full px-3 rounded-2xl bg-neutral-900/90 backdrop-blur-xl select-none">
      {/* Coasty logo */}
      <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="coastyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(255,255,255,0)" stopOpacity={0} />
            <stop offset="30%" stopColor="rgba(255,255,255,0.1)" stopOpacity={1} />
            <stop offset="50%" stopColor="rgba(255,255,255,0.3)" stopOpacity={1} />
            <stop offset="70%" stopColor="rgba(255,255,255,0.6)" stopOpacity={1} />
            <stop offset="100%" stopColor="rgba(255,255,255,1)" stopOpacity={1} />
          </linearGradient>
        </defs>
        <circle cx="100" cy="100" r="100" fill="url(#coastyGrad)" />
      </svg>

      {/* Status dot */}
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot(connectionState)}`} />

      {/* Inline input.
          Placeholder communicates the three transport states the user
          can reach: streaming a response (Working...), connected and
          idle (Send a message...), or blocked because another task is
          running on this machine (Another task running — click
          Override & Run to stop it). The third state is the user-facing
          surface for the busy-machine UX; without it the empty input
          beside a yellow button is confusing — users don't know whether
          their message was queued, lost, or pending. */}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={
          isStreaming
            ? 'Working...'
            : isMachineBusy
              ? 'Another task running — click Override & Run to stop it'
              : 'Send a message...'
        }
        disabled={connectionState !== 'connected' || isStreaming}
        className="titlebar-no-drag flex-1 min-w-0 bg-transparent text-xs text-neutral-200 placeholder-neutral-500 outline-none disabled:opacity-50"
      />

      {/* Actions */}
      <div className="titlebar-no-drag flex items-center gap-1">
        {isStreaming ? (
          <button
            onClick={handleStop}
            className="px-2 py-1 rounded-lg bg-red-600/20 border border-red-500/30 text-red-400 text-[11px] font-medium hover:bg-red-600/30 transition-colors"
          >
            Stop
          </button>
        ) : isMachineBusy && (input.trim() || pendingInputAlreadyInChat) ? (
          // Yellow "Override & Run" — same colour family as the web app's
          // chat-input.tsx Override button (amber-600). Clicking it calls
          // forceStopAndSend which stops the running task on this machine
          // and submits the user's input. Disabled while the stop call is
          // in flight to prevent double-submit.
          //
          // Visibility logic:
          //   * input.trim()              — pre-check path: text the user
          //                                 typed is preserved (web-app
          //                                 contract). Show the button so
          //                                 they can confirm.
          //   * pendingInputAlreadyInChat — post-error path: the original
          //                                 input was cleared when the
          //                                 'sent' branch ran, but the
          //                                 message is in the chat thread
          //                                 waiting to be retried. Show
          //                                 the button so they can re-send
          //                                 (forceStopAndSend with no
          //                                 args picks up the stash).
          //
          // We do NOT use ``pendingInputText.trim()`` here because pre-
          // check stash mirrors the input — gating on it would keep the
          // button visible AFTER the user clears their input intending
          // to dismiss, defeating the auto-dismiss useEffect above.
          <button
            onClick={onSubmit}
            disabled={isStoppingMachine}
            aria-label="Override and Run"
            title="Stop running task and start this one"
            className="px-2 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-medium disabled:opacity-50 transition-colors"
          >
            {isStoppingMachine ? 'Switching…' : 'Override & Run'}
          </button>
        ) : input.trim() ? (
          <button
            onClick={onSubmit}
            disabled={!canSend(input)}
            className="px-2 py-1 rounded-lg bg-brand-600 text-white text-[11px] font-medium hover:bg-brand-500 disabled:opacity-30 transition-colors"
          >
            Send
          </button>
        ) : null}

        <button
          onClick={() => toggleExpanded()}
          className="p-1.5 rounded-lg hover:bg-neutral-800/60 text-neutral-400 hover:text-neutral-200 transition-colors"
          title="Expand"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        <button
          onClick={signOut}
          className="p-1.5 rounded-lg hover:bg-neutral-800/60 text-neutral-500 hover:text-neutral-300 transition-colors"
          title="Sign out"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
