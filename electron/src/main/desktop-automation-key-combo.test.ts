/**
 * Regression coverage for the 2026-05-14 macOS Spotlight incident
 * (`key_combo failed: Unsupported key: "command+space"`).
 *
 * ─── What this file is defending ─────────────────────────────────────────
 * The backend agent's system prompt instructs the model to emit
 * `agent.hotkey("ctrl+c")` — a SINGLE +-separated string. The action-bridge
 * regex in `backend/app/services/cua_action_bridge.py` extracts the
 * quoted string verbatim and ships it to Electron as:
 *
 *     { command: 'key_combo', parameters: { keys: ["command+space"] } }
 *
 * Pre-fix, `toLibnutKey("command+space")` threw
 *   "Unsupported key for automation: command+space"
 * and the agent's Spotlight invocation silently failed in production.
 *
 * This suite ensures the chord splitting in `expandChordKeys()` is correct
 * across every input shape we have seen in the wild + every macOS chord
 * the agent might plausibly emit, and that the routing into libnut keeps
 * the historical contract (last key = trigger, leading keys = modifiers).
 *
 * Sections:
 *   A: expandChordKeys() — pure parser, every input shape
 *   B: desktopKeyCombo  — end-to-end through libnut mock
 *   C: desktopKeyPress  — auto-routes to combo if input is chord-shaped
 *   D: macOS shortcut sweep — every documented system shortcut works
 *   E: 2026-05-14 incident replay — the exact production reproducers
 *   F: Anti-drift source guards — fails CI if the regression returns
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// ─── Mocks: identical setup to desktop-automation.test.ts ────────────────

const libnutMock = {
  setKeyboardDelay: vi.fn(),
  keyTap: vi.fn(),
  keyToggle: vi.fn(),
  typeString: vi.fn(),
  typeStringDelayed: vi.fn(),
  setMouseDelay: vi.fn(),
  moveMouse: vi.fn(),
  moveMouseSmooth: vi.fn(),
  mouseClick: vi.fn(),
  mouseToggle: vi.fn(),
  dragMouse: vi.fn(),
  scrollMouse: vi.fn(),
  getMousePos: vi.fn(() => ({ x: 0, y: 0 })),
  getScreenSize: vi.fn(() => ({ width: 1920, height: 1080 })),
}

vi.mock('./libnut-loader', () => ({
  loadLibnut: () => libnutMock,
}))

vi.mock('./permissions', () => ({
  isAccessibilityGranted: () => true,
  requestAccessibility: vi.fn(),
}))

vi.mock('./error-reporter', () => ({
  reportError: vi.fn(),
  reportWarn: vi.fn(),
  reportInfo: vi.fn(),
  errorReporter: {
    init: vi.fn(),
    setIdentity: vi.fn(),
    setWebSocketSink: vi.fn(),
    reportError: vi.fn(),
  },
}))

vi.mock('./display-manager', () => ({
  getActiveDisplay: () => ({
    id: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    workAreaSize: { width: 1920, height: 1040 },
    size: { width: 1920, height: 1080 },
    scaleFactor: 1.0,
  }),
}))

vi.mock('child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: any, cb: Function) => {
    cb(null, '', '')
  }),
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    stdin: { write: vi.fn(), end: vi.fn() },
    on: vi.fn((event: string, cb: Function) => {
      if (event === 'close') setTimeout(() => cb(0), 0)
    }),
  })),
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
}))

const da = await import('./desktop-automation')

beforeEach(() => {
  Object.values(libnutMock).forEach((fn) => {
    if (typeof (fn as any).mockClear === 'function') (fn as any).mockClear()
  })
})

// ─── A: expandChordKeys() — pure parser ──────────────────────────────────

describe('expandChordKeys (pure parser)', () => {
  const fn = (da as any).expandChordKeys as (input: unknown) => string[]

  it('exists and is exported', () => {
    expect(typeof fn).toBe('function')
  })

  it('passes through already-split arrays unchanged', () => {
    expect(fn(['ctrl', 'c'])).toEqual(['ctrl', 'c'])
    expect(fn(['cmd', 'shift', 'a'])).toEqual(['cmd', 'shift', 'a'])
    expect(fn(['command', 'space'])).toEqual(['command', 'space'])
  })

  it('splits a single +-separated string element (the 2026-05-14 bug shape)', () => {
    expect(fn(['command+space'])).toEqual(['command', 'space'])
    expect(fn(['ctrl+c'])).toEqual(['ctrl', 'c'])
    expect(fn(['cmd+v'])).toEqual(['cmd', 'v'])
  })

  it('splits multi-modifier chords', () => {
    expect(fn(['cmd+shift+a'])).toEqual(['cmd', 'shift', 'a'])
    expect(fn(['cmd+option+esc'])).toEqual(['cmd', 'option', 'esc'])
    expect(fn(['ctrl+alt+delete'])).toEqual(['ctrl', 'alt', 'delete'])
    expect(fn(['cmd+shift+3'])).toEqual(['cmd', 'shift', '3'])
    expect(fn(['cmd+shift+4'])).toEqual(['cmd', 'shift', '4'])
    expect(fn(['cmd+shift+5'])).toEqual(['cmd', 'shift', '5'])
  })

  it('tolerates whitespace around the + delimiter', () => {
    expect(fn(['ctrl + c'])).toEqual(['ctrl', 'c'])
    expect(fn(['cmd +shift+ a'])).toEqual(['cmd', 'shift', 'a'])
    expect(fn(['  cmd + space  '])).toEqual(['cmd', 'space'])
  })

  it('accepts a bare string (not an array)', () => {
    expect(fn('ctrl+c')).toEqual(['ctrl', 'c'])
    expect(fn('command+space')).toEqual(['command', 'space'])
    expect(fn('enter')).toEqual(['enter'])
  })

  it('flattens nested arrays defensively', () => {
    expect(fn([['cmd', 'shift'], 'a'])).toEqual(['cmd', 'shift', 'a'])
    expect(fn([['cmd+shift'], 'a'])).toEqual(['cmd', 'shift', 'a'])
  })

  it('mixes split and unsplit forms in a single array', () => {
    expect(fn(['shift', 'a+b'])).toEqual(['shift', 'a', 'b'])
    expect(fn(['cmd+shift', 'a'])).toEqual(['cmd', 'shift', 'a'])
  })

  it('drops empty fragments produced by trailing/leading +', () => {
    expect(fn(['ctrl+'])).toEqual(['ctrl'])
    expect(fn(['+c'])).toEqual(['c'])
    expect(fn(['ctrl++c'])).toEqual(['ctrl', 'c'])
  })

  it('preserves single-character "+" as a key (atomic)', () => {
    // A standalone "+" of length 1 must be preserved — it's the "+" key,
    // not a delimiter. Atomic short-circuit guarantees this.
    expect(fn(['+'])).toEqual(['+'])
    expect(fn('+')).toEqual(['+'])
  })

  it('preserves single-character punctuation', () => {
    // Many macOS shortcuts use punctuation as the trigger (cmd+,, cmd+/,
    // cmd+;, etc.). Each must survive without being interpreted as a
    // separator.
    expect(fn([','])).toEqual([','])
    expect(fn(['/'])).toEqual(['/'])
    expect(fn([';'])).toEqual([';'])
    expect(fn(['['])).toEqual(['['])
    expect(fn([']'])).toEqual([']'])
  })

  it('preserves multi-char keys that don\'t contain +', () => {
    expect(fn(['pageup'])).toEqual(['pageup'])
    expect(fn(['page_up'])).toEqual(['page_up'])
    expect(fn(['arrowleft'])).toEqual(['arrowleft'])
    expect(fn(['printscreen'])).toEqual(['printscreen'])
  })

  it('handles non-string / null / undefined inputs gracefully', () => {
    expect(fn(null)).toEqual([])
    expect(fn(undefined)).toEqual([])
    expect(fn([])).toEqual([])
    expect(fn([null, undefined, 'a'])).toEqual(['a'])
    expect(fn([42 as any, 'b'])).toEqual(['b'])
    expect(fn([''])).toEqual([])
    expect(fn(['', 'a', ''])).toEqual(['a'])
  })

  it('does not lowercase or otherwise normalise (downstream layers do that)', () => {
    // The map lookup is case-insensitive, but expandChordKeys is a
    // pure parser — it does not modify casing.
    expect(fn(['Cmd+Shift+A'])).toEqual(['Cmd', 'Shift', 'A'])
    expect(fn(['CTRL+C'])).toEqual(['CTRL', 'C'])
  })

  it('handles agent emitting just a comma as a key (cmd+,)', () => {
    // Two forms the agent might emit for "open preferences":
    //   keys: ['cmd', ',']    — already split
    //   keys: ['cmd+,']       — combined
    // Both should yield ['cmd', ','].
    expect(fn(['cmd', ','])).toEqual(['cmd', ','])
    expect(fn(['cmd+,'])).toEqual(['cmd', ','])
  })

  it('matches the agent prompt example forms', () => {
    // From backend/app/services/cua_remote_env.py and system_memory.py:
    //   agent.hotkey("enter")     → 'enter'
    //   agent.hotkey("ctrl+c")    → ['ctrl', 'c']
    //   agent.hotkey('command+space') → ['command', 'space']
    expect(fn(['enter'])).toEqual(['enter'])
    expect(fn(['ctrl+c'])).toEqual(['ctrl', 'c'])
    expect(fn(['command+space'])).toEqual(['command', 'space'])
  })
})

// ─── B: desktopKeyCombo end-to-end ───────────────────────────────────────

describe('desktopKeyCombo with chord-string inputs', () => {
  it('the 2026-05-14 reproducer: ["command+space"] reaches libnut as keyTap("space", "cmd"|"win")', async () => {
    const result = await da.desktopKeyCombo({ keys: ['command+space'] })
    expect(result.success).toBe(true)
    expect(libnutMock.keyTap).toHaveBeenCalledTimes(1)
    const [key, mod] = libnutMock.keyTap.mock.calls[0]
    expect(key).toBe('space')
    if (process.platform === 'darwin') {
      expect(mod).toBe('cmd')
    } else {
      // On non-darwin, `command` maps to `win` for parity (Win key)
      expect(mod).toBe('win')
    }
  })

  it('["ctrl+c"] → keyTap("c", "control"|"cmd")', async () => {
    const result = await da.desktopKeyCombo({ keys: ['ctrl+c'] })
    expect(result.success).toBe(true)
    const [key, mod] = libnutMock.keyTap.mock.calls[0]
    expect(key).toBe('c')
    if (process.platform === 'darwin') {
      // MAC_KEY_NORMALIZATION rule: ctrl→cmd on macOS for parity with what
      // users actually mean ("the copy shortcut").
      expect(mod).toBe('cmd')
    } else {
      expect(mod).toBe('control')
    }
  })

  it('["cmd+shift+a"] → keyTap("a", ["cmd"|..., "shift"])', async () => {
    const result = await da.desktopKeyCombo({ keys: ['cmd+shift+a'] })
    expect(result.success).toBe(true)
    const [key, mods] = libnutMock.keyTap.mock.calls[0]
    expect(key).toBe('a')
    expect(Array.isArray(mods)).toBe(true)
    expect(mods.length).toBe(2)
    expect(mods).toContain('shift')
    if (process.platform === 'darwin') {
      expect(mods).toContain('cmd')
    } else {
      expect(mods).toContain('win')
    }
  })

  it('mixed input ["shift", "a+b"] → keyTap("b", "shift") then routes correctly', async () => {
    // shift, a, b → modifiers=['shift', 'a'], finalKey='b'.
    // 'a' is not a modifier name so it will be passed verbatim to libnut's
    // modifier list (libnut's keyTap modifier param is permissive).
    const result = await da.desktopKeyCombo({ keys: ['shift', 'a+b'] })
    expect(result.success).toBe(true)
    const [key] = libnutMock.keyTap.mock.calls[0]
    expect(key).toBe('b')
  })

  it('bare string param "cmd+space" works equivalently to ["cmd+space"]', async () => {
    const result = await da.desktopKeyCombo({ keys: 'cmd+space' as any })
    expect(result.success).toBe(true)
    expect(libnutMock.keyTap).toHaveBeenCalledTimes(1)
    const [key] = libnutMock.keyTap.mock.calls[0]
    expect(key).toBe('space')
  })

  it('single-key chord still routes through key_press path', async () => {
    const result = await da.desktopKeyCombo({ keys: ['enter'] })
    expect(result.success).toBe(true)
    expect(libnutMock.keyTap).toHaveBeenCalledTimes(1)
    // No modifier param when delegating to key_press
    expect(libnutMock.keyTap.mock.calls[0]).toEqual(['enter'])
  })

  it('empty input fails with descriptive error', async () => {
    const result = await da.desktopKeyCombo({ keys: [] })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/no keys/i)
  })

  it('empty string after expansion fails with descriptive error', async () => {
    // expandChordKeys drops empty tokens entirely; expansion of [''] is []
    // which then hits the "No keys specified" branch.
    const result = await da.desktopKeyCombo({ keys: [''] })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/no keys/i)
  })

  it('return message stringifies the expanded keys', async () => {
    const result = await da.desktopKeyCombo({ keys: ['cmd+shift+a'] })
    expect(result.message).toContain('cmd')
    expect(result.message).toContain('shift')
    expect(result.message).toContain('a')
  })
})

// ─── C: desktopKeyPress auto-routes to combo for chord-shaped input ──────

describe('desktopKeyPress auto-routes chord-shaped input to desktopKeyCombo', () => {
  it('agent calls key_press with ["ctrl+c"] — still works as a chord', async () => {
    // Defensive: if the agent mis-routes a chord to key_press, the chord
    // should still trigger, not get pressed as discrete keys.
    const result = await da.desktopKeyPress({ keys: ['ctrl+c'] })
    expect(result.success).toBe(true)
    expect(libnutMock.keyTap).toHaveBeenCalledTimes(1)
    const [key, mod] = libnutMock.keyTap.mock.calls[0]
    expect(key).toBe('c')
    expect(mod).toBeTruthy()  // some modifier was passed
  })

  it('agent calls key_press with bare string "command+space" — also re-routes', async () => {
    const result = await da.desktopKeyPress({ keys: 'command+space' as any })
    expect(result.success).toBe(true)
    const [key] = libnutMock.keyTap.mock.calls[0]
    expect(key).toBe('space')
  })

  it('plain sequential key press still works (no chord re-route)', async () => {
    // ['tab', 'tab', 'enter'] — three discrete presses, NOT a chord.
    const result = await da.desktopKeyPress({ keys: ['tab', 'tab', 'enter'] })
    expect(result.success).toBe(true)
    expect(libnutMock.keyTap).toHaveBeenCalledTimes(3)
    expect(libnutMock.keyTap.mock.calls[0]).toEqual(['tab'])
    expect(libnutMock.keyTap.mock.calls[1]).toEqual(['tab'])
    expect(libnutMock.keyTap.mock.calls[2]).toEqual(['enter'])
  })

  it('single-key press is unchanged (one keyTap, no modifier)', async () => {
    const result = await da.desktopKeyPress({ keys: ['enter'] })
    expect(result.success).toBe(true)
    expect(libnutMock.keyTap).toHaveBeenCalledTimes(1)
    expect(libnutMock.keyTap.mock.calls[0]).toEqual(['enter'])
  })
})

// ─── D: macOS shortcut sweep ─────────────────────────────────────────────

describe('macOS chord coverage sweep', () => {
  // Every shortcut in this sweep is one the agent's system prompt
  // (system_memory.py) tells the model to use. Each must produce a
  // valid libnut.keyTap call. We assert success + that keyTap was called
  // exactly once with a finite final-key string and a non-empty modifier
  // value.
  const macShortcuts: Array<[string, string]> = [
    ['cmd+space',       'Spotlight search'],
    ['command+space',   'Spotlight (full word)'],
    ['cmd+tab',         'App switcher'],
    ['cmd+`',           'Cycle windows within app'],
    ['cmd+w',           'Close window'],
    ['cmd+q',           'Quit app'],
    ['cmd+,',           'Open preferences'],
    ['cmd+/',           'Help menu'],
    ['cmd+;',           'Spelling next'],
    ['cmd+m',           'Minimize window'],
    ['cmd+h',           'Hide app'],
    ['cmd+t',           'New tab'],
    ['cmd+l',           'Focus URL bar'],
    ['cmd+r',           'Reload page'],
    ['cmd+c',           'Copy'],
    ['cmd+v',           'Paste'],
    ['cmd+x',           'Cut'],
    ['cmd+a',           'Select all'],
    ['cmd+z',           'Undo'],
    ['cmd+s',           'Save'],
    ['cmd+f',           'Find'],
    ['cmd+left',        'Beginning of line'],
    ['cmd+right',       'End of line'],
    ['cmd+up',          'Top of doc'],
    ['cmd+down',        'Bottom of doc'],
    ['option+left',     'Word left'],
    ['option+right',    'Word right'],
    ['cmd+[',           'Browser back'],
    ['cmd+]',           'Browser forward'],
    ['cmd+shift+3',     'Full screenshot'],
    ['cmd+shift+4',     'Region screenshot'],
    ['cmd+shift+5',     'Screenshot menu'],
    ['cmd+option+esc',  'Force quit menu'],
    ['cmd+shift+t',     'Reopen closed tab'],
    ['cmd+option+i',    'Open Web Inspector'],
    ['cmd+\\',          'Custom shortcut using backslash'],
  ]

  for (const [chord, label] of macShortcuts) {
    it(`accepts macOS chord ${chord} (${label})`, async () => {
      libnutMock.keyTap.mockClear()
      const result = await da.desktopKeyCombo({ keys: [chord] })
      expect(result.success, `chord ${chord} failed: ${result.error}`).toBe(true)
      expect(libnutMock.keyTap).toHaveBeenCalledTimes(1)
      const [key, modOrMods] = libnutMock.keyTap.mock.calls[0]
      expect(typeof key).toBe('string')
      expect(key.length).toBeGreaterThan(0)
      // modOrMods is either a string (one modifier) or array (multi).
      if (Array.isArray(modOrMods)) {
        expect(modOrMods.length).toBeGreaterThanOrEqual(1)
        for (const m of modOrMods) expect(typeof m).toBe('string')
      } else {
        expect(typeof modOrMods).toBe('string')
        expect(modOrMods.length).toBeGreaterThan(0)
      }
    })
  }

  it('cmd+space final key is "space" and modifier is platform-correct', async () => {
    libnutMock.keyTap.mockClear()
    await da.desktopKeyCombo({ keys: ['cmd+space'] })
    const [key, mod] = libnutMock.keyTap.mock.calls[0]
    expect(key).toBe('space')
    if (process.platform === 'darwin') {
      expect(mod).toBe('cmd')
    } else {
      expect(mod).toBe('win')
    }
  })

  it('cmd+, final key is "," (comma survives splitting)', async () => {
    libnutMock.keyTap.mockClear()
    await da.desktopKeyCombo({ keys: ['cmd+,'] })
    const [key] = libnutMock.keyTap.mock.calls[0]
    expect(key).toBe(',')
  })

  it('cmd+shift+3 final key is "3" with two modifiers', async () => {
    libnutMock.keyTap.mockClear()
    await da.desktopKeyCombo({ keys: ['cmd+shift+3'] })
    const [key, mods] = libnutMock.keyTap.mock.calls[0]
    expect(key).toBe('3')
    expect(Array.isArray(mods)).toBe(true)
    expect(mods.length).toBe(2)
  })

  it('cmd+option+esc final key is "esc" / "escape" with two modifiers', async () => {
    libnutMock.keyTap.mockClear()
    await da.desktopKeyCombo({ keys: ['cmd+option+esc'] })
    const [key, mods] = libnutMock.keyTap.mock.calls[0]
    expect(key).toBe('escape')  // 'esc' translates to 'escape' via map
    expect(Array.isArray(mods)).toBe(true)
    expect(mods.length).toBe(2)
  })
})

// ─── E: 2026-05-14 incident replay ───────────────────────────────────────

describe('2026-05-14 incident replay: command+space silent failure', () => {
  // CloudWatch payload from the incident:
  //   { component: 'desktop_automation',
  //     message: 'key_combo failed: Unsupported key: "command+space"',
  //     params: { keys: ["command+space"] },
  //     platform: 'darwin' }
  //
  // These tests reproduce the EXACT input and assert it now succeeds.

  it('the literal incident payload now succeeds', async () => {
    const result = await da.desktopKeyCombo({
      keys: ['command+space'],
    })
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('does NOT produce "Unsupported key" for the incident payload', async () => {
    const result = await da.desktopKeyCombo({
      keys: ['command+space'],
    })
    if (result.error) {
      expect(result.error).not.toMatch(/unsupported key/i)
      expect(result.error).not.toMatch(/command\+space/)
    }
  })

  it('libnut receives platform-correct args, not the combined token', async () => {
    libnutMock.keyTap.mockClear()
    await da.desktopKeyCombo({ keys: ['command+space'] })
    expect(libnutMock.keyTap).toHaveBeenCalledTimes(1)
    const [key, mod] = libnutMock.keyTap.mock.calls[0]
    // The combined "command+space" token must NEVER reach libnut intact.
    expect(key).not.toContain('+')
    if (typeof mod === 'string') {
      expect(mod).not.toContain('+')
    }
  })

  it('also works through desktopKeyPress (defensive routing)', async () => {
    // If the agent or backend mis-routes a chord to key_press instead of
    // key_combo, the fix still triggers a chord rather than discrete keys.
    libnutMock.keyTap.mockClear()
    const result = await da.desktopKeyPress({
      keys: ['command+space'],
    })
    expect(result.success).toBe(true)
    expect(libnutMock.keyTap).toHaveBeenCalledTimes(1)
    const [key] = libnutMock.keyTap.mock.calls[0]
    expect(key).toBe('space')
  })
})

// ─── F: Anti-drift source guards ─────────────────────────────────────────

describe('source-level anti-drift guards for key_combo fix', () => {
  const SRC_PATH = path.join(__dirname, 'desktop-automation.ts')
  const src = fs.readFileSync(SRC_PATH, 'utf-8')

  it('expandChordKeys is defined and exported', () => {
    expect(src).toMatch(/export\s+function\s+expandChordKeys\s*\(/)
  })

  it('desktopKeyCombo calls expandChordKeys before reading the array length', () => {
    // Without this guard, a future refactor could move the empty-check
    // before expansion and silently regress the [''] → empty handling.
    const comboFn = src.match(/export\s+async\s+function\s+desktopKeyCombo[\s\S]*?^}/m)?.[0] ?? ''
    expect(comboFn).toBeTruthy()
    const expandIdx = comboFn.indexOf('expandChordKeys(')
    const lengthIdx = comboFn.indexOf('keys.length === 0')
    expect(expandIdx).toBeGreaterThan(0)
    expect(lengthIdx).toBeGreaterThan(expandIdx)
  })

  it('desktopKeyPress also expands its input', () => {
    const pressFn = src.match(/export\s+async\s+function\s+desktopKeyPress[\s\S]*?^}/m)?.[0] ?? ''
    expect(pressFn).toBeTruthy()
    expect(pressFn).toContain('expandChordKeys(')
  })

  it('the modifier set still recognises both ctrl and cmd', () => {
    // Drift defence: someone could remove cmd / command from MODIFIER_NAMES
    // thinking the synonyms cover it. Both must remain.
    expect(src).toMatch(/['"]cmd['"]/)
    expect(src).toMatch(/['"]command['"]/)
    expect(src).toMatch(/['"]ctrl['"]/)
    expect(src).toMatch(/['"]control['"]/)
  })

  it('the darwin remap still routes ctrl→cmd', () => {
    // This is the legacy MAC_KEY_NORMALIZATION rule. If it's removed,
    // every agent emitting "ctrl+c" on macOS would suddenly trigger
    // Ctrl-C (kill-process semantics in Terminal) instead of Cmd-C (copy).
    expect(src).toMatch(/process\.platform\s*===\s*['"]darwin['"]/)
    // Inside toLibnutModifier, ctrl maps to cmd on darwin.
    expect(src).toMatch(/case\s+['"]ctrl['"]\s*:\s*case\s+['"]control['"]\s*:\s*\n?[\s\S]{0,200}return\s+['"]cmd['"]/)
  })

  it('expandChordKeys preserves single-character "+" (atomic key)', () => {
    // Static check: the length-1 short-circuit MUST exist so the bare "+"
    // key isn't treated as a delimiter and dropped.
    expect(src).toMatch(/val\.length\s*===\s*1/)
  })

  it('the split regex is `/\\s*\\+\\s*/` (not bare whitespace)', () => {
    // Splitting on whitespace would break multi-word key names like
    // "page up" that some agents emit. Enforce the +-only split.
    expect(src).toMatch(/\.split\(\s*\/\\s\*\\\+\\s\*\//)
  })

  it('darwin macOS aliases are present in the key map', () => {
    // Sanity: a few common synonyms the agent might emit.
    expect(src).toMatch(/spacebar/)
    expect(src).toMatch(/return_key/)
    expect(src).toMatch(/arrowup/)
  })
})
