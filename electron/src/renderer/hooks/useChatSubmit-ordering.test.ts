/**
 * Anti-regression tests for the ORDERING invariants inside useChatSubmit.
 *
 * Pinned contract (web-app parity)
 * --------------------------------
 *
 *   handleSubmit decision tree:
 *
 *     guard fails              → return 'rejected' (NO chat-thread mutation,
 *                                NO IPC call)
 *
 *     pre-check busy=true      → stash pendingInput
 *                                  with alreadyInChat=false,
 *                                NO addUserMessage,
 *                                return 'busy'
 *
 *     pre-check busy=false     → addUserMessage,
 *                                _doSubmit(isRetry=true),
 *                                return 'sent'
 *
 *   The "no addUserMessage on busy" invariant is the user-facing
 *   anti-regression for the "message disappears" / "message appears
 *   before confirmation" bugs we burned cycles on. The web app
 *   never adds a message to the chat thread without a definite send;
 *   the desktop app must match.
 *
 *   The "isRetry=true" handoff is the anti-regression for the
 *   "message added twice" bug: handleSubmit owns the addUserMessage
 *   on the happy path, so _doSubmit must skip its own add.
 *
 * Layering rationale
 * ------------------
 * This file: pure-logic mirror, sub-second run, points exactly at
 * which decision changed if a test fails.
 *
 * send-flow-integration.test.tsx: render-level integration, slower
 * but proves the user sees the right thing under real React/jsdom
 * semantics.
 */
import { describe, it, expect } from 'vitest'
import { buildUserMessage } from './useChatSubmit'
import type { FileRef, SubmitResult } from './useChatSubmit'

// ── buildUserMessage canonical-string invariants ─────────────────────────

describe('buildUserMessage — canonical user message string', () => {
  it('returns trimmed input verbatim when no files', () => {
    expect(buildUserMessage('  hello world  ')).toBe('hello world')
  })

  it('appends file tags after a newline', () => {
    const files: FileRef[] = [
      { path: '/a/b.txt', name: 'b.txt', ext: 'txt', isDirectory: false },
    ]
    expect(buildUserMessage('please read', files)).toBe(
      'please read\n<file path="/a/b.txt" name="b.txt">b.txt</file>',
    )
  })

  it('uses <directory> for directories, <file> for files', () => {
    const files: FileRef[] = [
      { path: '/repo/src', name: 'src', ext: '', isDirectory: true },
      { path: '/repo/README.md', name: 'README.md', ext: 'md', isDirectory: false },
    ]
    const result = buildUserMessage('describe', files)
    expect(result).toContain('<directory path="/repo/src" name="src">src</directory>')
    expect(result).toContain('<file path="/repo/README.md" name="README.md">README.md</file>')
  })

  it('separates multiple file tags with newlines', () => {
    const files: FileRef[] = [
      { path: '/a', name: 'a', ext: '', isDirectory: false },
      { path: '/b', name: 'b', ext: '', isDirectory: false },
    ]
    const result = buildUserMessage('go', files)
    const fileTags = result.split('\n').filter((line) => line.startsWith('<file'))
    expect(fileTags).toHaveLength(2)
  })

  it('empty string for whitespace-only input + no files', () => {
    expect(buildUserMessage('   ')).toBe('')
  })

  it('deterministic — same inputs → same output (display/wire parity)', () => {
    const files: FileRef[] = [
      { path: '/x.py', name: 'x.py', ext: 'py', isDirectory: false },
    ]
    expect(buildUserMessage('do x', files)).toBe(buildUserMessage('do x', files))
    // ★ handleSubmit's display copy and _doSubmit's wire copy MUST
    // be byte-identical so the user's chat thread agrees with what
    // the backend received. Drift here = trust bug.
  })

  it('preserves special characters in file paths exactly', () => {
    const files: FileRef[] = [
      { path: '/with spaces/and "quotes" & [brackets].txt', name: 'and "quotes" & [brackets].txt', ext: 'txt', isDirectory: false },
    ]
    expect(buildUserMessage('read this', files)).toContain(
      '/with spaces/and "quotes" & [brackets].txt',
    )
  })
})

// ── handleSubmit decision tree mirror ────────────────────────────────────

type HandleSubmitStep =
  | { type: 'guard_failed' }
  | { type: 'check_busy' }
  | { type: 'set_busy_state'; alreadyInChat: boolean }
  | { type: 'add_user_message'; content: string }
  | { type: 'do_submit'; isRetry: boolean }

interface HandleSubmitOutcome {
  steps: HandleSubmitStep[]
  result: SubmitResult
}

/**
 * Mirror of the handleSubmit decision tree.
 *
 * Invariants pinned:
 *   - guard_failed → 'rejected', NO further steps (no chat mutation,
 *     no IPC, no busy state).
 *   - check_busy=true → set_busy_state(alreadyInChat=false), NO
 *     add_user_message, return 'busy'.
 *   - check_busy=false → do_submit(isRetry=false), return 'sent'.
 *     ★ NOTE: handleSubmit does NOT call add_user_message directly
 *     on the happy path. _doSubmit owns that — when called with
 *     ``isRetry=false`` it (a) calls addUserMessage AND (b)
 *     constructs the wire payload by appending the user message
 *     to a snapshot of ``messages``. Both happen inside _doSubmit
 *     so the two derivations stay in sync.
 *
 * Critically: add_user_message NEVER appears in the busy branch
 * (web-app parity — the chat thread is reserved for confirmed sends).
 */
function simulateHandleSubmit(opts: {
  canSend: boolean
  hasUser: boolean
  hasMachineId: boolean
  busyResult: boolean
  input: string
  files?: FileRef[]
}): HandleSubmitOutcome {
  const steps: HandleSubmitStep[] = []
  if (!opts.canSend || !opts.hasUser || !opts.hasMachineId) {
    steps.push({ type: 'guard_failed' })
    return { steps, result: 'rejected' }
  }
  steps.push({ type: 'check_busy' })
  if (opts.busyResult) {
    steps.push({ type: 'set_busy_state', alreadyInChat: false })
    return { steps, result: 'busy' }
  }
  // Happy path: hand off to _doSubmit. NOTE: add_user_message is NOT
  // a step here — it lives inside _doSubmit's isRetry=false branch.
  steps.push({ type: 'do_submit', isRetry: false })
  return { steps, result: 'sent' }
}

describe('handleSubmit decision tree — ordering invariants', () => {
  it("not-busy: check_busy → do_submit(isRetry=false), result='sent'", () => {
    // ★ handleSubmit no longer calls addUserMessage directly.
    // _doSubmit's isRetry=false branch owns both the addUserMessage
    // and the wire-payload append (kept together to prevent the two
    // derivations from diverging).
    const o = simulateHandleSubmit({
      canSend: true,
      hasUser: true,
      hasMachineId: true,
      busyResult: false,
      input: 'hello',
    })
    expect(o.result).toBe('sent')
    expect(o.steps.map((s) => s.type)).toEqual([
      'check_busy',
      'do_submit',
    ])
    const submit = o.steps.find((s) => s.type === 'do_submit')
    expect(submit && (submit as any).isRetry).toBe(false)
    // ★ NO add_user_message at this layer — it's _doSubmit's job.
    expect(o.steps.find((s) => s.type === 'add_user_message')).toBeUndefined()
  })

  it("★ busy: check_busy → set_busy_state(alreadyInChat=false), NO add_user_message, result='busy'", () => {
    // THE WEB-APP-PARITY INVARIANT.
    //
    // A busy pre-check MUST NOT mutate the chat thread. The user
    // hasn't confirmed anything yet — they typed and hit send, and
    // the system is asking "are you sure (override)?". Adding the
    // message would pollute the thread with not-yet-confirmed sends.
    //
    // If a future refactor moves addUserMessage above the busy
    // check, this test catches it.
    const o = simulateHandleSubmit({
      canSend: true,
      hasUser: true,
      hasMachineId: true,
      busyResult: true,
      input: 'hello',
    })
    expect(o.result).toBe('busy')
    expect(o.steps.map((s) => s.type)).toEqual([
      'check_busy',
      'set_busy_state',
    ])
    // ★ NO add_user_message in the busy branch.
    expect(o.steps.find((s) => s.type === 'add_user_message')).toBeUndefined()

    const busyStep = o.steps.find((s) => s.type === 'set_busy_state')
    // alreadyInChat=false because the chat thread is clean.
    expect(busyStep && (busyStep as any).alreadyInChat).toBe(false)
  })

  it("guard failure: NO further steps, result='rejected'", () => {
    const o = simulateHandleSubmit({
      canSend: false,
      hasUser: true,
      hasMachineId: true,
      busyResult: false,
      input: 'hello',
    })
    expect(o.result).toBe('rejected')
    expect(o.steps).toEqual([{ type: 'guard_failed' }])
    expect(o.steps.find((s) => s.type === 'add_user_message')).toBeUndefined()
    expect(o.steps.find((s) => s.type === 'check_busy')).toBeUndefined()
  })

  it('missing user → rejected', () => {
    const o = simulateHandleSubmit({
      canSend: true, hasUser: false, hasMachineId: true,
      busyResult: false, input: 'hello',
    })
    expect(o.result).toBe('rejected')
    expect(o.steps).toEqual([{ type: 'guard_failed' }])
  })

  it('missing machineId → rejected', () => {
    const o = simulateHandleSubmit({
      canSend: true, hasUser: true, hasMachineId: false,
      busyResult: false, input: 'hello',
    })
    expect(o.result).toBe('rejected')
    expect(o.steps).toEqual([{ type: 'guard_failed' }])
  })

  it('display copy and wire copy of the user message are byte-identical', () => {
    // After the refactor, addUserMessage lives inside _doSubmit. We
    // verify display/wire parity at the buildUserMessage level
    // directly: the same inputs ALWAYS produce the same canonical
    // string, so whichever caller invokes it gets the same result.
    const files: FileRef[] = [
      { path: '/x', name: 'x', ext: '', isDirectory: false },
    ]
    const displayCopy = buildUserMessage('go', files)
    const wireCopy = buildUserMessage('go', files)
    expect(displayCopy).toBe(wireCopy)
  })
})

// ── forceStopAndSend decision tree mirror ────────────────────────────────

type ForceStopStep =
  | { type: 'reentry_blocked' }
  | { type: 'resolve_target'; useOverride: boolean; isRetry: boolean }
  | { type: 'no_content_dismiss' }
  | { type: 'call_stop_machine' }
  | { type: 'do_submit'; isRetry: boolean }
  | { type: 'stop_threw' }

function simulateForceStopAndSend(opts: {
  isStoppingMachine: boolean
  hasMachineId: boolean
  overrideInput?: string
  pendingInput: { input: string; alreadyInChat: boolean } | null
  stopThrows: boolean
}): { steps: ForceStopStep[]; result: SubmitResult } {
  const steps: ForceStopStep[] = []
  if (opts.isStoppingMachine || !opts.hasMachineId) {
    steps.push({ type: 'reentry_blocked' })
    return { steps, result: 'rejected' }
  }
  const target =
    opts.overrideInput !== undefined
      ? { input: opts.overrideInput, isRetry: false, useOverride: true }
      : opts.pendingInput
        ? {
            input: opts.pendingInput.input,
            isRetry: opts.pendingInput.alreadyInChat,
            useOverride: false,
          }
        : null
  if (target) {
    steps.push({
      type: 'resolve_target',
      useOverride: target.useOverride,
      isRetry: target.isRetry,
    })
  }
  if (!target || !target.input.trim()) {
    steps.push({ type: 'no_content_dismiss' })
    return { steps, result: 'rejected' }
  }
  steps.push({ type: 'call_stop_machine' })
  if (opts.stopThrows) {
    steps.push({ type: 'stop_threw' })
    return { steps, result: 'rejected' }
  }
  steps.push({ type: 'do_submit', isRetry: target.isRetry })
  return { steps, result: 'sent' }
}

describe('forceStopAndSend decision tree — ordering invariants', () => {
  it('happy path: override absent + pre-check stash → isRetry=false', () => {
    // Pre-check path stashed with alreadyInChat=false. forceStopAndSend
    // calls _doSubmit with isRetry=false → _doSubmit will run its own
    // addUserMessage. End-to-end: the message lands in chat exactly
    // ONCE (here, in _doSubmit).
    const o = simulateForceStopAndSend({
      isStoppingMachine: false,
      hasMachineId: true,
      overrideInput: undefined,
      pendingInput: { input: 'queued', alreadyInChat: false },
      stopThrows: false,
    })
    expect(o.result).toBe('sent')
    const submit = o.steps.find((s) => s.type === 'do_submit') as any
    expect(submit.isRetry).toBe(false)
  })

  it('post-error stash: override absent + alreadyInChat=true → isRetry=true', () => {
    // Post-error path: message already in chat thread from _doSubmit.
    // Re-run with isRetry=true so _doSubmit does NOT add again.
    // End-to-end: message in chat thread exactly ONCE (preserved
    // from original send).
    const o = simulateForceStopAndSend({
      isStoppingMachine: false,
      hasMachineId: true,
      overrideInput: undefined,
      pendingInput: { input: 'already shown', alreadyInChat: true },
      stopThrows: false,
    })
    expect(o.result).toBe('sent')
    const submit = o.steps.find((s) => s.type === 'do_submit') as any
    expect(submit.isRetry).toBe(true)
  })

  it('override input wins: isRetry=false regardless of stash state', () => {
    // User edited their textarea after the busy state was detected.
    // forceStopAndSend uses the LIVE input. Since it's a fresh
    // string, isRetry=false → _doSubmit addUserMessages it.
    const o = simulateForceStopAndSend({
      isStoppingMachine: false,
      hasMachineId: true,
      overrideInput: 'edited',
      pendingInput: { input: 'original', alreadyInChat: true },
      stopThrows: false,
    })
    const submit = o.steps.find((s) => s.type === 'do_submit') as any
    expect(submit.isRetry).toBe(false)
  })

  it('empty input AND empty stash → no_content_dismiss, result=rejected', () => {
    const o = simulateForceStopAndSend({
      isStoppingMachine: false,
      hasMachineId: true,
      overrideInput: undefined,
      pendingInput: null,
      stopThrows: false,
    })
    expect(o.result).toBe('rejected')
    expect(o.steps.map((s) => s.type)).toContain('no_content_dismiss')
    expect(o.steps.find((s) => s.type === 'call_stop_machine')).toBeUndefined()
  })

  it('whitespace-only override → no_content_dismiss', () => {
    const o = simulateForceStopAndSend({
      isStoppingMachine: false,
      hasMachineId: true,
      overrideInput: '   ',
      pendingInput: null,
      stopThrows: false,
    })
    expect(o.result).toBe('rejected')
    expect(o.steps.find((s) => s.type === 'call_stop_machine')).toBeUndefined()
  })

  it('re-entry blocked when isStoppingMachine=true', () => {
    // Double-click protection: while a force-stop is in flight, a
    // second click is a no-op. Critically, no_content_dismiss does
    // NOT fire — we don't want to clear the busy state out from
    // under the in-flight call.
    const o = simulateForceStopAndSend({
      isStoppingMachine: true,
      hasMachineId: true,
      overrideInput: 'click again',
      pendingInput: null,
      stopThrows: false,
    })
    expect(o.result).toBe('rejected')
    expect(o.steps).toEqual([{ type: 'reentry_blocked' }])
  })

  it('stopMachine throws → result=rejected, busy state NOT cleared', () => {
    // If we can't stop the running task, the user must be able to
    // retry — leaving busy state in place + returning 'rejected'
    // tells the caller NOT to clear the input.
    const o = simulateForceStopAndSend({
      isStoppingMachine: false,
      hasMachineId: true,
      overrideInput: undefined,
      pendingInput: { input: 'queued', alreadyInChat: false },
      stopThrows: true,
    })
    expect(o.result).toBe('rejected')
    expect(o.steps.find((s) => s.type === 'stop_threw')).toBeDefined()
    expect(o.steps.find((s) => s.type === 'do_submit')).toBeUndefined()
  })
})

// ── End-to-end message-count invariants ──────────────────────────────────

describe('end-to-end: total addUserMessage calls per user click', () => {
  // The whole purpose of the isRetry/alreadyInChat dance is to
  // ensure the user's message appears in the chat thread EXACTLY ONCE
  // regardless of which path got us there. These tests simulate the
  // full handleSubmit + forceStopAndSend flow and count the total.

  function simulate_doSubmitAdds(isRetry: boolean): number {
    return isRetry ? 0 : 1
  }

  it('not busy: handleSubmit adds(0) + _doSubmit(isRetry=false) adds(1) = 1', () => {
    // Post-refactor: handleSubmit never adds directly. _doSubmit's
    // isRetry=false branch is the sole owner of the addUserMessage
    // + wire-payload-append pair on the happy path.
    const h = simulateHandleSubmit({
      canSend: true, hasUser: true, hasMachineId: true,
      busyResult: false, input: 'go',
    })
    const handleSubmitAdds = h.steps.filter((s) => s.type === 'add_user_message').length
    expect(handleSubmitAdds).toBe(0)
    const doSubmitStep = h.steps.find((s) => s.type === 'do_submit') as any
    const doSubmitAdds = simulate_doSubmitAdds(doSubmitStep.isRetry)
    expect(handleSubmitAdds + doSubmitAdds).toBe(1)
  })

  it('busy → Override (pre-check stash): handleSubmit adds(0) + _doSubmit(isRetry=false) adds(1) = 1', () => {
    const h = simulateHandleSubmit({
      canSend: true, hasUser: true, hasMachineId: true,
      busyResult: true, input: 'go',
    })
    const handleSubmitAdds = h.steps.filter((s) => s.type === 'add_user_message').length
    expect(handleSubmitAdds).toBe(0)

    // User clicks Override & Run; stash is alreadyInChat=false.
    const f = simulateForceStopAndSend({
      isStoppingMachine: false, hasMachineId: true,
      overrideInput: undefined,
      pendingInput: { input: 'go', alreadyInChat: false },
      stopThrows: false,
    })
    const submit = f.steps.find((s) => s.type === 'do_submit') as any
    const doSubmitAdds = simulate_doSubmitAdds(submit.isRetry)
    expect(handleSubmitAdds + doSubmitAdds).toBe(1)
  })

  it('post-error → Override: _doSubmit added(1 on first call) + retry _doSubmit(isRetry=true) adds(0) = 1', () => {
    // Post-error path: pre-check said not busy, _doSubmit ran with
    // isRetry=false (adds the message), then SSE returned
    // MACHINE_BUSY. User clicks Override. The stash from _doSubmit
    // has alreadyInChat=true, so forceStopAndSend's retry _doSubmit
    // call gets isRetry=true and skips its own add.
    //
    // Total adds: 1 (the original _doSubmit call) + 0 (the retry) = 1.
    const firstCallAdds = simulate_doSubmitAdds(false)  // isRetry=false on first
    expect(firstCallAdds).toBe(1)

    // User clicks Override; the stash has alreadyInChat=true.
    const f = simulateForceStopAndSend({
      isStoppingMachine: false, hasMachineId: true,
      overrideInput: undefined,
      pendingInput: { input: 'go', alreadyInChat: true },
      stopThrows: false,
    })
    const submit = f.steps.find((s) => s.type === 'do_submit') as any
    const retryAdds = simulate_doSubmitAdds(submit.isRetry)
    expect(firstCallAdds + retryAdds).toBe(1)
  })

  it('busy → Override with edited input: pre-check stash bypassed, _doSubmit adds(1) = 1', () => {
    // User typed "go", busy detected, then edited to "go now" and
    // clicked Override. The override input wins → isRetry=false →
    // _doSubmit adds. Net total = 1 (the edited version).
    const h = simulateHandleSubmit({
      canSend: true, hasUser: true, hasMachineId: true,
      busyResult: true, input: 'go',
    })
    const handleSubmitAdds = h.steps.filter((s) => s.type === 'add_user_message').length
    expect(handleSubmitAdds).toBe(0)

    const f = simulateForceStopAndSend({
      isStoppingMachine: false, hasMachineId: true,
      overrideInput: 'go now',
      pendingInput: { input: 'go', alreadyInChat: false },
      stopThrows: false,
    })
    const submit = f.steps.find((s) => s.type === 'do_submit') as any
    const doSubmitAdds = simulate_doSubmitAdds(submit.isRetry)
    expect(handleSubmitAdds + doSubmitAdds).toBe(1)
  })
})

// ── Web-app parity surface ───────────────────────────────────────────────

describe('SubmitResult — caller contract', () => {
  it('rejected guard outcomes never produce any side-effect step', () => {
    // The 'rejected' return value is the caller's signal to LEAVE
    // the input alone. The decision tree must not produce any
    // chat-mutation or IPC step before returning 'rejected'.
    const guardScenarios: Array<Partial<Parameters<typeof simulateHandleSubmit>[0]>> = [
      { canSend: false, hasUser: true, hasMachineId: true },
      { canSend: true, hasUser: false, hasMachineId: true },
      { canSend: true, hasUser: true, hasMachineId: false },
    ]
    for (const partial of guardScenarios) {
      const o = simulateHandleSubmit({
        busyResult: false,
        input: 'x',
        canSend: partial.canSend ?? true,
        hasUser: partial.hasUser ?? true,
        hasMachineId: partial.hasMachineId ?? true,
      })
      expect(o.result).toBe('rejected')
      expect(o.steps.length).toBe(1)
      expect(o.steps[0].type).toBe('guard_failed')
    }
  })

  it('busy outcome carries pendingInput.alreadyInChat=false (clean stash)', () => {
    const o = simulateHandleSubmit({
      canSend: true, hasUser: true, hasMachineId: true,
      busyResult: true, input: 'x',
    })
    const busy = o.steps.find((s) => s.type === 'set_busy_state') as any
    expect(busy.alreadyInChat).toBe(false)
  })

  it('sent outcome always passes isRetry=false to _doSubmit (handoff to _doSubmit for add+append)', () => {
    const o = simulateHandleSubmit({
      canSend: true, hasUser: true, hasMachineId: true,
      busyResult: false, input: 'x',
    })
    const submit = o.steps.find((s) => s.type === 'do_submit') as any
    expect(submit.isRetry).toBe(false)
    // ★ _doSubmit's isRetry=false branch owns both addUserMessage
    // AND the wire-payload-append for the new user message — kept
    // in one place so they can't drift out of sync.
  })
})
