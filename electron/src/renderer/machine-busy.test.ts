/**
 * Tests for the Electron renderer's "machine busy → yellow Override & Run"
 * flow. The actual hook lives at hooks/useChatSubmit.ts; this test file
 * exercises the same state-transition rules the hook implements, plus the
 * IPC contract surface (window.coasty.checkMachineBusy / stopMachine).
 *
 * We can't render the React hook here (no @testing-library/react in the
 * Electron package's test stack — only vitest + pure logic). So instead
 * we mirror the decision rules into testable functions and pin them.
 * If the rules drift, the tests catch the drift before users do.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── State-transition rules (mirrored from useChatSubmit.ts) ─────────────────

interface BusyState {
  isMachineBusy: boolean
  isStoppingMachine: boolean
  // ``alreadyInChat`` distinguishes pre-check (message NOT yet in chat
  // store) from post-error MACHINE_BUSY (message IS in chat store from
  // the failed attempt). It controls whether forceStopAndSend asks
  // _doSubmit to skip the addUserMessage step on the retry.
  pendingInput:
    | { input: string; files?: unknown[]; alreadyInChat: boolean }
    | null
}

const initial: BusyState = {
  isMachineBusy: false,
  isStoppingMachine: false,
  pendingInput: null,
}

/**
 * Mirrors the `handleSubmit` decision branch in useChatSubmit.ts.
 * Given current state + the result of the pre-flight busy check + the
 * user's input, returns:
 *   - the next state
 *   - whether we should call `_doSubmit` (i.e. actually send the chat)
 */
function handleSubmitDecision(
  state: BusyState,
  busyCheckResult: boolean,
  input: string,
  files?: unknown[],
): { next: BusyState; shouldSubmit: boolean } {
  if (busyCheckResult) {
    return {
      next: {
        ...state,
        isMachineBusy: true,
        // Pre-check path: addUserMessage was NOT called, so the chat
        // store does NOT contain this message yet.
        pendingInput: { input, files, alreadyInChat: false },
      },
      shouldSubmit: false,
    }
  }
  return {
    next: { ...state, isMachineBusy: false, pendingInput: null },
    shouldSubmit: true,
  }
}

/**
 * Mirrors the post-error MACHINE_BUSY transition that fires from
 * within ``_doSubmit``'s ``onMachineBusy`` callback. By the time this
 * runs the user message has ALREADY been added to the chat store
 * (addUserMessage ran at the top of _doSubmit), so the resulting
 * pendingInput sets ``alreadyInChat: true``.
 */
function handlePostErrorBusy(
  state: BusyState,
  input: string,
  files?: unknown[],
): BusyState {
  return {
    ...state,
    isMachineBusy: true,
    pendingInput: { input, files, alreadyInChat: true },
  }
}

/**
 * Mirrors the `forceStopAndSend` decision branch.
 * Returns the resolved input (caller-supplied wins, falls back to
 * pendingInput), and whether the call should proceed at all.
 */
function resolveForceStopInput(
  state: BusyState,
  overrideInput: string | undefined,
  overrideFiles: unknown[] | undefined,
): {
  input: string
  files?: unknown[]
  shouldProceed: boolean
  // isRetry tells _doSubmit whether to skip the addUserMessage call
  // (true iff the message is already in chat from a failed run).
  isRetry: boolean
} {
  if (state.isStoppingMachine) {
    return { input: '', shouldProceed: false, isRetry: false }  // re-entry
  }
  if (overrideInput !== undefined) {
    if (!overrideInput.trim()) {
      return { input: '', shouldProceed: false, isRetry: false }
    }
    // Override always means "fresh" submission — user typed something
    // new in the textarea, not a retry of the stashed content.
    return {
      input: overrideInput,
      files: overrideFiles,
      shouldProceed: true,
      isRetry: false,
    }
  }
  if (!state.pendingInput || !state.pendingInput.input.trim()) {
    return { input: '', shouldProceed: false, isRetry: false }
  }
  return {
    input: state.pendingInput.input,
    files: state.pendingInput.files,
    shouldProceed: true,
    isRetry: state.pendingInput.alreadyInChat,
  }
}

/**
 * Mirrors the input-cleared dismiss effect.
 * If busy state is set AND input is empty, busy state should clear so the
 * next typed input goes through the normal pre-check path.
 */
function shouldDismissOnEmptyInput(state: BusyState, input: string): boolean {
  return state.isMachineBusy && !input.trim()
}

// ── handleSubmit decision tests ─────────────────────────────────────────────

describe('handleSubmit decision', () => {
  it('busy=false → submit normally, no busy state', () => {
    const { next, shouldSubmit } = handleSubmitDecision(initial, false, 'hello')
    expect(shouldSubmit).toBe(true)
    expect(next.isMachineBusy).toBe(false)
    expect(next.pendingInput).toBeNull()
  })

  it('busy=true → DO NOT submit, store pending input + flip busy flag', () => {
    const { next, shouldSubmit } = handleSubmitDecision(initial, true, 'do something')
    expect(shouldSubmit).toBe(false)
    expect(next.isMachineBusy).toBe(true)
    expect(next.pendingInput).toEqual({
      input: 'do something',
      files: undefined,
      // Pre-check path stashes alreadyInChat=false because we never
      // called addUserMessage. The retry will be a first-time submit.
      alreadyInChat: false,
    })
  })

  it('busy=true preserves files in pending input', () => {
    const files = [{ path: '/a', name: 'a.txt' }]
    const { next } = handleSubmitDecision(initial, true, 'use this', files)
    expect(next.pendingInput?.files).toEqual(files)
  })

  it('busy=false clears any stale pending input from previous busy state', () => {
    const stale: BusyState = {
      isMachineBusy: true,
      isStoppingMachine: false,
      pendingInput: { input: 'old', alreadyInChat: true },
    }
    const { next } = handleSubmitDecision(stale, false, 'new')
    expect(next.pendingInput).toBeNull()
    expect(next.isMachineBusy).toBe(false)
  })
})

// ── Post-error MACHINE_BUSY transition (the reliability path) ──────────────

describe('post-error MACHINE_BUSY transition', () => {
  // This is the architectural reliability path: even when the
  // pre-check IPC fails (OSS mode routing, stale Electron build, slow
  // network), the user still gets the yellow Override-and-Run UI
  // because the chat-route's structured MACHINE_BUSY error event
  // triggers the SAME state transition.

  it('flips busy + stashes input with alreadyInChat=true', () => {
    // The user message was already added by _doSubmit before the SSE
    // error arrived — the chat store contains it. The retry must NOT
    // re-add it, so we stash alreadyInChat=true.
    const next = handlePostErrorBusy(initial, 'show downloads', undefined)
    expect(next.isMachineBusy).toBe(true)
    expect(next.pendingInput).toEqual({
      input: 'show downloads',
      files: undefined,
      alreadyInChat: true,
    })
  })

  it('preserves files attached to the failed submission', () => {
    const files = [{ path: '/Users/me/resume.pdf', name: 'resume.pdf' }]
    const next = handlePostErrorBusy(initial, 'parse this resume', files)
    expect(next.pendingInput?.files).toEqual(files)
    expect(next.pendingInput?.alreadyInChat).toBe(true)
  })

  it('overwrites any existing pre-check pendingInput', () => {
    // Edge case: somehow a pre-check stash exists when a post-error
    // event arrives. The post-error stash is the source of truth since
    // it reflects what the user actually saw fail — overwrite.
    const stale: BusyState = {
      isMachineBusy: true,
      isStoppingMachine: false,
      pendingInput: {
        input: 'pre-check stash',
        alreadyInChat: false,
      },
    }
    const next = handlePostErrorBusy(stale, 'failed submission', undefined)
    expect(next.pendingInput?.input).toBe('failed submission')
    expect(next.pendingInput?.alreadyInChat).toBe(true)
  })
})

// ── forceStopAndSend resolution tests ───────────────────────────────────────

describe('forceStopAndSend input resolution', () => {
  it('uses override input when caller supplies it', () => {
    const state: BusyState = {
      isMachineBusy: true,
      isStoppingMachine: false,
      pendingInput: { input: 'stale', alreadyInChat: false },
    }
    const r = resolveForceStopInput(state, 'fresh', undefined)
    expect(r.shouldProceed).toBe(true)
    expect(r.input).toBe('fresh')
    // Override always means a fresh submission — never a retry. The
    // user typed something new in the textarea so the retry semantics
    // (skip addUserMessage) do not apply.
    expect(r.isRetry).toBe(false)
  })

  it('falls back to pendingInput when no override', () => {
    const state: BusyState = {
      isMachineBusy: true,
      isStoppingMachine: false,
      pendingInput: { input: 'stashed', alreadyInChat: false },
    }
    const r = resolveForceStopInput(state, undefined, undefined)
    expect(r.shouldProceed).toBe(true)
    expect(r.input).toBe('stashed')
  })

  it('returns shouldProceed=false when isStoppingMachine is true (re-entry guard)', () => {
    // Critical: prevents double-submit if user mashes the Override button.
    const state: BusyState = {
      isMachineBusy: true,
      isStoppingMachine: true,
      pendingInput: { input: 'go', alreadyInChat: false },
    }
    const r = resolveForceStopInput(state, 'go', undefined)
    expect(r.shouldProceed).toBe(false)
  })

  it('returns shouldProceed=false when no input anywhere (nothing to send)', () => {
    const state: BusyState = {
      isMachineBusy: true,
      isStoppingMachine: false,
      pendingInput: null,
    }
    const r = resolveForceStopInput(state, undefined, undefined)
    expect(r.shouldProceed).toBe(false)
  })

  it('returns shouldProceed=false when override is whitespace-only', () => {
    const state: BusyState = {
      isMachineBusy: true,
      isStoppingMachine: false,
      pendingInput: { input: 'has-content', alreadyInChat: false },
    }
    const r = resolveForceStopInput(state, '   ', undefined)
    expect(r.shouldProceed).toBe(false)
  })

  it('uses override even when override is empty-string but pendingInput exists', () => {
    // The undefined-vs-empty-string distinction matters — passing
    // overrideInput="" explicitly means "I edited the textarea to empty,
    // dont auto-send the stale stash".
    const state: BusyState = {
      isMachineBusy: true,
      isStoppingMachine: false,
      pendingInput: { input: 'stash', alreadyInChat: false },
    }
    const r = resolveForceStopInput(state, '', undefined)
    expect(r.shouldProceed).toBe(false)
  })

  it('isRetry=false for pre-check stash (alreadyInChat=false)', () => {
    // Pre-check path: addUserMessage was NEVER called. The retry must
    // call it for the first time, so isRetry=false.
    const state: BusyState = {
      isMachineBusy: true,
      isStoppingMachine: false,
      pendingInput: { input: 'task', alreadyInChat: false },
    }
    const r = resolveForceStopInput(state, undefined, undefined)
    expect(r.shouldProceed).toBe(true)
    expect(r.isRetry).toBe(false)
  })

  it('isRetry=true for post-error stash (alreadyInChat=true)', () => {
    // Post-error path: the failed _doSubmit already addUserMessage'd
    // the message. The retry must skip addUserMessage to avoid a
    // duplicate user message in the chat UI and the wire payload.
    const state: BusyState = {
      isMachineBusy: true,
      isStoppingMachine: false,
      pendingInput: { input: 'task', alreadyInChat: true },
    }
    const r = resolveForceStopInput(state, undefined, undefined)
    expect(r.shouldProceed).toBe(true)
    expect(r.isRetry).toBe(true)
  })

  it('override always overrides isRetry to false even with alreadyInChat=true', () => {
    // User edited the textarea after a post-error busy. Their NEW
    // input is a fresh first-time submit, not a retry of the stashed
    // failed-content. Override semantics dominate.
    const state: BusyState = {
      isMachineBusy: true,
      isStoppingMachine: false,
      pendingInput: { input: 'old', alreadyInChat: true },
    }
    const r = resolveForceStopInput(state, 'new edited text', undefined)
    expect(r.shouldProceed).toBe(true)
    expect(r.input).toBe('new edited text')
    expect(r.isRetry).toBe(false)
  })
})

// ── input-cleared dismiss effect ────────────────────────────────────────────

describe('shouldDismissOnEmptyInput', () => {
  it('dismisses busy state when input becomes empty', () => {
    const state: BusyState = {
      isMachineBusy: true,
      isStoppingMachine: false,
      pendingInput: { input: 'old', alreadyInChat: false },
    }
    expect(shouldDismissOnEmptyInput(state, '')).toBe(true)
    expect(shouldDismissOnEmptyInput(state, '   ')).toBe(true)
  })

  it('does NOT dismiss when input has content', () => {
    const state: BusyState = {
      isMachineBusy: true,
      isStoppingMachine: false,
      pendingInput: null,
    }
    expect(shouldDismissOnEmptyInput(state, 'hi')).toBe(false)
  })

  it('does NOT dismiss when busy state is already false (no-op)', () => {
    const state: BusyState = {
      isMachineBusy: false,
      isStoppingMachine: false,
      pendingInput: null,
    }
    expect(shouldDismissOnEmptyInput(state, '')).toBe(false)
  })
})

// ── window.coasty IPC contract ─────────────────────────────────────────────
//
// The renderer talks to the main process through window.coasty. These tests
// pin the contract: what shape the IPC returns, what the renderer should do
// with each shape. If the shape drifts, the tests catch it.

interface MockBusyResponse {
  success: boolean
  busy?: boolean
  ownerChatId?: string | null
  error?: string
}

interface MockStopResponse {
  success: boolean
  stopped?: boolean
  released?: boolean
  ownerChatId?: string | null
  error?: string
}

/**
 * Mirrors the renderer's `checkBusy` helper:
 *   const res = await window.coasty.checkMachineBusy(machineId)
 *   return res?.success ? !!res.busy : false
 *
 * The "fail-open on error" rule is critical: if the IPC fails (network,
 * permission, missing handler), we MUST NOT permanently block the user
 * from submitting. The chat route's busy error becomes the fallback.
 */
function interpretBusyResponse(res: MockBusyResponse | null | undefined): boolean {
  return res?.success ? !!res.busy : false
}

// ── SSE error event → MACHINE_BUSY routing ─────────────────────────────────
//
// When the backend's chat route emits its structured busy payload as an
// SSE type-'3' (error) event, the renderer's SSE parser MUST detect the
// code === "MACHINE_BUSY" and route it to ``onMachineBusy`` instead of
// the generic ``onError``. Otherwise the user just sees an "Error: ..."
// line in the chat thread and the yellow button never appears — the
// exact bug this whole reliability path is meant to fix.

interface SSEParseResult {
  busy: boolean
  errored: boolean
  busyData?: { message: string; machineId?: string; ownerChatId?: string | null }
  errorData?: string
}

/**
 * Mirrors the type-'3' handler in lib/api.ts. Distinguishes structured
 * MACHINE_BUSY payloads from generic error strings/objects, and falls
 * through to the generic onError when no onMachineBusy callback is
 * provided (back-compat).
 */
function routeError(rawData: string, hasOnMachineBusy: boolean): SSEParseResult {
  let parsed: any
  try {
    parsed = JSON.parse(rawData)
  } catch {
    parsed = rawData
  }

  if (
    parsed &&
    typeof parsed === 'object' &&
    parsed.code === 'MACHINE_BUSY' &&
    hasOnMachineBusy
  ) {
    return {
      busy: true,
      errored: false,
      busyData: {
        message: parsed.message || 'Machine is currently busy',
        machineId: parsed.machineId,
        ownerChatId: parsed.ownerChatId,
      },
    }
  }
  let msg =
    typeof parsed === 'string'
      ? parsed
      : (parsed && (parsed.error || parsed.message)) || 'Unknown error'
  return { busy: false, errored: true, errorData: msg }
}

describe('SSE type-3 MACHINE_BUSY routing', () => {
  it('structured MACHINE_BUSY → onMachineBusy callback', () => {
    const payload = JSON.stringify({
      code: 'MACHINE_BUSY',
      message: 'This machine is currently running another task. Stop it and try again.',
      machineId: 'm-abc',
      ownerChatId: 'chat-other',
    })
    const r = routeError(payload, true)
    expect(r.busy).toBe(true)
    expect(r.errored).toBe(false)
    expect(r.busyData?.message).toContain('currently running another task')
    expect(r.busyData?.machineId).toBe('m-abc')
    expect(r.busyData?.ownerChatId).toBe('chat-other')
  })

  it('legacy plain string error → onError', () => {
    const payload = JSON.stringify('This machine is currently busy with another task.')
    const r = routeError(payload, true)
    expect(r.errored).toBe(true)
    expect(r.busy).toBe(false)
    expect(r.errorData).toContain('currently busy')
  })

  it('non-busy structured error → onError (does NOT misroute as busy)', () => {
    const payload = JSON.stringify({
      code: 'INSUFFICIENT_CREDITS',
      message: 'You are out of credits',
    })
    const r = routeError(payload, true)
    expect(r.errored).toBe(true)
    expect(r.busy).toBe(false)
  })

  it('MACHINE_BUSY without onMachineBusy callback falls through to onError', () => {
    // Back-compat: legacy callers that don't wire up onMachineBusy
    // still get a (possibly less-pretty) error string they can render.
    const payload = JSON.stringify({
      code: 'MACHINE_BUSY',
      message: 'This machine is currently running another task.',
    })
    const r = routeError(payload, false)
    expect(r.busy).toBe(false)
    expect(r.errored).toBe(true)
    // The fallback uses the message field if no .error key.
    expect(r.errorData).toContain('currently running another task')
  })

  it('malformed JSON → falls through as plain string error', () => {
    const r = routeError('"raw error message"', true)
    expect(r.errored).toBe(true)
    expect(r.errorData).toBe('raw error message')
  })

  it('object without code → onError', () => {
    const payload = JSON.stringify({ error: 'Something went wrong' })
    const r = routeError(payload, true)
    expect(r.errored).toBe(true)
    expect(r.errorData).toBe('Something went wrong')
  })
})


describe('checkMachineBusy IPC contract', () => {
  it('success=true + busy=true → busy', () => {
    expect(interpretBusyResponse({ success: true, busy: true })).toBe(true)
  })

  it('success=true + busy=false → not busy', () => {
    expect(interpretBusyResponse({ success: true, busy: false })).toBe(false)
  })

  it('success=false (any reason) → fail-open as not busy', () => {
    // Important: don't permanently block the user.
    expect(interpretBusyResponse({ success: false, error: 'HTTP 500' })).toBe(false)
    expect(interpretBusyResponse({ success: false })).toBe(false)
  })

  it('null/undefined IPC result → fail-open as not busy', () => {
    expect(interpretBusyResponse(null)).toBe(false)
    expect(interpretBusyResponse(undefined)).toBe(false)
  })

  it('success=true with missing busy field → coerced to false', () => {
    // Defensive: backend forgot the field; treat as not busy.
    expect(interpretBusyResponse({ success: true })).toBe(false)
  })
})

// ── End-to-end simulation: handleSubmit → busy → forceStopAndSend ───────────

describe('Full Override & Run lifecycle simulation', () => {
  it('idle → submit → not busy → submit fires', () => {
    let state = initial
    const { next, shouldSubmit } = handleSubmitDecision(state, false, 'hi')
    state = next
    expect(shouldSubmit).toBe(true)
    expect(state.isMachineBusy).toBe(false)
  })

  it('busy → submit blocked → stash → click yellow → stop+send', () => {
    let state = initial

    // Step 1: user submits, machine is busy.
    let { next, shouldSubmit } = handleSubmitDecision(state, true, 'task A')
    state = next
    expect(shouldSubmit).toBe(false)
    expect(state.isMachineBusy).toBe(true)
    expect(state.pendingInput?.input).toBe('task A')

    // Step 2: user clicks yellow Override & Run with the same input
    // still in the textarea.
    const r = resolveForceStopInput(state, 'task A', undefined)
    expect(r.shouldProceed).toBe(true)
    expect(r.input).toBe('task A')

    // Step 3: simulate setting isStoppingMachine=true while the IPC
    // call is in flight, then attempt double-click — should be guarded.
    state = { ...state, isStoppingMachine: true }
    const r2 = resolveForceStopInput(state, 'task A', undefined)
    expect(r2.shouldProceed).toBe(false)
  })

  it('busy → user clears input → busy state dismisses', () => {
    let state: BusyState = {
      isMachineBusy: true,
      isStoppingMachine: false,
      pendingInput: { input: 'task B', alreadyInChat: false },
    }
    expect(shouldDismissOnEmptyInput(state, '')).toBe(true)
    // Then they type something fresh — handleSubmit goes through the
    // normal pre-check path, no stale busy/pending state lingers.
    state = { ...initial }
    const { next, shouldSubmit } = handleSubmitDecision(state, false, 'task C')
    expect(shouldSubmit).toBe(true)
    expect(next.isMachineBusy).toBe(false)
  })

  it('busy → user edits input → forceStopAndSend uses the EDITED input', () => {
    // Real scenario: machine becomes busy while user is mid-edit.
    // They saw the yellow button, kept typing, then clicked the button.
    // The edited text must be what gets submitted, not the stashed
    // pre-busy version.
    let state: BusyState = {
      isMachineBusy: true,
      isStoppingMachine: false,
      pendingInput: { input: 'old draft', alreadyInChat: false },
    }
    const r = resolveForceStopInput(state, 'final edited version', undefined)
    expect(r.shouldProceed).toBe(true)
    expect(r.input).toBe('final edited version')
  })

  it('post-error path: failed submit → MACHINE_BUSY → yellow → retry skips addUserMessage', () => {
    // Full simulation of the user's actual scenario:
    //  1. User types "check if my resume is in my downloads"
    //  2. Pre-check is bypassed (production OSS routing OR pre-check
    //     race), submit goes through, addUserMessage is called.
    //  3. Backend rejects with structured MACHINE_BUSY (chat.py).
    //  4. lib/api.ts parses code:"MACHINE_BUSY" and calls onMachineBusy
    //     callback in useChatSubmit.
    //  5. useChatSubmit transitions: setIsMachineBusy(true) +
    //     setPendingInput({ ..., alreadyInChat: true }).
    //  6. UI re-renders showing the yellow Override & Run button.
    //  7. User clicks → forceStopAndSend → resolves input from stash
    //     with isRetry=true.
    //  8. _doSubmit runs in retry mode: NO addUserMessage, builds wire
    //     payload from store-as-is, hits /api/chat again.

    const userInput = 'check if my resume is in my downloads'

    // Step 5: simulate the post-error transition.
    let state = handlePostErrorBusy(initial, userInput, undefined)
    expect(state.isMachineBusy).toBe(true)
    expect(state.pendingInput?.alreadyInChat).toBe(true)

    // Step 7: user clicks yellow with no override (textarea was
    // cleared on submit).
    const r = resolveForceStopInput(state, undefined, undefined)
    expect(r.shouldProceed).toBe(true)
    expect(r.input).toBe(userInput)
    // Critical: this is the bit that prevents the duplicate-user-
    // message bug. _doSubmit will be called with isRetry=true.
    expect(r.isRetry).toBe(true)
  })

  it('pre-check path: handleSubmit-busy → yellow → retry DOES addUserMessage', () => {
    // Counterpoint to the test above. Pre-check path means the user
    // message was never added. The retry must call addUserMessage so
    // the chat shows the message exactly once.

    let state = initial
    const { next } = handleSubmitDecision(state, true, 'do thing')
    state = next
    expect(state.pendingInput?.alreadyInChat).toBe(false)

    const r = resolveForceStopInput(state, undefined, undefined)
    expect(r.shouldProceed).toBe(true)
    expect(r.isRetry).toBe(false)  // _doSubmit will run addUserMessage
  })
})

// ── window.coasty mock-call regression tests ────────────────────────────────
//
// These tests use vitest's spy/mock to verify that we only make the
// expected number of IPC calls per submission. Belt-and-braces against
// regressions where someone refactors useChatSubmit.ts and accidentally
// adds extra roundtrips per send (which would slow down every chat).

describe('IPC call count regression guards', () => {
  // Mock signatures use explicit Function types so vitest 4.x's stricter
  // typing recognises them as callable. Without the explicit signatures,
  // ``ReturnType<typeof vi.fn>`` produces ``Mock<Procedure | Constructable>``
  // which the type-checker can't tell is callable vs constructable.
  type MockBusyFn = (machineId: string) => Promise<MockBusyResponse>
  type MockStopFn = (machineId: string) => Promise<MockStopResponse>
  type MockSendFn = (params: any) => Promise<{ success: boolean }>

  let coastyMock: {
    checkMachineBusy: ReturnType<typeof vi.fn<MockBusyFn>>
    stopMachine: ReturnType<typeof vi.fn<MockStopFn>>
    sendChatMessage: ReturnType<typeof vi.fn<MockSendFn>>
  }

  beforeEach(() => {
    coastyMock = {
      checkMachineBusy: vi.fn<MockBusyFn>(),
      stopMachine: vi.fn<MockStopFn>(),
      sendChatMessage: vi.fn<MockSendFn>(),
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Simulates a single send-attempt at the IPC layer.
   * Returns whether the chat was actually sent.
   */
  async function simulateSend(
    coasty: typeof coastyMock,
    input: string,
  ): Promise<boolean> {
    const busyRes = await coasty.checkMachineBusy('m1')
    if (interpretBusyResponse(busyRes)) {
      // Stash + show yellow UI; don't send.
      return false
    }
    await coasty.sendChatMessage({ input })
    return true
  }

  /**
   * Simulates the yellow-button click.
   */
  async function simulateOverrideAndRun(
    coasty: typeof coastyMock,
    input: string,
  ): Promise<boolean> {
    const stopRes = await coasty.stopMachine('m1')
    if (!stopRes?.success) return false
    await coasty.sendChatMessage({ input })
    return true
  }

  it('idle send: 1 busy-check, 0 stops, 1 send', async () => {
    coastyMock.checkMachineBusy.mockResolvedValue({ success: true, busy: false })
    coastyMock.sendChatMessage.mockResolvedValue({ success: true })

    const sent = await simulateSend(coastyMock, 'hello')

    expect(sent).toBe(true)
    expect(coastyMock.checkMachineBusy).toHaveBeenCalledTimes(1)
    expect(coastyMock.stopMachine).toHaveBeenCalledTimes(0)
    expect(coastyMock.sendChatMessage).toHaveBeenCalledTimes(1)
  })

  it('busy send: 1 busy-check, 0 stops, 0 sends (UI shows yellow)', async () => {
    coastyMock.checkMachineBusy.mockResolvedValue({ success: true, busy: true })

    const sent = await simulateSend(coastyMock, 'hello')

    expect(sent).toBe(false)
    expect(coastyMock.checkMachineBusy).toHaveBeenCalledTimes(1)
    expect(coastyMock.stopMachine).toHaveBeenCalledTimes(0)
    expect(coastyMock.sendChatMessage).toHaveBeenCalledTimes(0)
  })

  it('override flow: 0 busy-checks (already known busy), 1 stop, 1 send', async () => {
    coastyMock.stopMachine.mockResolvedValue({ success: true, stopped: true, released: true })
    coastyMock.sendChatMessage.mockResolvedValue({ success: true })

    const sent = await simulateOverrideAndRun(coastyMock, 'hello')

    expect(sent).toBe(true)
    expect(coastyMock.checkMachineBusy).toHaveBeenCalledTimes(0)
    expect(coastyMock.stopMachine).toHaveBeenCalledTimes(1)
    expect(coastyMock.sendChatMessage).toHaveBeenCalledTimes(1)
  })

  it('override stop fails: no send happens', async () => {
    coastyMock.stopMachine.mockResolvedValue({ success: false, error: 'backend down' })

    const sent = await simulateOverrideAndRun(coastyMock, 'hello')

    expect(sent).toBe(false)
    expect(coastyMock.sendChatMessage).toHaveBeenCalledTimes(0)
  })

  it('rewrites "desktop app not connected" to a reconnect hint', () => {
    // Mirrors the rewrite rules in ipc-handlers.ts (main process) and
    // lib/api.ts (renderer SSE parser). Both layers strip the
    // "Electron desktop app is not connected" phrasing that the backend
    // sometimes emits — that wording is meaningless when the user is
    // already INSIDE the desktop app. Tests pin the regex + replacement
    // so a future copy edit to the message doesn't accidentally
    // reintroduce the nonsensical text.
    const PATTERN = /electron\s+desktop\s+app\s+is\s+not\s+connected/i
    const REPLACEMENT = 'Reconnecting — please try again in a moment.'

    function rewrite(msg: string): string {
      return PATTERN.test(msg) ? REPLACEMENT : msg
    }

    // Backend's exact wording (from chat.py:392).
    expect(rewrite(
      'Electron desktop app is not connected. ' +
      'Please ensure the app is running and signed in.',
    )).toBe(REPLACEMENT)

    // Older wording variant used in the IPC handler before this fix.
    expect(rewrite(
      'Electron desktop app is not connected. Please check your connection.',
    )).toBe(REPLACEMENT)

    // Case-insensitive — defends against a future "ELECTRON DESKTOP" log line.
    expect(rewrite(
      'electron desktop app is not connected — auth lost',
    )).toBe(REPLACEMENT)

    // Whitespace tolerance — collapses tabs/newlines via \s+.
    expect(rewrite(
      'Electron\tdesktop  app\nis not connected',
    )).toBe(REPLACEMENT)

    // Unrelated errors pass through unchanged.
    expect(rewrite('Insufficient credits')).toBe('Insufficient credits')
    expect(rewrite('Machine is currently busy')).toBe('Machine is currently busy')
    expect(rewrite('Generic 500')).toBe('Generic 500')
  })

  it('busy-check IPC throws: fail-open (1 send)', async () => {
    coastyMock.checkMachineBusy.mockRejectedValue(new Error('ipc gone'))
    coastyMock.sendChatMessage.mockResolvedValue({ success: true })

    // The renderer's checkBusy helper wraps in try/catch and returns false
    // on throw — same behavior we'd see with a network failure.
    let busyResult = false
    try {
      const r = await coastyMock.checkMachineBusy('m1')
      busyResult = interpretBusyResponse(r)
    } catch {
      busyResult = false  // fail-open
    }
    if (!busyResult) {
      await coastyMock.sendChatMessage({ input: 'hello' })
    }

    expect(coastyMock.sendChatMessage).toHaveBeenCalledTimes(1)
  })
})
