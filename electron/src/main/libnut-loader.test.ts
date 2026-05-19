/**
 * Tests for the libnut platform loader.
 *
 * Vitest's `vi.mock` is hoisted and the factory runs once per test file —
 * it does NOT re-run on `vi.resetModules()`. That means dynamic-require
 * counters are unreliable. Instead, we test the loader's OBSERVABLE
 * contract: it returns a usable binding when one's available, throws a
 * clear error when not, and refuses to load on Wayland.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// We mock all three platform packages with a stable shape. Whichever one
// the loader resolves for the current platform will return this object.
const fakeBinding = {
  setKeyboardDelay: () => {}, setMouseDelay: () => {},
  keyTap: () => {}, keyToggle: () => {},
  typeString: () => {}, typeStringDelayed: () => {},
  moveMouse: () => {}, moveMouseSmooth: () => {},
  mouseClick: () => {}, mouseToggle: () => {},
  dragMouse: () => {}, scrollMouse: () => {},
  getMousePos: () => ({ x: 0, y: 0 }),
  getScreenSize: () => ({ width: 1920, height: 1080 }),
}
vi.mock('@nut-tree-fork/libnut-win32', () => fakeBinding)
vi.mock('@nut-tree-fork/libnut-darwin', () => fakeBinding)
vi.mock('@nut-tree-fork/libnut-linux', () => fakeBinding)

describe('libnut-loader', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns a binding with the expected shape on the current platform', async () => {
    const { loadLibnut } = await import('./libnut-loader')
    const libnut = loadLibnut()

    expect(libnut).toBeTruthy()
    expect(typeof libnut.moveMouse).toBe('function')
    expect(typeof libnut.mouseClick).toBe('function')
    expect(typeof libnut.keyTap).toBe('function')
    expect(typeof libnut.typeString).toBe('function')
    expect(typeof libnut.scrollMouse).toBe('function')
    expect(typeof libnut.mouseToggle).toBe('function')
  })

  it('caches the binding — repeated callers receive the SAME object', async () => {
    const { loadLibnut } = await import('./libnut-loader')
    const a = loadLibnut()
    const b = loadLibnut()
    const c = loadLibnut()
    expect(b).toBe(a)
    expect(c).toBe(a)
  })

  it('refuses to load on Linux Wayland sessions', async () => {
    if (process.platform !== 'linux') return  // skip on non-Linux

    const original = process.env.XDG_SESSION_TYPE
    process.env.XDG_SESSION_TYPE = 'wayland'
    try {
      const { loadLibnut } = await import('./libnut-loader')
      expect(() => loadLibnut()).toThrow(/Wayland/i)
    } finally {
      if (original === undefined) delete process.env.XDG_SESSION_TYPE
      else process.env.XDG_SESSION_TYPE = original
    }
  })

  it('does NOT refuse on X11 / Xorg sessions on Linux', async () => {
    if (process.platform !== 'linux') return

    const original = process.env.XDG_SESSION_TYPE
    process.env.XDG_SESSION_TYPE = 'x11'
    try {
      const { loadLibnut } = await import('./libnut-loader')
      expect(() => loadLibnut()).not.toThrow()
    } finally {
      if (original === undefined) delete process.env.XDG_SESSION_TYPE
      else process.env.XDG_SESSION_TYPE = original
    }
  })

  it('treats missing XDG_SESSION_TYPE as non-Wayland (don\'t break old setups)', async () => {
    if (process.platform !== 'linux') return

    const original = process.env.XDG_SESSION_TYPE
    delete process.env.XDG_SESSION_TYPE
    try {
      const { loadLibnut } = await import('./libnut-loader')
      expect(() => loadLibnut()).not.toThrow()
    } finally {
      if (original !== undefined) process.env.XDG_SESSION_TYPE = original
    }
  })

  it('XDG_SESSION_TYPE check is case-insensitive', async () => {
    if (process.platform !== 'linux') return

    const original = process.env.XDG_SESSION_TYPE
    process.env.XDG_SESSION_TYPE = 'WAYLAND'  // uppercase
    try {
      const { loadLibnut } = await import('./libnut-loader')
      expect(() => loadLibnut()).toThrow(/Wayland/i)
    } finally {
      if (original === undefined) delete process.env.XDG_SESSION_TYPE
      else process.env.XDG_SESSION_TYPE = original
    }
  })

  it('Wayland detection only applies to Linux (Windows / macOS unaffected)', async () => {
    if (process.platform === 'linux') return  // skip on Linux

    // Set the env var anyway — must be ignored on win32 / darwin
    const original = process.env.XDG_SESSION_TYPE
    process.env.XDG_SESSION_TYPE = 'wayland'
    try {
      const { loadLibnut } = await import('./libnut-loader')
      expect(() => loadLibnut()).not.toThrow()
    } finally {
      if (original === undefined) delete process.env.XDG_SESSION_TYPE
      else process.env.XDG_SESSION_TYPE = original
    }
  })

  it('_resetLoader does not throw — clears cache for test isolation', async () => {
    const mod = await import('./libnut-loader')
    mod.loadLibnut()
    expect(() => mod._resetLoader()).not.toThrow()
    // After reset, loadLibnut still works (we get a binding back, possibly
    // the same cached require result — that's fine for behavioural tests)
    expect(() => mod.loadLibnut()).not.toThrow()
  })
})
