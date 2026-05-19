import { useState, useCallback } from 'react'
import { useChatStore } from '../stores/chat-store'
import { useAuthStore } from '../stores/auth-store'
import { useConnectionStore } from '../stores/connection-store'
import { sendChatMessage, withTimeout } from '../lib/api'

export interface FileRef {
  path: string
  name: string
  ext: string
  isDirectory: boolean
}

/**
 * Outcome of a submit attempt. Returned by ``handleSubmit`` and
 * ``forceStopAndSend`` so the UI can decide whether to clear the
 * input field, expand the chat, navigate, etc.
 *
 * ``'sent'``     — message landed in the chat thread + the wire call
 *                  fired. Component SHOULD clear its input + reset
 *                  any attached files.
 *
 * ``'busy'``     — fallback path only. The machine had another task
 *                  running AND the auto-stop attempt failed (e.g.
 *                  stop-machine IPC threw). The user's text is
 *                  STASHED so the manual yellow "Override & Run"
 *                  banner can drive a retry. Component MUST KEEP
 *                  the input so the user can confirm or clear to
 *                  cancel. In the common case where auto-stop works
 *                  this branch is never reached.
 *
 * ``'rejected'`` — couldn't send for a non-busy reason (empty input,
 *                  not connected, missing auth, force-stop failed).
 *                  Component should leave input alone — no UI state
 *                  change.
 *
 * Auto-override design (current behaviour, Coasty Desktop local mode)
 * ------------------------------------------------------------------
 * The user owns the local machine — clicking Send IS the
 * authorization to stop whatever's running. We don't ask. The
 * pre-check busy detection automatically stops the conflicting task
 * and proceeds with the send in the same gesture, so the user
 * experiences a single click and a slightly longer (~300 ms grace)
 * wait. No banner, no confirmation. The yellow banner only appears
 * if the auto-stop itself fails — the manual flow is the safety net
 * for the rare case where the user actually needs to intervene
 * (network error, repeated lock failure).
 */
export type SubmitResult = 'sent' | 'busy' | 'rejected'

/**
 * Build the wire-format user message from the trimmed text plus any
 * attached files/directories. The same string is used to (a) display
 * in the chat thread via ``addUserMessage`` and (b) ship to the
 * backend via ``sendChatMessage``, so it must be canonical — generating
 * it twice from the same inputs would be a bug-prone divergence.
 */
export function buildUserMessage(input: string, files?: FileRef[]): string {
  let userMessage = input.trim()
  if (files && files.length > 0) {
    const tags = files.map((f) =>
      f.isDirectory
        ? `<directory path="${f.path}" name="${f.name}">${f.name}</directory>`
        : `<file path="${f.path}" name="${f.name}">${f.name}</file>`,
    )
    userMessage = userMessage + '\n' + tags.join('\n')
  }
  return userMessage
}

export function useChatSubmit() {
  const {
    messages, isStreaming, chatId, chatTitle,
    addUserMessage, setStreaming, setAbortController, stopStreaming,
    appendAssistantContent, addToolCall, updateToolResult,
    finishAssistantMessage, clearMessages, ensureChat, loadChatList,
    setAwaitingHuman,
  } = useChatStore()
  const { user, machineId } = useAuthStore()
  const connectionState = useConnectionStore((s) => s.state)

  // ── Yellow "Override & Run" state ─────────────────────────────────────
  // Mirror of the web app pattern at app/components/chat-input/chat-input.tsx.
  // When the user submits and the backend reports the machine is already
  // running another task, we DON'T silently send and let the user see an
  // error string in the chat thread. We set ``isMachineBusy`` so the UI
  // re-renders with a yellow "Override & Run" button. Clicking that button
  // calls ``forceStopAndSend`` which stops the previous task and submits
  // again.
  const [isMachineBusy, setIsMachineBusy] = useState(false)
  const [isStoppingMachine, setIsStoppingMachine] = useState(false)
  // Pending input is what the user typed before we discovered the
  // machine was busy. Stored so ``forceStopAndSend`` can re-submit it
  // without requiring the UI to keep the textarea state.
  //
  // ``alreadyInChat`` distinguishes the two ways busy state is reached:
  //
  //   * pre-check (handleSubmit detected busy via the machine-status
  //     IPC BEFORE sending): the user's message was NEVER added to the
  //     chat store. ``alreadyInChat=false``. forceStopAndSend will run
  //     a normal _doSubmit which addUserMessages it.
  //
  //   * post-error (sendChatMessage already ran, backend rejected with
  //     MACHINE_BUSY): the user's message IS in the chat store from
  //     the failed run. ``alreadyInChat=true``. forceStopAndSend must
  //     run _doSubmit in retry mode so it does NOT re-add the message
  //     (otherwise the chat shows it twice and the wire payload sends
  //     it twice in the messages array).
  const [pendingInput, setPendingInput] = useState<{
    input: string
    files?: FileRef[]
    alreadyInChat: boolean
  } | null>(null)

  const canSend = (input: string) =>
    input.trim().length > 0
    && !isStreaming
    && !isStoppingMachine
    && connectionState === 'connected'
  // ``!isStoppingMachine`` rejects rapid double-clicks while the
  // auto-override is mid-flight (stopMachine IPC + 300 ms grace).
  // Without this gate, a user mashing Enter/Send during the brief
  // recovery window would trigger N stopMachine calls and N sends.

  // Pre-flight busy check. Returns true if the machine is actively
  // running another task (different chat). On any error (network, IPC
  // not available, backend 5xx) we fail-open — return false so the
  // user's send goes through and the chat-route's busy error becomes
  // the fallback signal.
  const checkBusy = useCallback(async (): Promise<boolean> => {
    if (!machineId) return false
    try {
      const res = await window.coasty.checkMachineBusy(machineId)
      return res?.success ? !!res.busy : false
    } catch {
      return false
    }
  }, [machineId])

  // Internal: actually run the chat submission. Used by both
  // handleSubmit (when not busy) and forceStopAndSend (after stop).
  //
  // ``isRetry``: when true, the user message is ALREADY in the chat
  // store (from a prior failed attempt that hit MACHINE_BUSY) and the
  // ``messages`` snapshot already includes it. Skip the re-add and
  // build the wire payload directly from the snapshot — otherwise the
  // chat UI would show a duplicate user message and the backend would
  // see it twice in the messages array.
  const _doSubmit = useCallback(
    async (input: string, files?: FileRef[], opts?: { isRetry?: boolean }) => {
      if (!user || !machineId) return

      const userMessage = buildUserMessage(input, files)

      const isRetry = !!opts?.isRetry
      if (!isRetry) {
        addUserMessage(userMessage)
      }
      setStreaming(true)
      // Stash the LIVE message + files so a post-error MACHINE_BUSY
      // event can re-submit the same content via forceStopAndSend
      // without making the user retype. Cleared on success or if the
      // user dismisses the busy state.
      //
      // alreadyInChat=true: the user's message has been added to the
      // chat store either by THIS call's addUserMessage (above) or by
      // the prior failed run we're retrying. Either way it's there now.
      setPendingInput({ input, files, alreadyInChat: true })

      // Resolve the chat id. ``ensureChat`` is designed to always
      // return SOMETHING truthy (a real Supabase UUID, an existing
      // synced chatId, or a ``local_<timestamp>`` fallback) — but
      // we guard defensively because the backend's
      // ``if not chat_request.chat_id`` check rejects an empty string
      // with a 400 "Missing required fields" that would otherwise
      // surface as an opaque error in the chat thread.
      //
      // Surfacing this here as a console.warn + local fallback means
      // that even if ``ensureChat`` somehow returns "" / undefined
      // (e.g. a malformed createChat IPC response shape), we still
      // dispatch the wire call instead of looping forever on
      // "Missing required fields".
      //
      // 5s renderer-side timeout. ``ensureChat`` already wraps its
      // createChat IPC with a 30s timeout (see chat-store.ts), but
      // 30s is the dead-link budget for a background hydration call,
      // not the user-facing Send button. If the main process is
      // wedged (backend slow, supabase outage, IPC deadlock) the
      // user clicking Send must NOT see a 30s frozen overlay before
      // anything happens. 5s is generous for a healthy Supabase
      // round-trip (typical <500ms) yet short enough that a hang
      // routes to the local fallback id within a beat of the user's
      // click. The fallback is safe because the backend's chat
      // upsert is idempotent on the chat_id — if ensureChat
      // EVENTUALLY succeeded after we timed out, that real Supabase
      // chat row will simply never be referenced (orphaned + tidy);
      // and any subsequent message in this session that supplies
      // the same local_<ts> id will upsert into the same row.
      let activeChatId: string | undefined | null
      try {
        activeChatId = await withTimeout(ensureChat(userMessage), 5000, 'ensureChat')
      } catch (err) {
        console.warn(
          '[useChatSubmit] ensureChat threw or timed out, using local fallback id',
          err,
        )
        activeChatId = undefined
      }
      if (!activeChatId || typeof activeChatId !== 'string') {
        console.warn(
          '[useChatSubmit] ensureChat returned a falsy chat id, ' +
          'falling back to a local id so the send can proceed. ' +
          'This indicates a bug in createChat IPC or chat-store hydration.',
          { received: activeChatId },
        )
        activeChatId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      }

      // Wire payload. On a fresh submission we manually append the new
      // user message because the just-fired ``addUserMessage`` setState
      // hasn't reached this scope's ``messages`` snapshot yet. On a
      // retry the message is ALREADY in ``messages`` from the failed
      // run, so we use it as-is.
      const allMessages = isRetry
        ? messages.map((m) => ({ role: m.role, content: m.content }))
        : [
            ...messages.map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content: userMessage },
          ]

      const controller = new AbortController()
      setAbortController(controller)

      // Track whether the current submission ended in a MACHINE_BUSY
      // event. If it did, KEEP the stashed pendingInput so the yellow
      // Override-and-Run button can re-submit the same content. If it
      // didn't (success OR a different error), clear the stash so a
      // future MACHINE_BUSY can't accidentally re-fire stale content.
      let busyDetectedThisRun = false

      // Ownership guard for the `finally` block. The user can stop
      // this task and start a NEW one before our `await sendChatMessage`
      // unwinds — in that case the new request's `setAbortController`
      // has already overwritten the store. Clearing `isStreaming` /
      // `abortController` in our finally would wipe the new request's
      // state, leaving the user staring at a frozen overlay until
      // they submit again. The guard below makes our cleanup a no-op
      // unless the store's controller is STILL ours.
      const isStillOurRun = () =>
        useChatStore.getState().abortController === controller

      try {
        await sendChatMessage(
          {
            messages: allMessages,
            chatId: activeChatId,
            userId: user.id,
            machineId,
          },
          {
            onText: (text) => appendAssistantContent(text),
            onToolCall: (data) =>
              addToolCall({
                toolCallId: data.toolCallId,
                toolName: data.toolName,
                args: data.args,
                state: 'pending',
              }),
            onToolResult: (data) =>
              updateToolResult(data.toolCallId, data.result, data.frontendScreenshot),
            onReasoning: () => {},
            onFinish: (data) => {
              finishAssistantMessage(data.content, data.toolInvocations)
              loadChatList()
            },
            onAwaitingHuman: (data) => {
              setAwaitingHuman({
                reason: data.reason,
                machineId: data.machineId,
                since: Date.now(),
              })
            },
            onMachineBusy: (_data) => {
              // Backend rejected this submission because the machine
              // is already running another task. Instead of dropping a
              // generic "Error: ..." line into the chat (the legacy
              // behavior), flip the UI into the yellow "Override & Run"
              // state. The user's intent and message are preserved in
              // `pendingInput` (stamped at the top of _doSubmit), so
              // they can click the yellow button to stop the running
              // task and re-submit. Streaming flag clears too — but
              // only if THIS run still owns the store (avoid wiping
              // a subsequent submit's state).
              busyDetectedThisRun = true
              setIsMachineBusy(true)
              if (isStillOurRun()) setStreaming(false)
            },
            onError: (error) => {
              appendAssistantContent(`\n\nError: ${error}`)
              if (isStillOurRun()) setStreaming(false)
            },
          },
          controller.signal,
        )

        // Clear the stash UNLESS busy was detected during this run.
        // If busy fired, we keep the stash so the yellow Override-and-
        // Run button has the user's content ready to re-submit.
        if (!busyDetectedThisRun) {
          setPendingInput(null)
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          appendAssistantContent(`\n\nError: ${err.message}`)
        }
      } finally {
        // Ownership guard — see `isStillOurRun` above. If a newer run
        // has taken over the store, leave its state alone.
        if (isStillOurRun()) {
          setStreaming(false)
          setAbortController(null)
        }
      }
    },
    [
      user, machineId, messages,
      addUserMessage, setStreaming, setAbortController,
      ensureChat, appendAssistantContent, addToolCall, updateToolResult,
      finishAssistantMessage, loadChatList, setAwaitingHuman,
    ],
  )

  const handleSubmit = useCallback(
    async (input: string, files?: FileRef[]): Promise<SubmitResult> => {
      if (!canSend(input) || !user || !machineId) return 'rejected'

      // ── Pre-flight busy detection + auto-override ─────────────────────
      //
      // The user is on a local desktop they own. Clicking Send IS the
      // authorization to stop whatever the machine is doing and run
      // the new task. We don't ask via a yellow "Override & Run"
      // banner — that level of confirmation made sense in the web app
      // where multiple tabs/devices share a machine, but on the local
      // desktop it just adds friction.
      //
      // Flow:
      //   busy=false → straight to _doSubmit (the common case).
      //
      //   busy=true  → AUTO-STOP inline, then proceed. The user sees
      //                a single ~300 ms delay between click and the
      //                message appearing in the chat, no banner. The
      //                300 ms grace gives the prior task's `finally`
      //                (billing teardown, Redis lock release) time
      //                to settle before we re-acquire.
      //
      //   stop fails → fall back to the manual banner. The user's
      //                input is preserved so they can click Override
      //                & Run to retry, or clear the input to cancel.
      //                This branch is the rare safety net for IPC
      //                errors / repeated lock failure.
      const busy = await checkBusy()
      if (busy) {
        setIsStoppingMachine(true)
        try {
          const stopRes = await window.coasty.stopMachine(machineId)
          // The backend's stop-machine endpoint either releases the
          // lock cleanly (released=true) or force-deletes a stale
          // Redis key (forced=true) — both are success. ``stopped=false
          // / reason="Machine is not busy"`` also means we can proceed
          // (the busy detection was a stale read). ``success=false``
          // is the only path that warrants the manual banner.
          if (stopRes && stopRes.success === false) {
            setIsStoppingMachine(false)
            setIsMachineBusy(true)
            setPendingInput({ input, files, alreadyInChat: false })
            return 'busy'
          }
          // 300 ms grace matches the web app + forceStopAndSend
          // pattern. Without it the next sendChatMessage can race
          // the prior session's release_machine and re-trip busy.
          await new Promise((r) => setTimeout(r, 300))
        } catch (err) {
          // stop-machine IPC threw (network error, main process
          // crashed, etc.). Surface the manual banner so the user
          // can retry once the underlying issue clears.
          setIsStoppingMachine(false)
          setIsMachineBusy(true)
          setPendingInput({ input, files, alreadyInChat: false })
          return 'busy'
        }
        setIsStoppingMachine(false)
        // Auto-stop succeeded — fall through to the normal send path.
      }

      // Not busy (or auto-recovered) — let _doSubmit handle both
      // adding the user message AND constructing the wire payload
      // that includes it. We DON'T call addUserMessage here
      // ourselves: _doSubmit owns this for a subtle reason — the
      // wire payload construction needs to APPEND the new user
      // message because the just-fired addUserMessage's setState
      // hasn't yet reached _doSubmit's ``messages`` closure snapshot
      // (React doesn't re-render between sync calls in the same
      // microtask). _doSubmit's ``isRetry=false`` branch does both
      // the addUserMessage AND the wire-side append in one place,
      // keeping these two derivations from drifting apart.
      setIsMachineBusy(false)
      setPendingInput(null)
      // Fire-and-forget: the user's message and streaming flag are
      // committed to the store SYNCHRONOUSLY at the top of _doSubmit
      // (addUserMessage + setStreaming(true)), so by the time this
      // line returns the chat thread already shows the user's bubble
      // and the working indicator. We MUST NOT await the stream — the
      // stream lasts as long as the agent runs (often minutes) and
      // awaiting it would keep the typed text trapped in the input
      // field for the entire run, which is the chat-input-not-
      // clearing bug. Errors inside _doSubmit are caught internally
      // and surfaced into the chat thread; the .catch() here is a
      // belt-and-braces against truly-unexpected throws.
      _doSubmit(input, files, { isRetry: false }).catch((err) => {
        console.error('[useChatSubmit] _doSubmit threw unexpectedly:', err)
      })
      return 'sent'
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canSend, user, machineId, checkBusy, _doSubmit],
  )

  // Yellow-button click handler. Stops the running task on the machine,
  // waits briefly for the lock to release, then re-submits the user's
  // pending input. Idempotent: if called twice in a row, the second call
  // is a no-op (``isStoppingMachine`` guards against re-entry).
  //
  // Returns a SubmitResult so the caller (CompactPill / Overlay) can
  // decide whether to clear its input field, expand the chat, etc.
  // Mirrors the contract of handleSubmit — the UI never assumes a send
  // succeeded just because a click handler resolved.
  const forceStopAndSend = useCallback(
    async (
      overrideInput?: string,
      overrideFiles?: FileRef[],
    ): Promise<SubmitResult> => {
      if (isStoppingMachine || !machineId) return 'rejected'
      // Resolve which input to send. Caller-supplied wins (e.g. user
      // edited the textarea after the busy state was detected); falls
      // back to the stashed pending input.
      //
      // ``isRetry`` decides whether _doSubmit re-adds the user message
      // to the chat store. True iff the message is ALREADY in the store
      // from a failed prior run (the post-error path); false iff this
      // is the first time the user is actually sending it (the
      // pre-check path). When the caller supplies an override input,
      // it's a fresh submission so isRetry=false regardless.
      const target =
        overrideInput !== undefined
          ? { input: overrideInput, files: overrideFiles, isRetry: false }
          : pendingInput
            ? {
                input: pendingInput.input,
                files: pendingInput.files,
                isRetry: pendingInput.alreadyInChat,
              }
            : null
      if (!target || !target.input.trim()) {
        // Nothing to send — clear the busy state so the UI returns to
        // its normal empty-input look. Caller treats this as 'rejected'
        // (no input was consumed, nothing to clear from their textarea).
        setIsMachineBusy(false)
        setPendingInput(null)
        return 'rejected'
      }

      setIsStoppingMachine(true)
      try {
        const stopRes = await window.coasty.stopMachine(machineId)
        if (stopRes?.success) {
          // Brief grace so the previous task's `finally` (billing
          // teardown, lock release) finishes before we acquire the lock
          // for the new submission. 300 ms matches the web app pattern.
          await new Promise((r) => setTimeout(r, 300))
        }
        setIsMachineBusy(false)
        setPendingInput(null)
        // Fire-and-forget — same reasoning as handleSubmit. The user's
        // message is added to the chat thread synchronously inside
        // _doSubmit; awaiting the full stream here would keep the
        // input field locked for the duration of the agent run.
        _doSubmit(target.input, target.files, { isRetry: target.isRetry }).catch(
          (err) => {
            console.error(
              '[useChatSubmit] _doSubmit (forceStopAndSend) threw unexpectedly:',
              err,
            )
          },
        )
        return 'sent'
      } catch (err: any) {
        console.error('[Electron] forceStopAndSend failed:', err?.message)
        // Don't clear busy state on failure — let the user retry. Tell
        // the caller it was rejected so the input isn't wiped from
        // under them.
        return 'rejected'
      } finally {
        setIsStoppingMachine(false)
      }
    },
    [isStoppingMachine, machineId, pendingInput, _doSubmit],
  )

  // Allow the UI to dismiss the yellow state (e.g. user clears the
  // textarea or types something different and decides not to override).
  const dismissBusyState = useCallback(() => {
    setIsMachineBusy(false)
    setPendingInput(null)
  }, [])

  // ── Stop handler ─────────────────────────────────────────────────────
  //
  // Two-phase stop:
  //   1. SYNC — abort the renderer's AbortController so the streaming
  //      indicator clears immediately and any in-flight SSE callbacks
  //      stop painting into the chat. This is what the user sees.
  //
  //   2. AWAITED — directly call `chat:stop-machine` on the backend
  //      so the machine lock is definitively released BEFORE the user
  //      can submit a new task. Without this, the user could click
  //      Stop → New Chat → Send fast enough that the new send hits a
  //      backend still holding the lock for the old task. Symptom: the
  //      first new submit appears to do nothing (commands get rejected
  //      with "task stopped" on the bridge until the prior task_end
  //      fires), and only the second submit actually starts.
  //
  // The signal listener in api.ts ALSO fires `window.coasty.abortChat`
  // which itself calls `/api/chat/stop-machine` — but it's fire-and-
  // forget and the renderer never awaits it. Calling stopMachine again
  // here is harmless (the backend's endpoint is idempotent) and gives
  // us the awaitable handle we need to guarantee ordering for the
  // user's next gesture.
  const handleStop = useCallback(async () => {
    stopStreaming()
    if (!machineId) return
    try {
      await window.coasty.stopMachine(machineId)
    } catch (err: any) {
      console.warn(
        '[useChatSubmit] post-stop stopMachine failed (continuing):',
        err?.message ?? err,
      )
    }
  }, [stopStreaming, machineId])

  return {
    messages,
    isStreaming,
    chatId,
    chatTitle,
    connectionState,
    canSend,
    handleSubmit,
    handleStop,
    clearMessages,
    loadChatList,
    // Yellow "Override & Run" surface
    isMachineBusy,
    isStoppingMachine,
    forceStopAndSend,
    dismissBusyState,
    // The text the user typed that is now stashed waiting for the
    // user's "Override & Run" decision. Empty string when no stash —
    // the UI can use this to (a) decide whether to render the yellow
    // button at all and (b) show a preview of the queued message.
    pendingInputText: pendingInput?.input ?? '',
    // Whether the stashed message is ALREADY in the chat thread.
    //
    //   * false → pre-check stash (busy detected BEFORE the wire
    //     call ran; nothing was added to the chat thread). The UI
    //     can safely auto-dismiss when the user clears their input
    //     — there's no orphan visible to recover.
    //
    //   * true  → post-error stash (the wire call DID run,
    //     ``_doSubmit`` already called ``addUserMessage``, and the
    //     backend rejected mid-flight with MACHINE_BUSY). The user's
    //     message is visible in the chat thread. The UI MUST NOT
    //     auto-dismiss when input is empty — that would orphan the
    //     visible message with no way to retry.
    //
    // Defaults to false when there is no stash, so the UI's
    // ``!pendingInputAlreadyInChat`` guard reads naturally: "no
    // post-error stash → safe to auto-dismiss".
    pendingInputAlreadyInChat: pendingInput?.alreadyInChat ?? false,
  }
}
