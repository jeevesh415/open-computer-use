/**
 * Tests for ``withTimeout`` / ``TimeoutError`` in lib/api.ts.
 *
 * The helper exists to bound IPC and async calls that the renderer
 * makes against the main process or the chat store — most importantly
 * the ``ensureChat`` call inside useChatSubmit, which on the user's
 * Send-button path must never block the overlay indefinitely.
 *
 * What these tests pin
 * --------------------
 *   - Pass-through semantics on the happy path (resolve + reject both
 *     forward the inner promise's settlement value unchanged).
 *   - TimeoutError is a named, instanceof-checkable class — call sites
 *     branch on it to decide between graceful-degradation paths and
 *     real error surfacing.
 *   - No zombie timers: the setTimeout MUST be cleared whether the
 *     inner promise resolves OR rejects FIRST, so a long-lived
 *     renderer session doesn't accumulate dangling timers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withTimeout, TimeoutError } from './api'

describe('withTimeout', () => {
  it('resolves with the inner value when the promise settles before the deadline', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 1000, 'fast')
    expect(result).toBe('ok')
  })

  it('forwards the inner rejection unchanged when the promise rejects before the deadline', async () => {
    const original = new Error('inner failure')
    await expect(withTimeout(Promise.reject(original), 1000, 'fails')).rejects.toBe(original)
  })

  it('rejects with TimeoutError when the inner promise outlasts the deadline', async () => {
    const hang = new Promise(() => {}) // never resolves
    await expect(withTimeout(hang, 20, 'ensureChat')).rejects.toBeInstanceOf(TimeoutError)
  })

  it('TimeoutError message embeds the operation label and the timeout duration', async () => {
    const hang = new Promise(() => {})
    await expect(withTimeout(hang, 25, 'ensureChat')).rejects.toThrow(
      'ensureChat timed out after 25ms',
    )
  })

  it('TimeoutError.name === "TimeoutError" so consumers can instanceof-check it', async () => {
    const hang = new Promise(() => {})
    try {
      await withTimeout(hang, 10, 'x')
      throw new Error('should not reach here')
    } catch (err) {
      expect(err).toBeInstanceOf(TimeoutError)
      expect((err as Error).name).toBe('TimeoutError')
    }
  })

  describe('timer cleanup', () => {
    let clearSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    })

    afterEach(() => {
      clearSpy.mockRestore()
    })

    it('clears the timer when the inner promise resolves first (no zombie setTimeout)', async () => {
      await withTimeout(Promise.resolve(42), 5000, 'fast')
      // The .finally clears the timer so the 5000ms setTimeout doesn't
      // outlive the call. Without this guarantee a renderer that fires
      // many ensureChat-style calls would accumulate dangling timers
      // until the event loop drained them.
      expect(clearSpy).toHaveBeenCalled()
    })

    it('clears the timer when the inner promise rejects first', async () => {
      await withTimeout(Promise.reject(new Error('boom')), 5000, 'fail').catch(() => {})
      expect(clearSpy).toHaveBeenCalled()
    })
  })

  it('zero-ms timeout rejects effectively immediately', async () => {
    // Edge case: a misconfigured call site passing 0 should not deadlock
    // (the inner promise might never settle). Race must still produce a
    // TimeoutError on the next tick.
    const hang = new Promise(() => {})
    await expect(withTimeout(hang, 0, 'zero')).rejects.toBeInstanceOf(TimeoutError)
  })
})

describe('TimeoutError', () => {
  it('is an Error subclass (instanceof Error)', () => {
    const e = new TimeoutError('op', 100)
    expect(e).toBeInstanceOf(Error)
    expect(e).toBeInstanceOf(TimeoutError)
  })

  it('carries operation + ms in the message verbatim', () => {
    expect(new TimeoutError('ensureChat', 5000).message).toBe(
      'ensureChat timed out after 5000ms',
    )
  })
})
