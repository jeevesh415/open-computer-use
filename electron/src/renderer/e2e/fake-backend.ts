/**
 * FakeBackend — smart in-test stand-in for the Electron main process +
 * FastAPI backend.
 *
 * What it is
 * ----------
 * A test helper that replaces ``window.coasty`` with a faithful
 * simulation of the entire main-process-and-backend layer. Tests
 * script what the "backend" should emit (text chunks, tool calls,
 * tool results, errors, finish events, AWAITING_HUMAN), and the
 * helper drives the renderer's SSE parser exactly as the real
 * pipeline would.
 *
 * Why a smart fake instead of a vi.fn() per method
 * ------------------------------------------------
 * The chat flow's correctness depends on the EVENT SEQUENCE the
 * backend emits, not on individual method calls. A static mock
 * (``vi.fn(() => ({success: true}))``) can verify "was this method
 * called?", but can't verify "did the assistant message get
 * progressively appended as text chunks streamed in?" or "did the
 * tool result get attached to the right invocation?".
 *
 * The fake here drives the actual lib/api.ts SSE parser by firing
 * synthetic ``chat:sse-event`` IPC events at exactly the moments the
 * real backend would. Tests can then assert on the rendered DOM /
 * chat-store state and be sure the renderer's reaction to the wire
 * stream is correct end-to-end.
 *
 * What's still mocked (the boundary)
 * ----------------------------------
 *   - ``window.coasty.*`` — the entire IPC boundary between renderer
 *     and main process.
 *
 * What's NOT mocked (real code under test)
 * ----------------------------------------
 *   - useChatSubmit (handleSubmit, forceStopAndSend, _doSubmit, all
 *     state transitions)
 *   - chat-store, auth-store, connection-store, window-store
 *   - lib/api.ts (the SSE parser — the fake fires real events at it)
 *   - All rendered components (CompactPill, MessageList, etc.)
 *   - React reconciliation, jsdom DOM
 *
 * Layering — where this lives in the test pyramid
 * -----------------------------------------------
 *   - useChatSubmit-ordering.test.ts → pure-logic mirrors (fastest)
 *   - machine-busy.test.ts            → pure-logic mirrors
 *   - send-flow-integration.test.tsx  → render-level w/ flat vi.fn mocks
 *   - e2e-*.test.tsx                  → render-level w/ THIS smart fake
 *   - (Playwright/Spectron)           → would test packaged binary;
 *                                       out of scope for vitest.
 *
 * This file is the highest-fidelity layer that still runs in CI
 * without spinning up a real Electron process. If a regression
 * escapes these tests, it's almost certainly a packaging /
 * native-module / OS-permission issue, not a code-logic issue.
 */
import { vi } from 'vitest'

// ── SSE event types as emitted by lib/api.ts's parser ────────────────────
//
// These match the wire codes from the FastAPI backend:
//   '0' — text chunk           (data = JSON-encoded string)
//   '3' — error / MACHINE_BUSY (data = JSON-encoded string or object)
//   '9' — tool call            (data = JSON {toolCallId, toolName, args})
//   'a' — tool result          (data = JSON {toolCallId, result, ...})
//   'g' — reasoning            (data = JSON-encoded string or {text})
//   'd' — finish               (data = JSON {finishReason, content, toolInvocations})
//   'h' — awaiting human       (data = JSON {reason, machineId})
//   'error' — direct main-process error
export type SseEvent = {
  requestId: string
  type: '0' | '3' | '9' | 'a' | 'g' | 'd' | 'h' | 'error'
  data: string
}

export interface ScriptedToolCall {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  result?: unknown
  frontendScreenshot?: string
}

export interface ScriptedResponse {
  /** Sequential text chunks. Each fires as a separate '0' event. */
  textChunks?: string[]
  /** Tool calls (with optional results that fire as 'a' events). */
  toolCalls?: ScriptedToolCall[]
  /** Reasoning chunks ('g' events). */
  reasoningChunks?: string[]
  /** AWAITING_HUMAN handoff ('h' event before finish). */
  awaitingHuman?: { reason: string; machineId: string }
  /** Error event ('3' with structured payload or string). */
  error?: { code?: string; message: string; machineId?: string; ownerChatId?: string | null }
  /** finishReason on the 'd' event. */
  finishReason?: string
  /** Full content for the 'd' event (lib/api.ts uses this for the final message body). */
  finishContent?: string
  /** Final tool invocations array carried on the 'd' event. */
  finishToolInvocations?: unknown[]
  /** Whether to fire a 'd' finish event at all. Default true. */
  emitFinish?: boolean
  /** Delay (ms) between events. Default 0 — events fire as fast as the
   *  event loop drains. Set to small values (5-20ms) to model real
   *  streaming for timing-sensitive tests. */
  perEventDelayMs?: number
}

export interface CoastyFakeOptions {
  /** Initial pre-check busy state per machine. Default: not busy. */
  initialBusyMachines?: Set<string>
  /** Override the response from `stopMachine` IPC. */
  stopMachineResponse?: {
    success: boolean
    stopped?: boolean
    released?: boolean
    forced?: boolean
    ownerChatId?: string | null
    error?: string
  }
}

export class FakeBackend {
  private sseListeners: Array<(event: SseEvent) => void> = []
  /** Scripts keyed by requestId — set in advance with scriptNextResponse */
  private pendingScript: ScriptedResponse | null = null
  /** Map of machineId → owning chat id for the busy pre-check.
   *  Undefined entry means not busy. */
  private busyMachines = new Map<string, string>()
  /** Counter for diagnostic — every chat:send-message dispatched. */
  public sendCallCount = 0
  /** Capture every dispatched chat:send-message payload — useful for
   *  asserting that the wire payload includes the right messages,
   *  chat_id, machine_id, etc. */
  public capturedSends: Array<{
    requestId: string
    messages: Array<{ role: string; content: string }>
    chatId: string
    userId: string
    machineId: string
    model?: string
  }> = []
  /** Counter for stopMachine calls — race-condition / cancel tests. */
  public stopMachineCallCount = 0
  /** Counter for abortChat calls. */
  public abortChatCallCount = 0
  /** Stop-machine response. Tests can flip this to simulate force-release etc. */
  private stopMachineResponse: NonNullable<CoastyFakeOptions['stopMachineResponse']> = {
    success: true,
    stopped: true,
    released: true,
    forced: false,
    ownerChatId: null,
  }

  constructor(opts: CoastyFakeOptions = {}) {
    if (opts.initialBusyMachines) {
      for (const id of opts.initialBusyMachines) {
        this.busyMachines.set(id, 'chat-owner-of-' + id)
      }
    }
    if (opts.stopMachineResponse) {
      this.stopMachineResponse = { ...this.stopMachineResponse, ...opts.stopMachineResponse }
    }
  }

  /** Mark a machine as busy (so checkMachineBusy returns busy=true). */
  setBusy(machineId: string, ownerChatId = 'chat-other-task') {
    this.busyMachines.set(machineId, ownerChatId)
  }

  /** Clear busy state — simulates a successful stop-machine release. */
  setNotBusy(machineId: string) {
    this.busyMachines.delete(machineId)
  }

  /** Forcibly clear all SSE listeners + pending scripts. Used in
   *  test teardown to make sure in-flight scripted events from one
   *  test don't leak into the next test's chat-store (the fake's
   *  ``fireScriptedEvents`` has delays that can outlast a test, and
   *  React reconciliation across test boundaries doesn't unsubscribe
   *  the lib/api.ts listener fast enough). */
  hardReset(): void {
    this.sseListeners.length = 0
    this.pendingScript = null
  }

  /** Configure the response stopMachine IPC should return on the next call.
   *
   *  Use this to simulate the new ``forced: true`` path that
   *  ``/api/chat/stop-machine`` returns when the cancellation
   *  broadcast didn't release the lock within 5s and we
   *  force-deleted the Redis key as the fallback. */
  setStopMachineResponse(resp: NonNullable<CoastyFakeOptions['stopMachineResponse']>) {
    this.stopMachineResponse = { ...this.stopMachineResponse, ...resp }
  }

  /** Set up the SSE event sequence that the NEXT chat:send-message
   *  call will emit. Cleared after firing. */
  scriptNextResponse(script: ScriptedResponse) {
    this.pendingScript = script
  }

  /** Build the window.coasty mock surface. */
  build(): any {
    return {
      // ── Auth / session ──
      getSession: vi.fn(async () => ({
        isAuthenticated: true,
        userId: 'user-e2e',
        machineId: 'machine-e2e',
        email: 't@t.t',
        name: 'T',
        avatar: null,
      })),

      // ── Bridge ──
      connectBridge: vi.fn(async () => ({ success: true, machineId: 'machine-e2e' })),
      disconnectBridge: vi.fn(async () => undefined),
      onConnectionStateChanged: vi.fn(() => () => {}),

      // ── Window ──
      setWindowMode: vi.fn(async () => undefined),
      setOpacity: vi.fn(async () => undefined),

      // ── Chat list ──
      listChats: vi.fn(async () => ({ success: true, chats: [] })),
      getChatMessages: vi.fn(async () => ({ success: true, messages: [] })),
      createChat: vi.fn(async () => ({
        success: true,
        chat: { id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, title: 'New Task', model: 'default' },
      })),
      updateChat: vi.fn(async () => ({ success: true })),
      deleteChat: vi.fn(async () => ({ success: true })),

      // ── Busy state pre-check ──
      checkMachineBusy: vi.fn(async (machineId: string) => {
        const owner = this.busyMachines.get(machineId)
        return {
          success: true,
          busy: !!owner,
          ownerChatId: owner ?? null,
        }
      }),

      // ── Stop machine (Override & Run path) ──
      stopMachine: vi.fn(async (machineId: string) => {
        this.stopMachineCallCount += 1
        // Simulate the backend's behaviour: a successful stop releases
        // the lock so the subsequent send isn't busy anymore.
        if (this.stopMachineResponse.released || this.stopMachineResponse.forced) {
          this.busyMachines.delete(machineId)
        }
        return this.stopMachineResponse
      }),

      // ── Chat SSE streaming ──
      sendChatMessage: vi.fn(async (params: any) => {
        this.sendCallCount += 1
        this.capturedSends.push({
          requestId: params.requestId,
          messages: params.messages,
          chatId: params.chatId,
          userId: params.userId,
          machineId: params.machineId,
          model: params.model,
        })
        const script = this.pendingScript
        this.pendingScript = null
        if (script) {
          await this.fireScriptedEvents(params.requestId, script)
        }
        return { success: true }
      }),
      abortChat: vi.fn(async () => {
        this.abortChatCallCount += 1
        return { success: true }
      }),
      onChatSSEEvent: vi.fn((listener: (event: SseEvent) => void) => {
        this.sseListeners.push(listener)
        return () => {
          const i = this.sseListeners.indexOf(listener)
          if (i >= 0) this.sseListeners.splice(i, 1)
        }
      }),

      // ── Misc ──
      reportRendererError: vi.fn(),
      getCredits: vi.fn(async () => ({ success: true, credits: 1000 })),
      isOssMode: vi.fn(async () => false),
      resumeHuman: vi.fn(async () => ({ success: true, resumed: true })),
      selectFiles: vi.fn(async () => ({ success: true, files: [] })),
    }
  }

  /** Fire the scripted SSE events to every currently-registered
   *  listener. Awaits internally so callers can await this to be sure
   *  events have dispatched before assertions run. */
  private async fireScriptedEvents(requestId: string, script: ScriptedResponse) {
    // Yield once so the renderer has time to set up its listener
    // (lib/api.ts registers it BEFORE awaiting sendChatMessage; this
    // yield is defensive).
    await new Promise((r) => setTimeout(r, 0))

    const delay = script.perEventDelayMs ?? 0

    // Text chunks
    if (script.textChunks) {
      for (const chunk of script.textChunks) {
        this.emit({ requestId, type: '0', data: JSON.stringify(chunk) })
        if (delay > 0) await new Promise((r) => setTimeout(r, delay))
      }
    }

    // Reasoning chunks
    if (script.reasoningChunks) {
      for (const r of script.reasoningChunks) {
        this.emit({ requestId, type: 'g', data: JSON.stringify(r) })
        if (delay > 0) await new Promise((r) => setTimeout(r, delay))
      }
    }

    // Tool calls + their results
    if (script.toolCalls) {
      for (const tc of script.toolCalls) {
        this.emit({
          requestId,
          type: '9',
          data: JSON.stringify({
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            args: tc.args,
          }),
        })
        if (delay > 0) await new Promise((r) => setTimeout(r, delay))
        if (tc.result !== undefined) {
          this.emit({
            requestId,
            type: 'a',
            data: JSON.stringify({
              toolCallId: tc.toolCallId,
              result: tc.result,
              frontendScreenshot: tc.frontendScreenshot,
            }),
          })
          if (delay > 0) await new Promise((r) => setTimeout(r, delay))
        }
      }
    }

    // AWAITING_HUMAN pause
    if (script.awaitingHuman) {
      this.emit({
        requestId,
        type: 'h',
        data: JSON.stringify(script.awaitingHuman),
      })
      if (delay > 0) await new Promise((r) => setTimeout(r, delay))
    }

    // Error event
    if (script.error) {
      const errorData = script.error.code === 'MACHINE_BUSY'
        ? {
            code: 'MACHINE_BUSY',
            message: script.error.message,
            machineId: script.error.machineId,
            ownerChatId: script.error.ownerChatId,
          }
        : script.error.message
      this.emit({
        requestId,
        type: '3',
        data: JSON.stringify(errorData),
      })
      if (delay > 0) await new Promise((r) => setTimeout(r, delay))
    }

    // Finish event (default: emit it)
    if (script.emitFinish !== false) {
      this.emit({
        requestId,
        type: 'd',
        data: JSON.stringify({
          finishReason: script.finishReason ?? 'stop',
          content: script.finishContent ?? (script.textChunks?.join('') || ''),
          toolInvocations: script.finishToolInvocations,
        }),
      })
    }
  }

  private emit(event: SseEvent) {
    // Snapshot so a listener-removal during iteration doesn't break us
    for (const listener of [...this.sseListeners]) {
      try {
        listener(event)
      } catch (err) {
        // Listeners shouldn't throw — but if they do, log so the test
        // can diagnose instead of silently swallowing.
        // eslint-disable-next-line no-console
        console.error('[FakeBackend] listener threw', err)
      }
    }
  }
}
