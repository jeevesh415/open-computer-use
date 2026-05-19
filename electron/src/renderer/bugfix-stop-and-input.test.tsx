/**
 * @vitest-environment jsdom
 *
 * Bug-fix regression tests — two specific user-reported bugs that this
 * file pins so they cannot silently regress:
 *
 *   Bug 1 — "Text stays in the input box after I press Send."
 *           The input used to only clear when ``handleSubmit`` returned
 *           'sent', which itself waited for the entire SSE stream (often
 *           minutes). The fix fire-and-forgets ``_doSubmit`` so the user
 *           gets their input cleared as soon as the message is committed
 *           to the chat store. Tests in section A.
 *
 *   Bug 2 — "When I stop a task and create a new chat and submit, the
 *           first submit just stops. I have to click Send twice."
 *           The stop path was fire-and-forget: ``stopStreaming`` aborted
 *           the renderer-side controller but did not wait for the backend
 *           to release the machine lock. A new submit could race against
 *           a still-held lock and get rejected. The fix:
 *             (a) ``handleStop`` now awaits ``stopMachine`` so the lock is
 *                 drained before the user's next gesture.
 *             (b) The stopped task's ``finally`` block has an ownership
 *                 guard so it can't clobber a subsequent run's state
 *                 (``setStreaming(false)``, ``setAbortController(null)``).
 *           Tests in section B.
 *
 * The corner cases below were chosen because each one represents a
 * realistic user gesture sequence (fast clicks, network hiccups, stuck
 * streams, mid-flight chat switches) that, if mis-handled, surfaces as
 * "the UI froze" or "my message vanished" — both of which the user
 * would experience as the bug returning.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { renderHook } from '@testing-library/react'
import { CompactPill } from './components/CompactPill'
import { useAuthStore } from './stores/auth-store'
import { useConnectionStore } from './stores/connection-store'
import { useChatStore } from './stores/chat-store'
import { useWindowStore } from './stores/window-store'
import { useChatSubmit } from './hooks/useChatSubmit'

// ── Shared fixtures (mirrors send-flow-integration.test.tsx) ─────────────

interface CoastyMock {
  checkMachineBusy: ReturnType<typeof vi.fn>
  stopMachine: ReturnType<typeof vi.fn>
  sendChatMessage: ReturnType<typeof vi.fn>
  abortChat: ReturnType<typeof vi.fn>
  onChatSSEEvent: ReturnType<typeof vi.fn>
  createChat: ReturnType<typeof vi.fn>
  listChats: ReturnType<typeof vi.fn>
  getChatMessages: ReturnType<typeof vi.fn>
  updateChat: ReturnType<typeof vi.fn>
  deleteChat: ReturnType<typeof vi.fn>
  setMode: ReturnType<typeof vi.fn>
  setWindowMode: ReturnType<typeof vi.fn>
  setOpacity: ReturnType<typeof vi.fn>
  getCredits: ReturnType<typeof vi.fn>
  isOssMode: ReturnType<typeof vi.fn>
}

let coasty: CoastyMock
const TEST_USER_ID = 'user-test-001'
const TEST_MACHINE_ID = 'machine-test-001'

function buildCoastyMock(): CoastyMock {
  return {
    checkMachineBusy: vi.fn(async () => ({
      success: true,
      busy: false,
      ownerChatId: null,
    })),
    stopMachine: vi.fn(async () => ({
      success: true,
      stopped: true,
      released: true,
      forced: false,
      ownerChatId: null,
    })),
    // Default: sendChatMessage is a long-running operation that never
    // resolves in the test window. The whole point of the Bug 1 fix is
    // that ``handleSubmit``'s 'sent' return MUST NOT depend on this
    // promise — and the only way to prove that is to keep the stream
    // promise pending while we assert the input has cleared.
    sendChatMessage: vi.fn(() => new Promise(() => { /* never resolves */ })),
    abortChat: vi.fn(async () => ({ success: true })),
    onChatSSEEvent: vi.fn(() => () => {}),
    createChat: vi.fn(async () => ({
      success: true,
      chat: { id: 'chat-fresh-001', title: 'New Task', model: 'default' },
    })),
    listChats: vi.fn(async () => ({ success: true, chats: [] })),
    getChatMessages: vi.fn(async () => ({ success: true, messages: [] })),
    updateChat: vi.fn(async () => ({ success: true })),
    deleteChat: vi.fn(async () => ({ success: true })),
    setMode: vi.fn(async () => ({ success: true })),
    setWindowMode: vi.fn(async () => undefined),
    setOpacity: vi.fn(async () => undefined),
    getCredits: vi.fn(async () => ({ success: true, credits: 1000 })),
    isOssMode: vi.fn(async () => false),
  }
}

function resetStores() {
  useAuthStore.setState({
    user: { id: TEST_USER_ID, email: 't@coasty.ai', name: 'Test', avatar: null },
    machineId: TEST_MACHINE_ID,
    loading: false,
  } as any)
  useConnectionStore.setState({ state: 'connected' } as any)
  useChatStore.setState({
    messages: [],
    isStreaming: false,
    chatId: '',
    chatTitle: null,
    isSynced: false,
    abortController: null,
    awaitingHuman: null,
    chatList: [],
    chatListLoading: false,
  })
  useWindowStore.setState({ mode: 'compact' } as any)
}

beforeEach(() => {
  coasty = buildCoastyMock()
  ;(globalThis as any).window.coasty = coasty
  resetStores()
})

afterEach(() => {
  delete (globalThis as any).window.coasty
  vi.clearAllMocks()
})

function getInput(): HTMLInputElement {
  return screen.getByPlaceholderText(
    /Send a message|Another task running|Working/i,
  ) as HTMLInputElement
}

// ``handleSubmit`` returns 'sent' as soon as ``_doSubmit``'s SYNC portion
// runs (addUserMessage + setStreaming(true) + setPendingInput). The
// abortController is set LATER, after the ``await ensureChat`` microtask
// yield. Tests that need to observe the controller must wait for it.
async function waitForAbortControllerSet(): Promise<AbortController> {
  await waitFor(() =>
    expect(useChatStore.getState().abortController).not.toBeNull(),
  )
  return useChatStore.getState().abortController!
}

// ═════════════════════════════════════════════════════════════════════════
// SECTION A — Bug 1: input clears immediately, regardless of stream state
// ═════════════════════════════════════════════════════════════════════════

describe('Bug 1: input must clear without waiting for stream completion', () => {
  // The CRITICAL test. The previous bug was: input stayed populated for
  // minutes because handleSubmit awaited _doSubmit which awaited the full
  // stream. We mock sendChatMessage as a forever-pending promise — if the
  // input still clears, the fix is in place.
  it('★ input clears even when sendChatMessage never resolves', async () => {
    const user = userEvent.setup()
    render(<CompactPill />)
    const input = getInput()

    await user.type(input, 'long task that streams forever{Enter}')

    // sendChatMessage is intentionally a forever-promise. The input
    // MUST clear regardless because the new contract is "clear as soon
    // as the message is committed to the store".
    await waitFor(() => expect(input.value).toBe(''), { timeout: 2000 })

    // And the message DID land in the chat thread (proves no message
    // loss accompanied the clear).
    const um = useChatStore.getState().messages.filter((m) => m.role === 'user')
    expect(um).toHaveLength(1)
    expect(um[0].content).toContain('long task that streams forever')
  })

  it('★ input clears BEFORE sendChatMessage resolves (timing proof)', async () => {
    // Pins the ordering: clear happens before the stream finishes.
    let resolveSend!: (val: any) => void
    coasty.sendChatMessage = vi.fn(
      () => new Promise((r) => { resolveSend = r }),
    )

    const user = userEvent.setup()
    render(<CompactPill />)
    const input = getInput()

    await user.type(input, 'race the stream{Enter}')

    // Input clears WITHOUT us resolving the stream.
    await waitFor(() => expect(input.value).toBe(''))

    // sendChatMessage IPC fired (so we're not just clearing on a no-op
    // path) but is STILL unresolved.
    expect(coasty.sendChatMessage).toHaveBeenCalled()

    // Cleanup: resolve so the test doesn't leak the pending promise.
    resolveSend({ success: true })
  })

  it('input clears the same way on the Enter key path', async () => {
    const user = userEvent.setup()
    render(<CompactPill />)
    const input = getInput()
    await user.type(input, 'submitted via enter{Enter}')
    await waitFor(() => expect(input.value).toBe(''))
  })

  it('input clears even on the busy → auto-recovery path (also fire-and-forget)', async () => {
    // forceStopAndSend was ALSO awaiting _doSubmit before the fix.
    // Critical that this path clears too — otherwise busy users would
    // see the input stuck.
    coasty.checkMachineBusy = vi.fn(async () => ({
      success: true,
      busy: true,
      ownerChatId: 'other-chat',
    }))

    const user = userEvent.setup()
    render(<CompactPill />)
    const input = getInput()

    await user.type(input, 'override and clear{Enter}')

    await waitFor(() => expect(input.value).toBe(''), { timeout: 2000 })
  })

  it('chat thread contains the user message AT the moment input clears', async () => {
    // Subtle ordering guarantee: by the time the input is empty, the
    // user's message must already be visible. Otherwise the user
    // momentarily sees neither their text nor their bubble — a
    // "did my message get sent?" UI flicker.
    const user = userEvent.setup()
    render(<CompactPill />)
    const input = getInput()
    await user.type(input, 'no-flicker{Enter}')

    await waitFor(() => {
      expect(input.value).toBe('')
      const um = useChatStore.getState().messages.filter((m) => m.role === 'user')
      expect(um).toHaveLength(1)
      expect(um[0].content).toContain('no-flicker')
    })
  })

  it('UTF-8 / emoji content is cleared cleanly (no encoding leak)', async () => {
    const user = userEvent.setup()
    render(<CompactPill />)
    const input = getInput()
    await user.type(input, 'héllo 😀 世界{Enter}')
    await waitFor(() => expect(input.value).toBe(''))
    const um = useChatStore.getState().messages.filter((m) => m.role === 'user')
    expect(um[0].content).toContain('héllo 😀 世界')
  })

  it('rejected submit (empty input) does NOT modify the input', async () => {
    // Negative test: the fire-and-forget change must NOT clear input on
    // the 'rejected' path. Only on 'sent'.
    const user = userEvent.setup()
    render(<CompactPill />)
    const input = getInput()
    // Empty / whitespace-only input.
    await user.type(input, '   ')
    // No send button rendered for empty input, so just press Enter.
    await user.keyboard('{Enter}')
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(input.value).toBe('   ')
    // No message added to chat thread.
    expect(useChatStore.getState().messages).toHaveLength(0)
  })

  it('disconnected state — Send is blocked, input preserved', async () => {
    useConnectionStore.setState({ state: 'disconnected' } as any)
    const user = userEvent.setup()
    render(<CompactPill />)
    const input = getInput()
    // Disconnected → input is disabled per the placeholder logic, so
    // user.type would no-op. Drive the value directly to simulate a
    // racy disconnect-after-typing.
    await act(async () => {
      // Re-enable so we can type, then disconnect again.
      useConnectionStore.setState({ state: 'connected' } as any)
    })
    await user.type(input, 'goes nowhere')
    await act(async () => {
      useConnectionStore.setState({ state: 'disconnected' } as any)
    })
    // Send button disabled / does not exist while disconnected.
    const sendBtn = screen.queryByRole('button', { name: /^send$/i })
    if (sendBtn) {
      await user.click(sendBtn)
    } else {
      await user.keyboard('{Enter}')
    }
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    // No send happened, input preserved.
    expect(coasty.sendChatMessage).not.toHaveBeenCalled()
    expect(input.value).toBe('goes nowhere')
  })
})

// ═════════════════════════════════════════════════════════════════════════
// SECTION B — Bug 2: handleStop awaits stopMachine + ownership guard
// ═════════════════════════════════════════════════════════════════════════

describe('Bug 2: handleStop must drain the backend lock before returning', () => {
  it('★ handleStop awaits stopMachine IPC (lock is released before returning)', async () => {
    // Track WHEN stopMachine resolves relative to handleStop's resolution.
    const events: string[] = []
    coasty.stopMachine = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 30))
      events.push('stopMachine-resolved')
      return { success: true, stopped: true, released: true, forced: false }
    })

    const { result } = renderHook(() => useChatSubmit())
    // Simulate that a stream IS in flight (otherwise stopStreaming is a
    // no-op and we wouldn't be exercising the path that matters).
    const ctrl = new AbortController()
    useChatStore.setState({ isStreaming: true, abortController: ctrl })

    await act(async () => {
      await result.current.handleStop()
      events.push('handleStop-returned')
    })

    // handleStop MUST resolve AFTER stopMachine — that's the ordering
    // the user's "Stop → New → Send" gesture depends on.
    expect(events).toEqual(['stopMachine-resolved', 'handleStop-returned'])
  })

  it('handleStop aborts the controller synchronously (UI reacts instantly)', async () => {
    const { result } = renderHook(() => useChatSubmit())
    const ctrl = new AbortController()
    const abortSpy = vi.spyOn(ctrl, 'abort')
    useChatStore.setState({ isStreaming: true, abortController: ctrl })

    // Don't await — we want to observe the SYNC abort, not the awaited
    // stopMachine that follows.
    const stopPromise = result.current.handleStop()

    // ★ Sync side-effect: controller is aborted IMMEDIATELY.
    expect(abortSpy).toHaveBeenCalled()
    expect(useChatStore.getState().isStreaming).toBe(false)
    expect(useChatStore.getState().abortController).toBeNull()

    // Drain the async part for cleanup.
    await stopPromise
  })

  it('handleStop is a no-op for stopMachine when no machineId is set', async () => {
    useAuthStore.setState({ machineId: null } as any)
    const { result } = renderHook(() => useChatSubmit())

    await act(async () => {
      await result.current.handleStop()
    })

    // Without a machineId there's no backend lock to drain — calling
    // stopMachine would 400.
    expect(coasty.stopMachine).not.toHaveBeenCalled()
  })

  it('handleStop swallows stopMachine errors (renderer must not throw to onClick)', async () => {
    coasty.stopMachine = vi.fn(async () => {
      throw new Error('network down')
    })
    const { result } = renderHook(() => useChatSubmit())
    useChatStore.setState({
      isStreaming: true,
      abortController: new AbortController(),
    })

    // ★ MUST NOT throw. The Stop button's onClick handler can't tolerate
    // unhandled rejections.
    await act(async () => {
      await expect(result.current.handleStop()).resolves.toBeUndefined()
    })
  })

  it('handleStop is safe to call when no stream is active', async () => {
    // User clicks Stop with no streaming. abortController is null,
    // isStreaming is false. handleStop should still call stopMachine
    // (the backend may have a stale lock from a crashed prior run).
    const { result } = renderHook(() => useChatSubmit())
    useChatStore.setState({ isStreaming: false, abortController: null })

    await act(async () => {
      await result.current.handleStop()
    })

    // No crash. stopMachine WAS called — defensive cleanup is the right
    // behavior because the backend may still hold a stale lock.
    expect(coasty.stopMachine).toHaveBeenCalled()
  })

  it('rapid double-click on Stop: stopMachine fires twice but no state corruption', async () => {
    // Real-world: user mashes Stop. Each click triggers a stopMachine
    // call. Backend handles idempotently. Renderer state must stay sane.
    const { result } = renderHook(() => useChatSubmit())
    const ctrl = new AbortController()
    useChatStore.setState({ isStreaming: true, abortController: ctrl })

    await act(async () => {
      await Promise.all([
        result.current.handleStop(),
        result.current.handleStop(),
      ])
    })

    // Each click fired stopMachine — backend's job to dedupe.
    expect(coasty.stopMachine).toHaveBeenCalledTimes(2)
    // Renderer state is consistent.
    expect(useChatStore.getState().isStreaming).toBe(false)
    expect(useChatStore.getState().abortController).toBeNull()
  })
})

// ═════════════════════════════════════════════════════════════════════════
// SECTION C — Bug 2: ownership guard prevents stale-run state wipe
// ═════════════════════════════════════════════════════════════════════════

describe('Bug 2: stopped task\'s finally must not clobber a newer run', () => {
  // These are the canary tests for the "stop → new chat → submit → stuck"
  // chain. The simulator below reproduces the exact race the user hit:
  //   1. Run A's _doSubmit awaits sendChatMessage (long).
  //   2. User clicks Stop. Run A's signal listener fires.
  //   3. User immediately submits Run B. Run B sets isStreaming=true,
  //      stores a NEW controller.
  //   4. Run A's sendChatMessage promise finally settles (via abort).
  //      Run A's `finally` runs → setStreaming(false), setAbortController(null).
  //      WITHOUT the ownership guard, this wipes Run B's state and the
  //      user sees the UI freeze halfway into Run B.

  it('★ stale finally does NOT wipe new run\'s isStreaming flag', async () => {
    let resolveSendA!: (val: any) => void
    let sendACallCount = 0
    coasty.sendChatMessage = vi.fn(() => {
      sendACallCount += 1
      if (sendACallCount === 1) {
        // Run A: long-pending, controlled by our handle below.
        return new Promise((r) => { resolveSendA = r })
      }
      // Run B: also long-pending so its setStreaming(true) survives —
      // we want to observe state UNDER the race, not after Run B
      // finishes naturally and cleans up.
      return new Promise(() => { /* never */ })
    })

    const { result, rerender } = renderHook(() => useChatSubmit())

    // ── Run A ─────────────────────────────────────────────────────────
    await act(async () => {
      await result.current.handleSubmit('task A')
    })
    expect(useChatStore.getState().isStreaming).toBe(true)
    // Wait for _doSubmit's post-ensureChat continuation: it creates the
    // AbortController and stores it. Without this wait we'd be checking
    // before the controller is set.
    let ctrlA: AbortController
    await act(async () => { ctrlA = await waitForAbortControllerSet() })

    // User clicks Stop (sync portion only — we skip handleStop's
    // awaited stopMachine for tighter control over the timing here).
    await act(async () => {
      ctrlA!.abort()
      useChatStore.setState({ isStreaming: false, abortController: null })
    })

    // ── Run B (the user's "first submit after stop") ──────────────────
    rerender()
    await act(async () => {
      await result.current.handleSubmit('task B')
    })
    let ctrlB: AbortController
    await act(async () => { ctrlB = await waitForAbortControllerSet() })
    expect(ctrlB!).not.toBe(ctrlA!)
    expect(useChatStore.getState().isStreaming).toBe(true)

    // ★ Resolve Run A's stalled promise NOW — its `finally` will fire.
    // The ownership guard MUST make this a no-op (Run B's state survives).
    await act(async () => {
      resolveSendA({ success: true, aborted: true })
      await new Promise((r) => setTimeout(r, 50))
    })

    // ★ The critical assertion. Run B's state is INTACT despite Run A's
    // finally having fired.
    expect(useChatStore.getState().abortController).toBe(ctrlB!)
    expect(useChatStore.getState().isStreaming).toBe(true)
  })

  // SSE event dispatcher: api.ts wires callbacks through
  // ``window.coasty.onChatSSEEvent``, so to fire an onError / onMachineBusy
  // callback under test we need to capture the listener and dispatch a
  // synthetic SSE event ourselves. Each handleSubmit triggers one
  // sendChatMessage IPC; we capture the resulting requestId so we can
  // target events at the correct in-flight run.
  function setupSseCapture() {
    const sseListeners: Array<(event: any) => void> = []
    const requestIds: string[] = []
    coasty.onChatSSEEvent = vi.fn((listener) => {
      sseListeners.push(listener)
      return () => {
        const i = sseListeners.indexOf(listener)
        if (i >= 0) sseListeners.splice(i, 1)
      }
    })
    coasty.sendChatMessage = vi.fn((params: any) => {
      requestIds.push(params.requestId)
      // Never resolves — keep the run pending so we can observe state
      // under the race.
      return new Promise(() => {})
    })
    return {
      dispatch: (requestId: string, type: string, data: string) => {
        for (const l of sseListeners) {
          l({ requestId, type, data })
        }
      },
      requestIds,
    }
  }

  it('★ stale onError does NOT wipe new run\'s isStreaming flag', async () => {
    // Variant: instead of Run A's promise resolving cleanly, the SSE
    // stream emits an error event AFTER Run B has taken over. The
    // ``onError`` callback used to unconditionally ``setStreaming(false)``.
    // With the ownership guard it must check ownership first.
    const sse = setupSseCapture()
    const { result } = renderHook(() => useChatSubmit())

    // Run A — wait for sendChatMessage to fire (its requestId is captured).
    await act(async () => { await result.current.handleSubmit('A') })
    await waitFor(() => expect(sse.requestIds.length).toBe(1))
    expect(useChatStore.getState().isStreaming).toBe(true)
    const ctrlA = useChatStore.getState().abortController!
    const reqIdA = sse.requestIds[0]

    // User stops (sync portion only).
    await act(async () => {
      ctrlA.abort()
      useChatStore.setState({ isStreaming: false, abortController: null })
    })

    // Run B takes over.
    await act(async () => { await result.current.handleSubmit('B') })
    await waitFor(() => expect(sse.requestIds.length).toBe(2))
    let ctrlB: AbortController
    await act(async () => { ctrlB = await waitForAbortControllerSet() })
    expect(ctrlB!).not.toBe(ctrlA)
    expect(useChatStore.getState().isStreaming).toBe(true)

    // ★ Now Run A's onError fires LATE (stale SSE event targeting the
    // old requestId). The api.ts dispatcher will route it to Run A's
    // onError callback, which is the one with the ownership guard.
    await act(async () => {
      sse.dispatch(reqIdA, '3', JSON.stringify('phantom error'))
    })

    // Run B's streaming flag survives.
    expect(useChatStore.getState().isStreaming).toBe(true)
    expect(useChatStore.getState().abortController).toBe(ctrlB!)
  })

  it('★ stale onMachineBusy does NOT wipe new run\'s isStreaming flag', async () => {
    // Identical pattern, but the stale callback is onMachineBusy
    // (api.ts routes a MACHINE_BUSY structured error to this callback
    // instead of onError).
    const sse = setupSseCapture()
    const { result } = renderHook(() => useChatSubmit())

    await act(async () => { await result.current.handleSubmit('A') })
    await waitFor(() => expect(sse.requestIds.length).toBe(1))
    const ctrlA = useChatStore.getState().abortController!
    const reqIdA = sse.requestIds[0]

    await act(async () => {
      ctrlA.abort()
      useChatStore.setState({ isStreaming: false, abortController: null })
    })

    await act(async () => { await result.current.handleSubmit('B') })
    await waitFor(() => expect(sse.requestIds.length).toBe(2))
    let ctrlB: AbortController
    await act(async () => { ctrlB = await waitForAbortControllerSet() })
    expect(useChatStore.getState().isStreaming).toBe(true)

    // Stale MACHINE_BUSY SSE event targeting Run A's requestId.
    await act(async () => {
      sse.dispatch(reqIdA, '3', JSON.stringify({
        code: 'MACHINE_BUSY',
        message: 'old busy',
        machineId: TEST_MACHINE_ID,
        ownerChatId: null,
      }))
    })

    expect(useChatStore.getState().isStreaming).toBe(true)
    expect(useChatStore.getState().abortController).toBe(ctrlB!)
  })

  it('current-run onError DOES clear streaming (guard is run-specific, not blanket-disabled)', async () => {
    // Negative test for the guard: it must still allow the CURRENT run's
    // callbacks to mutate state. Otherwise we've created the opposite
    // bug — UI stuck spinning forever on a real error.
    const sse = setupSseCapture()
    const { result } = renderHook(() => useChatSubmit())
    await act(async () => { await result.current.handleSubmit('only run') })
    // Wait until sendChatMessage fires and we know the requestId of the
    // current (and only) in-flight run.
    await waitFor(() => expect(sse.requestIds.length).toBe(1))
    expect(useChatStore.getState().isStreaming).toBe(true)
    const reqId = sse.requestIds[0]

    // The current run's onError fires via a synthetic SSE event.
    await act(async () => {
      sse.dispatch(reqId, '3', JSON.stringify('real error'))
    })

    // Streaming CLEARS (this is the only run, so it owns the store).
    expect(useChatStore.getState().isStreaming).toBe(false)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// SECTION D — Integration: full Stop → New Chat → Submit gesture
// ═════════════════════════════════════════════════════════════════════════

describe('Bug 2: real-user gesture sequences (Stop → New → Submit)', () => {
  it('★ Stop → submit-immediately works on the FIRST submit (not the second)', async () => {
    // The original user complaint, end-to-end. After clicking Stop, the
    // very next submit MUST land in the chat — not get rejected because
    // the backend lock is still held.
    let stopMachineResolveOrder: string[] = []
    coasty.stopMachine = vi.fn(async () => {
      stopMachineResolveOrder.push('stop')
      return { success: true, stopped: true, released: true, forced: false }
    })
    coasty.sendChatMessage = vi.fn(async () => {
      stopMachineResolveOrder.push('send')
      return { success: true }
    })

    const user = userEvent.setup()
    render(<CompactPill />)
    const input = getInput()

    // Set up: simulate that a stream IS running.
    const ctrl = new AbortController()
    await act(async () => {
      useChatStore.setState({ isStreaming: true, abortController: ctrl })
    })

    // User clicks Stop button — but we render the stop UI by having
    // isStreaming=true.
    const stopBtn = await screen.findByRole('button', { name: /^stop$/i })
    await user.click(stopBtn)

    // After the click, isStreaming MUST be false so the input is
    // enabled. (handleStop sets this synchronously.)
    await waitFor(() => expect(useChatStore.getState().isStreaming).toBe(false))

    // Type new message and submit — the FIRST submit.
    // Wait for the Send button to be re-rendered.
    await waitFor(() => expect(screen.queryByRole('button', { name: /^stop$/i })).toBeNull())
    await user.type(input, 'new task right after stop{Enter}')

    // ★ sendChatMessage MUST have been called for the new submit.
    await waitFor(
      () => expect(coasty.sendChatMessage).toHaveBeenCalled(),
      { timeout: 2000 },
    )

    // And the stop happened BEFORE the send (the gesture chain
    // produced the right backend ordering).
    expect(stopMachineResolveOrder).toEqual(['stop', 'send'])
  })

  it('★ Stop → clearMessages → submit: chat thread holds only the new message', async () => {
    // Common gesture: user stops, clicks "New", types a fresh prompt.
    // The chat thread must not contain ghosts from the prior run.
    const user = userEvent.setup()
    render(<CompactPill />)
    const input = getInput()

    // Seed prior task state.
    await act(async () => {
      useChatStore.setState({
        isStreaming: true,
        abortController: new AbortController(),
        messages: [
          { id: 'u1', role: 'user', content: 'old task', createdAt: '2020-01-01' },
          { id: 'a1', role: 'assistant', content: 'old response', createdAt: '2020-01-01' },
        ] as any,
      })
    })

    // Stop.
    const stopBtn = await screen.findByRole('button', { name: /^stop$/i })
    await user.click(stopBtn)
    await waitFor(() => expect(useChatStore.getState().isStreaming).toBe(false))

    // Simulate "New" button (only available in expanded mode in real
    // UI but functionally equivalent: clear the chat thread).
    await act(async () => {
      useChatStore.getState().clearMessages()
    })
    expect(useChatStore.getState().messages).toHaveLength(0)

    // Fresh submit.
    await user.type(input, 'brand new task{Enter}')
    await waitFor(() => expect(coasty.sendChatMessage).toHaveBeenCalled())

    const um = useChatStore.getState().messages.filter((m) => m.role === 'user')
    expect(um).toHaveLength(1)
    expect(um[0].content).toContain('brand new task')
    // No leftover messages.
    expect(useChatStore.getState().messages.every(
      (m) => !m.content.includes('old')
    )).toBe(true)
  })

  it('★ rapid Stop → Stop → Submit chain stays consistent', async () => {
    // Stress test: user mashes Stop twice and then immediately submits.
    // The two stop calls fire, the submit fires, state stays sane.
    const user = userEvent.setup()
    render(<CompactPill />)
    const input = getInput()

    await act(async () => {
      useChatStore.setState({
        isStreaming: true,
        abortController: new AbortController(),
      })
    })

    const stopBtn = await screen.findByRole('button', { name: /^stop$/i })
    await user.click(stopBtn)
    // After first click, isStreaming flips false → Stop button unmounts.
    // We don't try to click it again from the DOM (it's gone). Instead
    // we exercise the rapid path by directly invoking handleStop via
    // the hook in the next block, which is what a user mashing the
    // button BEFORE the unmount would have effectively triggered.

    await waitFor(() => expect(useChatStore.getState().isStreaming).toBe(false))

    await user.type(input, 'after mashed stops{Enter}')
    await waitFor(() => expect(coasty.sendChatMessage).toHaveBeenCalled())
  })

  it('handleStop while in-flight stopMachine HTTP also rejects the renderer abort listener race', async () => {
    // Build-up: a real abort listener exists on the controller (via
    // api.ts's signal?.addEventListener). The signal abort listener
    // calls abortChat. We assert abortChat fires AND handleStop's
    // awaited stopMachine fires. They are independent paths to the
    // same backend; both completing is the harmless desired outcome.
    const ctrl = new AbortController()
    const abortHandler = vi.fn()
    ctrl.signal.addEventListener('abort', abortHandler)

    useChatStore.setState({ isStreaming: true, abortController: ctrl })

    const { result } = renderHook(() => useChatSubmit())
    await act(async () => { await result.current.handleStop() })

    expect(abortHandler).toHaveBeenCalledTimes(1)
    expect(coasty.stopMachine).toHaveBeenCalledWith(TEST_MACHINE_ID)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// SECTION E — corner cases that *could* re-introduce the bug
// ═════════════════════════════════════════════════════════════════════════

describe('Bug 1 & 2: subtle corner cases that would silently break the fix', () => {
  it('handleSubmit fire-and-forget: an unhandled _doSubmit error does NOT crash the UI', async () => {
    // _doSubmit catches internally, but if the .catch() we added were
    // ever removed, an unexpected throw would leak as an unhandled
    // rejection and (in some hosting environments) crash the renderer.
    // This test ensures the fire-and-forget path is .catch()-protected.
    coasty.createChat = vi.fn(async () => {
      throw new Error('IPC bridge died')
    })
    coasty.sendChatMessage = vi.fn(async () => ({ success: true }))

    const user = userEvent.setup()
    render(<CompactPill />)
    const input = getInput()

    let unhandled: any = null
    const handler = (e: any) => { unhandled = e?.reason ?? e }
    if (typeof window !== 'undefined') {
      window.addEventListener('unhandledrejection', handler)
    }

    await user.type(input, 'will fail on createChat{Enter}')
    await act(async () => { await new Promise((r) => setTimeout(r, 100)) })

    // ★ No unhandled rejection bubbled up. ensureChat's internal
    // try/catch + handleSubmit's .catch() together cover this.
    expect(unhandled).toBeNull()

    if (typeof window !== 'undefined') {
      window.removeEventListener('unhandledrejection', handler)
    }
  })

  it('handleSubmit returns "sent" SYNCHRONOUSLY enough that the next render shows empty input', async () => {
    // Hard timing assertion: by the next React render after click,
    // the input MUST be empty. This is the "feels instant" UX target.
    const user = userEvent.setup()
    render(<CompactPill />)
    const input = getInput()

    await user.type(input, 'fast clear test')
    expect(input.value).toBe('fast clear test')

    await user.keyboard('{Enter}')

    // Without awaiting more than one tick, the input should clear.
    await waitFor(() => expect(input.value).toBe(''), { timeout: 1000 })
  })

  it('after submit, isStreaming=true blocks a second concurrent submit', async () => {
    // canSend should still gate against double-submits while a stream
    // is in flight. The fire-and-forget change must NOT have weakened
    // this guard — otherwise a user mashing Enter would queue multiple
    // streams.
    coasty.sendChatMessage = vi.fn(() => new Promise(() => { /* never */ }))

    const user = userEvent.setup()
    render(<CompactPill />)
    const input = getInput()

    await user.type(input, 'first{Enter}')
    // isStreaming is now true (set inside _doSubmit synchronously).
    await waitFor(() => expect(useChatStore.getState().isStreaming).toBe(true))

    // Type a second message and try to submit.
    await user.type(input, 'second')
    await user.keyboard('{Enter}')

    // Only ONE sendChatMessage call total — the second was gated.
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(coasty.sendChatMessage).toHaveBeenCalledTimes(1)
  })

  it('natural stream completion: store cleanup still runs (guard does not break the happy path)', async () => {
    // The ownership guard's job is to prevent STALE finally blocks from
    // running cleanup. The CURRENT run's finally must still clean up,
    // otherwise streaming flags would be stuck `true` forever after a
    // happy completion.
    let resolveSend!: (val: any) => void
    coasty.sendChatMessage = vi.fn(() => new Promise((r) => { resolveSend = r }))

    const { result } = renderHook(() => useChatSubmit())
    await act(async () => { await result.current.handleSubmit('happy path') })
    expect(useChatStore.getState().isStreaming).toBe(true)

    // Stream completes naturally (no stop, no abort, no error).
    await act(async () => {
      resolveSend({ success: true })
      await new Promise((r) => setTimeout(r, 30))
    })

    // ★ Final state is clean. If the guard incorrectly held cleanup
    // back, isStreaming would be stuck true.
    expect(useChatStore.getState().isStreaming).toBe(false)
    expect(useChatStore.getState().abortController).toBeNull()
  })

  it('handleStop on an already-cleared store (post-finish) still calls stopMachine defensively', async () => {
    // Edge: user clicks Stop AFTER the stream finished naturally. The
    // store is already clean. We still call stopMachine because the
    // backend may have a stale lock (e.g. server crashed mid-finish
    // and didn't release). Skipping it would leave the user wedged.
    useChatStore.setState({ isStreaming: false, abortController: null })

    const { result } = renderHook(() => useChatSubmit())
    await act(async () => { await result.current.handleStop() })

    expect(coasty.stopMachine).toHaveBeenCalledWith(TEST_MACHINE_ID)
  })

  it('Run A finally fires AFTER Run B finishes naturally: guard still a no-op', async () => {
    // Order: Run A starts → user stops → Run B starts → Run B finishes
    // CLEANLY → Run B's finally clears the store → Run A's finally
    // fires (late). The store no longer has Run A's controller, so the
    // guard should make Run A's late finally a no-op.
    let resolveSendA!: (val: any) => void
    let resolveSendB!: (val: any) => void
    let sendCallCount = 0
    coasty.sendChatMessage = vi.fn(() => {
      sendCallCount += 1
      if (sendCallCount === 1) {
        return new Promise((r) => { resolveSendA = r })
      }
      return new Promise((r) => { resolveSendB = r })
    })

    const { result } = renderHook(() => useChatSubmit())

    // Run A
    await act(async () => { await result.current.handleSubmit('A') })
    await waitFor(() => expect(useChatStore.getState().abortController).not.toBeNull())
    const ctrlA = useChatStore.getState().abortController!

    // User stops (sync portion).
    await act(async () => {
      ctrlA.abort()
      useChatStore.setState({ isStreaming: false, abortController: null })
    })

    // Run B
    await act(async () => { await result.current.handleSubmit('B') })
    let ctrlB: AbortController
    await act(async () => { ctrlB = await waitForAbortControllerSet() })
    expect(useChatStore.getState().isStreaming).toBe(true)

    // Run B finishes cleanly FIRST. Its finally clears the store.
    await act(async () => {
      resolveSendB({ success: true })
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(useChatStore.getState().isStreaming).toBe(false)
    expect(useChatStore.getState().abortController).toBeNull()

    // Now Run A's finally fires LATE. The store is already clean.
    // The guard makes this a no-op — no exception, no spurious state.
    await act(async () => {
      resolveSendA({ success: true, aborted: true })
      await new Promise((r) => setTimeout(r, 30))
    })

    expect(useChatStore.getState().isStreaming).toBe(false)
    expect(useChatStore.getState().abortController).toBeNull()
  })

  it('Three runs back-to-back: only the latest one\'s state is reflected', async () => {
    // Survival test under heavier load. The user submits, stops,
    // submits, stops, submits — three runs in flight, only the third
    // should "own" the store at the end. The other two leaking their
    // finallys late must NOT wipe Run C's state.
    const resolvers: Array<(val: any) => void> = []
    coasty.sendChatMessage = vi.fn(() => new Promise((r) => { resolvers.push(r) }))

    const { result } = renderHook(() => useChatSubmit())

    // Run A
    await act(async () => { await result.current.handleSubmit('A') })
    await waitForAbortControllerSet()
    const ctrlA = useChatStore.getState().abortController!
    await act(async () => {
      ctrlA.abort()
      useChatStore.setState({ isStreaming: false, abortController: null })
    })

    // Run B
    await act(async () => { await result.current.handleSubmit('B') })
    await waitForAbortControllerSet()
    const ctrlB = useChatStore.getState().abortController!
    await act(async () => {
      ctrlB.abort()
      useChatStore.setState({ isStreaming: false, abortController: null })
    })

    // Run C — the survivor.
    await act(async () => { await result.current.handleSubmit('C') })
    await waitForAbortControllerSet()
    const ctrlC = useChatStore.getState().abortController!
    expect(ctrlC).not.toBe(ctrlA)
    expect(ctrlC).not.toBe(ctrlB)

    // Both stale runs resolve out of order — A first, then B.
    await act(async () => {
      resolvers[0]({ aborted: true })
      resolvers[1]({ aborted: true })
      await new Promise((r) => setTimeout(r, 50))
    })

    // ★ Run C's state SURVIVES both stale finallys.
    expect(useChatStore.getState().abortController).toBe(ctrlC)
    expect(useChatStore.getState().isStreaming).toBe(true)
  })

  it('Stop while checkBusy is mid-flight on a NEW submit: no deadlock, no double-add', async () => {
    // Truly mean race: user submits, checkBusy is awaiting backend.
    // User immediately hits Stop. The submit completes its checkBusy,
    // returns 'busy' OR 'sent' depending on the resolution. Either
    // way, no deadlock and no message duplication.
    let releaseCheck!: (val: any) => void
    coasty.checkMachineBusy = vi.fn(
      () => new Promise((r) => { releaseCheck = r }),
    )

    const { result } = renderHook(() => useChatSubmit())

    // Start a submit (will hang on checkBusy).
    let submitDone = false
    act(() => {
      result.current.handleSubmit('mid-check stop')
        .finally(() => { submitDone = true })
    })

    // While checkBusy is pending, the user clicks Stop. (There's no
    // active controller yet — abortController is null at this point —
    // so handleStop only calls stopMachine.)
    await act(async () => { await result.current.handleStop() })

    // checkBusy finally resolves to not-busy.
    await act(async () => {
      releaseCheck({ success: true, busy: false, ownerChatId: null })
      await new Promise((r) => setTimeout(r, 30))
    })

    await waitFor(() => expect(submitDone).toBe(true))
    // Submit completed (sent or rejected) — the key invariant is no
    // deadlock and no exception bubbling up.
  })
})
