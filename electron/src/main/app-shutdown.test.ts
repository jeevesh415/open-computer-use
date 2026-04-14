import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────
// vi.hoisted runs before module imports so the mock factories below can
// reference these shared spies.

const h = vi.hoisted(() => ({
  destroyRainbowBorder: vi.fn(),
}))

vi.mock('./rainbow-border', () => ({
  destroyRainbowBorder: h.destroyRainbowBorder,
}))

// We don't need real `electron` — only the Tray type is used, and only as
// a type. Provide a stub so importing `electron` at runtime doesn't crash.
vi.mock('electron', () => ({}))

// ── Imports ───────────────────────────────────────────────────────────

import {
  performFullShutdown,
  isShutdownInProgress,
  __resetShutdownForTests,
  type ShutdownDeps,
} from './app-shutdown'

// ── Test helpers ──────────────────────────────────────────────────────

function makeFakeWsBridge(overrides: Partial<{ disconnect: () => void }> = {}) {
  return {
    disconnect: vi.fn(),
    ...overrides,
  } as any
}

function makeFakeAuth(overrides: Partial<{ dispose: () => void }> = {}) {
  return {
    dispose: vi.fn(),
    ...overrides,
  } as any
}

function makeFakeTray(overrides: Partial<{ isDestroyed: () => boolean; destroy: () => void }> = {}) {
  return {
    isDestroyed: vi.fn(() => false),
    destroy: vi.fn(),
    ...overrides,
  } as any
}

function makeDeps(partial: Partial<ShutdownDeps> = {}): ShutdownDeps {
  return {
    wsBridge: makeFakeWsBridge(),
    auth: makeFakeAuth(),
    tray: makeFakeTray(),
    ...partial,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('performFullShutdown', () => {
  beforeEach(() => {
    __resetShutdownForTests()
    vi.clearAllMocks()
  })

  describe('resource teardown', () => {
    it('disconnects the ws bridge', () => {
      const deps = makeDeps()
      performFullShutdown(deps)
      expect(deps.wsBridge!.disconnect).toHaveBeenCalledTimes(1)
    })

    it('destroys the rainbow border window', () => {
      performFullShutdown(makeDeps())
      expect(h.destroyRainbowBorder).toHaveBeenCalledTimes(1)
    })

    it('disposes the auth manager', () => {
      const deps = makeDeps()
      performFullShutdown(deps)
      expect(deps.auth!.dispose).toHaveBeenCalledTimes(1)
    })

    it('destroys the tray', () => {
      const deps = makeDeps()
      performFullShutdown(deps)
      expect(deps.tray!.destroy).toHaveBeenCalledTimes(1)
    })

    it('tears down every resource in a single call', () => {
      const deps = makeDeps()
      performFullShutdown(deps)

      expect(deps.wsBridge!.disconnect).toHaveBeenCalled()
      expect(h.destroyRainbowBorder).toHaveBeenCalled()
      expect(deps.auth!.dispose).toHaveBeenCalled()
      expect(deps.tray!.destroy).toHaveBeenCalled()
    })
  })

  describe('critical fix: rainbow border is always destroyed', () => {
    it('destroys the rainbow border even when every other dep is null', () => {
      // This is the core bug this module exists to fix. Even a barebones
      // shutdown must reach destroyRainbowBorder so `window-all-closed` can
      // fire and the process can actually exit.
      performFullShutdown({ wsBridge: null, auth: null, tray: null })
      expect(h.destroyRainbowBorder).toHaveBeenCalledTimes(1)
    })

    it('destroys the rainbow border even when ws bridge throws', () => {
      const deps = makeDeps({
        wsBridge: makeFakeWsBridge({
          disconnect: vi.fn(() => { throw new Error('socket already closed') }),
        }),
      })
      performFullShutdown(deps)
      expect(h.destroyRainbowBorder).toHaveBeenCalledTimes(1)
    })

    it('destroys the rainbow border even when auth.dispose throws', () => {
      const deps = makeDeps({
        auth: makeFakeAuth({
          dispose: vi.fn(() => { throw new Error('boom') }),
        }),
      })
      performFullShutdown(deps)
      expect(h.destroyRainbowBorder).toHaveBeenCalledTimes(1)
    })
  })

  describe('idempotency', () => {
    it('only tears down resources on the first call', () => {
      const deps = makeDeps()
      performFullShutdown(deps)
      performFullShutdown(deps)
      performFullShutdown(deps)

      expect(deps.wsBridge!.disconnect).toHaveBeenCalledTimes(1)
      expect(h.destroyRainbowBorder).toHaveBeenCalledTimes(1)
      expect(deps.auth!.dispose).toHaveBeenCalledTimes(1)
      expect(deps.tray!.destroy).toHaveBeenCalledTimes(1)
    })

    it('reports shutdown in progress after the first call', () => {
      expect(isShutdownInProgress()).toBe(false)
      performFullShutdown(makeDeps())
      expect(isShutdownInProgress()).toBe(true)
    })

    it('__resetShutdownForTests clears the in-progress flag', () => {
      performFullShutdown(makeDeps())
      expect(isShutdownInProgress()).toBe(true)
      __resetShutdownForTests()
      expect(isShutdownInProgress()).toBe(false)
    })

    it('after reset, the next call tears down again', () => {
      const deps1 = makeDeps()
      performFullShutdown(deps1)
      expect(h.destroyRainbowBorder).toHaveBeenCalledTimes(1)

      __resetShutdownForTests()

      const deps2 = makeDeps()
      performFullShutdown(deps2)
      expect(h.destroyRainbowBorder).toHaveBeenCalledTimes(2)
      expect(deps2.wsBridge!.disconnect).toHaveBeenCalledTimes(1)
    })
  })

  describe('null / missing dependencies', () => {
    it('handles a null wsBridge', () => {
      expect(() => performFullShutdown(makeDeps({ wsBridge: null }))).not.toThrow()
      expect(h.destroyRainbowBorder).toHaveBeenCalled()
    })

    it('handles a null auth', () => {
      expect(() => performFullShutdown(makeDeps({ auth: null }))).not.toThrow()
      expect(h.destroyRainbowBorder).toHaveBeenCalled()
    })

    it('handles a null tray', () => {
      expect(() => performFullShutdown(makeDeps({ tray: null }))).not.toThrow()
      expect(h.destroyRainbowBorder).toHaveBeenCalled()
    })

    it('handles all deps null at once', () => {
      expect(() => {
        performFullShutdown({ wsBridge: null, auth: null, tray: null })
      }).not.toThrow()
      expect(h.destroyRainbowBorder).toHaveBeenCalledTimes(1)
    })
  })

  describe('tray edge cases', () => {
    it('skips destroy() when tray is already destroyed', () => {
      const destroy = vi.fn()
      const deps = makeDeps({
        tray: makeFakeTray({
          isDestroyed: vi.fn(() => true),
          destroy,
        }),
      })
      performFullShutdown(deps)
      expect(destroy).not.toHaveBeenCalled()
    })

    it('continues if tray.destroy throws', () => {
      const deps = makeDeps({
        tray: makeFakeTray({
          destroy: vi.fn(() => { throw new Error('tray already gone') }),
        }),
      })
      expect(() => performFullShutdown(deps)).not.toThrow()
      expect(h.destroyRainbowBorder).toHaveBeenCalled()
      expect(deps.auth!.dispose).toHaveBeenCalled()
    })
  })

  describe('error isolation', () => {
    it('one dep throwing does not prevent other deps from being torn down', () => {
      const destroyRainbowSpy = h.destroyRainbowBorder
      destroyRainbowSpy.mockImplementationOnce(() => {
        throw new Error('rainbow destroy crashed')
      })

      const deps = makeDeps()
      expect(() => performFullShutdown(deps)).not.toThrow()

      // Everything after rainbow still ran
      expect(deps.wsBridge!.disconnect).toHaveBeenCalled()
      expect(deps.auth!.dispose).toHaveBeenCalled()
      expect(deps.tray!.destroy).toHaveBeenCalled()
    })

    it('multiple deps throwing are all absorbed', () => {
      h.destroyRainbowBorder.mockImplementationOnce(() => { throw new Error('a') })
      const deps = makeDeps({
        wsBridge: makeFakeWsBridge({ disconnect: vi.fn(() => { throw new Error('b') }) }),
        auth: makeFakeAuth({ dispose: vi.fn(() => { throw new Error('c') }) }),
        tray: makeFakeTray({ destroy: vi.fn(() => { throw new Error('d') }) }),
      })

      expect(() => performFullShutdown(deps)).not.toThrow()

      expect(deps.wsBridge!.disconnect).toHaveBeenCalled()
      expect(h.destroyRainbowBorder).toHaveBeenCalled()
      expect(deps.auth!.dispose).toHaveBeenCalled()
      expect(deps.tray!.destroy).toHaveBeenCalled()
    })
  })

  describe('teardown order', () => {
    it('disconnects ws bridge BEFORE destroying rainbow border', () => {
      // Rationale: ws bridge's disconnect path calls stopRainbow() on the
      // border. If we destroyed the rainbow first, stopRainbow would run on
      // a freshly-null window — harmless but noisy. Doing ws first avoids
      // that entirely.
      const calls: string[] = []
      const deps = makeDeps({
        wsBridge: makeFakeWsBridge({
          disconnect: vi.fn(() => { calls.push('ws') }),
        }),
      })
      h.destroyRainbowBorder.mockImplementationOnce(() => { calls.push('rainbow') })

      performFullShutdown(deps)

      expect(calls).toEqual(['ws', 'rainbow'])
    })

    it('tears down in the documented order: ws → rainbow → auth → tray', () => {
      const calls: string[] = []
      const deps = makeDeps({
        wsBridge: makeFakeWsBridge({
          disconnect: vi.fn(() => { calls.push('ws') }),
        }),
        auth: makeFakeAuth({
          dispose: vi.fn(() => { calls.push('auth') }),
        }),
        tray: makeFakeTray({
          destroy: vi.fn(() => { calls.push('tray') }),
        }),
      })
      h.destroyRainbowBorder.mockImplementationOnce(() => { calls.push('rainbow') })

      performFullShutdown(deps)

      expect(calls).toEqual(['ws', 'rainbow', 'auth', 'tray'])
    })
  })
})
