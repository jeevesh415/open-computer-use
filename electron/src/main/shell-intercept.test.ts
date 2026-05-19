/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Heavy corner-case tests for the shell-command interceptor.
 *
 * The interceptor's correctness is critical: a wrong translation = the
 * agent thinks it pressed Win when it actually typed a literal "w-i-n",
 * or worse. These tests cover:
 *
 *   - Every xdotool key syntax variant the agent might emit
 *   - Every flag the xdotool CLI accepts
 *   - The exact strings from the user's failing production log
 *   - Keysym translation for all standard X11 key names
 *   - Combo expansion (super+r, ctrl+shift+t, alt+F4, …)
 *   - Sequences (xdotool key A B C — multiple keys in one call)
 *   - `xdotool type` with quotes, spaces, special chars
 *   - Edge cases: empty input, malformed input, non-xdotool commands
 *   - Pass-through: ls, echo, etc. must NOT be intercepted
 */

import { describe, it, expect } from 'vitest'
import {
  tryInterceptShellCommand,
  translateXdotoolKey,
  translateXdotoolCombo,
} from './shell-intercept'

/* ─── translateXdotoolKey ─────────────────────────────────────── */

describe('translateXdotoolKey', () => {
  describe('modifier keys', () => {
    it.each([
      ['super', 'win'], ['Super', 'win'], ['SUPER', 'win'],
      ['super_l', 'win'], ['super_r', 'win'],
      ['meta', 'win'], ['meta_l', 'win'], ['meta_r', 'win'],
      ['ctrl', 'ctrl'], ['Control', 'ctrl'], ['control_l', 'ctrl'], ['control_r', 'ctrl'],
      ['alt', 'alt'], ['Alt_L', 'alt'], ['alt_r', 'alt'],
      ['shift', 'shift'], ['Shift_L', 'shift'], ['shift_r', 'shift'],
    ])('%s → %s', (input, expected) => {
      expect(translateXdotoolKey(input)).toBe(expected)
    })
  })

  describe('navigation / editing keys', () => {
    it.each([
      ['Return', 'enter'], ['return', 'enter'], ['KP_Enter', 'enter'],
      ['Escape', 'esc'], ['escape', 'esc'], ['Esc', 'esc'],
      ['BackSpace', 'backspace'], ['backspace', 'backspace'],
      ['Delete', 'delete'], ['KP_Delete', 'delete'],
      ['Tab', 'tab'], ['ISO_Left_Tab', 'tab'],
      ['space', 'space'], ['Space', 'space'],
      ['Up', 'up'], ['Down', 'down'], ['Left', 'left'], ['Right', 'right'],
      ['Home', 'home'], ['End', 'end'],
      ['Page_Up', 'pageup'], ['PageUp', 'pageup'], ['Prior', 'pageup'],
      ['Page_Down', 'pagedown'], ['PageDown', 'pagedown'], ['Next', 'pagedown'],
      ['Insert', 'insert'],
    ])('%s → %s', (input, expected) => {
      expect(translateXdotoolKey(input)).toBe(expected)
    })
  })

  describe('lock / sysreq keys', () => {
    it.each([
      ['Caps_Lock', 'capslock'], ['CapsLock', 'capslock'],
      ['Num_Lock', 'numlock'], ['NumLock', 'numlock'],
      ['Scroll_Lock', 'scrolllock'],
      ['Print', 'printscreen'], ['Sys_Req', 'printscreen'],
      ['Pause', 'pause'], ['Break', 'pause'],
    ])('%s → %s', (input, expected) => {
      expect(translateXdotoolKey(input)).toBe(expected)
    })
  })

  describe('numpad keys', () => {
    it.each([
      ['KP_0', '0'], ['KP_5', '5'], ['KP_9', '9'],
      ['KP_Add', '+'], ['KP_Subtract', '-'],
      ['KP_Multiply', '*'], ['KP_Divide', '/'],
      ['KP_Decimal', '.'],
    ])('%s → %s', (input, expected) => {
      expect(translateXdotoolKey(input)).toBe(expected)
    })
  })

  describe('function keys F1-F12', () => {
    for (let i = 1; i <= 12; i++) {
      it(`F${i} → f${i}`, () => {
        expect(translateXdotoolKey(`F${i}`)).toBe(`f${i}`)
        expect(translateXdotoolKey(`f${i}`)).toBe(`f${i}`)
      })
    }
  })

  describe('bare characters pass through lowercase', () => {
    it.each([
      ['a', 'a'], ['Z', 'z'], ['1', '1'], ['9', '9'],
      [',', ','], ['.', '.'], ['/', '/'],
    ])('%s → %s', (input, expected) => {
      expect(translateXdotoolKey(input)).toBe(expected)
    })
  })

  describe('edge cases', () => {
    it('empty string → empty', () => {
      expect(translateXdotoolKey('')).toBe('')
    })
    it('unknown keysym lowercased verbatim', () => {
      expect(translateXdotoolKey('UnknownKeyName')).toBe('unknownkeyname')
    })
  })
})

/* ─── translateXdotoolCombo ────────────────────────────────────── */

describe('translateXdotoolCombo', () => {
  it.each([
    ['super+r',          ['win', 'r']],
    ['ctrl+c',           ['ctrl', 'c']],
    ['ctrl+v',           ['ctrl', 'v']],
    ['ctrl+a',           ['ctrl', 'a']],
    ['ctrl+shift+t',     ['ctrl', 'shift', 't']],
    ['alt+Tab',          ['alt', 'tab']],
    ['alt+F4',           ['alt', 'f4']],
    ['alt+F2',           ['alt', 'f2']],
    ['ctrl+alt+Delete',  ['ctrl', 'alt', 'delete']],
    ['shift+Insert',     ['shift', 'insert']],
    ['ctrl+Page_Up',     ['ctrl', 'pageup']],
    ['super+l',          ['win', 'l']],   // lock screen
    ['super+d',          ['win', 'd']],   // show desktop
    ['super+e',          ['win', 'e']],   // explorer
  ])('%s → %j', (input, expected) => {
    expect(translateXdotoolCombo(input)).toEqual(expected)
  })

  it('drops trailing empty segments (e.g. "ctrl+")', () => {
    expect(translateXdotoolCombo('ctrl+')).toEqual(['ctrl'])
  })

  it('drops leading empty segments', () => {
    expect(translateXdotoolCombo('+a')).toEqual(['a'])
  })
})

/* ─── tryInterceptShellCommand: pass-through ────────────────────── */

describe('tryInterceptShellCommand — pass-through', () => {
  it.each([
    'ls -la',
    'echo hello',
    'pwd',
    'cat file.txt',
    'grep foo bar.txt',
    'powershell -c "Get-Process"',
    'where chrome',
    'python script.py',
    '',
    '   ',
  ])('"%s" → null (no interception)', (input) => {
    expect(tryInterceptShellCommand(input)).toBeNull()
  })

  it.each([
    null,
    undefined,
    42,
    {},
    [],
    true,
  ])('non-string input "%s" → null', (input) => {
    expect(tryInterceptShellCommand(input as any)).toBeNull()
  })

  it('similar-looking commands not intercepted (xdotool-prefix substring)', () => {
    expect(tryInterceptShellCommand('xdotools')).toBeNull()
    expect(tryInterceptShellCommand('myxdotool')).toBeNull()
    expect(tryInterceptShellCommand('xdotool')).toBeNull() // bare, no subcommand
  })
})

/* ─── tryInterceptShellCommand: xdotool key — single keys ───────── */

describe('tryInterceptShellCommand — xdotool key (single)', () => {
  it.each([
    // [input, expectedKeys]
    ['xdotool key Return',          ['enter']],
    ['xdotool key Escape',          ['esc']],
    ['xdotool key Tab',             ['tab']],
    ['xdotool key BackSpace',       ['backspace']],
    ['xdotool key Delete',          ['delete']],
    ['xdotool key space',           ['space']],
    ['xdotool key Up',              ['up']],
    ['xdotool key Down',            ['down']],
    ['xdotool key Left',            ['left']],
    ['xdotool key Right',           ['right']],
    ['xdotool key Home',            ['home']],
    ['xdotool key End',             ['end']],
    ['xdotool key Page_Up',         ['pageup']],
    ['xdotool key Page_Down',       ['pagedown']],
    ['xdotool key F1',              ['f1']],
    ['xdotool key F11',             ['f11']],
  ])('%s → key_press %j', (input, expected) => {
    const r = tryInterceptShellCommand(input)
    expect(r).not.toBeNull()
    expect(r!.command).toBe('key_press')
    expect(r!.parameters.keys).toEqual(expected)
  })

  it('exact string from production log: "xdotool key -- super"', () => {
    const r = tryInterceptShellCommand('xdotool key -- super')
    expect(r).not.toBeNull()
    expect(r!.command).toBe('key_press')
    expect(r!.parameters.keys).toEqual(['win'])
  })

  it('exact string from production log: "xdotool key -- Return"', () => {
    const r = tryInterceptShellCommand('xdotool key -- Return')
    expect(r).not.toBeNull()
    expect(r!.command).toBe('key_press')
    expect(r!.parameters.keys).toEqual(['enter'])
  })

  it('exact string from production log: "xdotool key -- super+r"', () => {
    const r = tryInterceptShellCommand('xdotool key -- super+r')
    expect(r).not.toBeNull()
    expect(r!.command).toBe('key_combo')
    expect(r!.parameters.keys).toEqual(['win', 'r'])
  })
})

/* ─── tryInterceptShellCommand: xdotool key — combos ────────────── */

describe('tryInterceptShellCommand — xdotool key (combos)', () => {
  it.each([
    ['xdotool key super+r',         ['win', 'r']],
    ['xdotool key ctrl+c',          ['ctrl', 'c']],
    ['xdotool key ctrl+v',          ['ctrl', 'v']],
    ['xdotool key ctrl+a',          ['ctrl', 'a']],
    ['xdotool key ctrl+z',          ['ctrl', 'z']],
    ['xdotool key ctrl+shift+t',    ['ctrl', 'shift', 't']],
    ['xdotool key alt+Tab',         ['alt', 'tab']],
    ['xdotool key alt+F4',          ['alt', 'f4']],
    ['xdotool key ctrl+alt+Delete', ['ctrl', 'alt', 'delete']],
    ['xdotool key super+l',         ['win', 'l']],
    ['xdotool key super+d',         ['win', 'd']],
  ])('%s → key_combo %j', (input, expected) => {
    const r = tryInterceptShellCommand(input)
    expect(r).not.toBeNull()
    expect(r!.command).toBe('key_combo')
    expect(r!.parameters.keys).toEqual(expected)
  })
})

/* ─── tryInterceptShellCommand: xdotool key — multiple keys ───── */

describe('tryInterceptShellCommand — xdotool key (sequences)', () => {
  it('xdotool key A B C → key_press [a, b, c] (sequential press)', () => {
    const r = tryInterceptShellCommand('xdotool key A B C')
    expect(r).not.toBeNull()
    expect(r!.command).toBe('key_press')
    expect(r!.parameters.keys).toEqual(['a', 'b', 'c'])
  })

  it('xdotool key Tab Tab Tab → key_press [tab, tab, tab]', () => {
    const r = tryInterceptShellCommand('xdotool key Tab Tab Tab')
    expect(r).not.toBeNull()
    expect(r!.command).toBe('key_press')
    expect(r!.parameters.keys).toEqual(['tab', 'tab', 'tab'])
  })

  it('mixed sequence with combo upgrades to key_combo', () => {
    // If ANY token has a +, the whole list is treated as combo (because the
    // user is asking for a single combination press, not a sequence).
    const r = tryInterceptShellCommand('xdotool key ctrl+shift+t')
    expect(r!.command).toBe('key_combo')
    expect(r!.parameters.keys).toEqual(['ctrl', 'shift', 't'])
  })
})

/* ─── tryInterceptShellCommand: xdotool key — flags ─────────────── */

describe('tryInterceptShellCommand — xdotool key (flags)', () => {
  it.each([
    'xdotool key --clearmodifiers Return',
    'xdotool key --clearmodifiers -- Return',
    'xdotool key --window 12345 Return',
    'xdotool key --delay 100 Return',
    'xdotool key --repeat 3 Return',
    'xdotool key --repeat 3 --delay 50 Return',
    'xdotool key --window 999 --clearmodifiers --delay 25 Return',
  ])('%s → key_press [enter]', (input) => {
    const r = tryInterceptShellCommand(input)
    expect(r).not.toBeNull()
    expect(r!.command).toBe('key_press')
    expect(r!.parameters.keys).toEqual(['enter'])
  })

  it('flag-only with no positional → null', () => {
    expect(tryInterceptShellCommand('xdotool key --clearmodifiers')).toBeNull()
    expect(tryInterceptShellCommand('xdotool key --')).toBeNull()
  })
})

/* ─── tryInterceptShellCommand: keydown / keyup ─────────────────── */

describe('tryInterceptShellCommand — keydown / keyup', () => {
  it('xdotool keydown super → key_press [win]', () => {
    const r = tryInterceptShellCommand('xdotool keydown super')
    expect(r!.command).toBe('key_press')
    expect(r!.parameters.keys).toEqual(['win'])
    expect(r!.reason).toContain('keydown')
  })

  it('xdotool keyup Return → key_press [enter]', () => {
    const r = tryInterceptShellCommand('xdotool keyup Return')
    expect(r!.command).toBe('key_press')
    expect(r!.parameters.keys).toEqual(['enter'])
    expect(r!.reason).toContain('keyup')
  })
})

/* ─── tryInterceptShellCommand: xdotool type ────────────────────── */

describe('tryInterceptShellCommand — xdotool type', () => {
  it('xdotool type "hello world" → type "hello world"', () => {
    const r = tryInterceptShellCommand('xdotool type "hello world"')
    expect(r!.command).toBe('type')
    expect(r!.parameters.text).toBe('hello world')
  })

  it("xdotool type 'single quotes' → type", () => {
    const r = tryInterceptShellCommand("xdotool type 'single quotes'")
    expect(r!.command).toBe('type')
    expect(r!.parameters.text).toBe('single quotes')
  })

  it('xdotool type unquoted → type', () => {
    const r = tryInterceptShellCommand('xdotool type chrome')
    expect(r!.command).toBe('type')
    expect(r!.parameters.text).toBe('chrome')
  })

  it('xdotool type with --delay flag → type', () => {
    const r = tryInterceptShellCommand('xdotool type --delay 50 "fast"')
    expect(r!.command).toBe('type')
    expect(r!.parameters.text).toBe('fast')
  })

  it('xdotool type with multi-word unquoted → joined with spaces', () => {
    const r = tryInterceptShellCommand('xdotool type hello world')
    expect(r!.command).toBe('type')
    expect(r!.parameters.text).toBe('hello world')
  })

  it('xdotool type with no args → null', () => {
    expect(tryInterceptShellCommand('xdotool type')).toBeNull()
    expect(tryInterceptShellCommand('xdotool type --delay 50')).toBeNull()
  })

  it('xdotool type with special chars in quoted text', () => {
    const r = tryInterceptShellCommand('xdotool type "hello@world.com"')
    expect(r!.command).toBe('type')
    expect(r!.parameters.text).toBe('hello@world.com')
  })
})

/* ─── unsupported xdotool subcommands → null ─────────────────────── */

describe('tryInterceptShellCommand — unsupported xdotool subcommands fall through', () => {
  it.each([
    'xdotool mousemove 100 200',
    'xdotool click 1',
    'xdotool windowactivate 12345',
    'xdotool search "Chrome"',
    'xdotool getactivewindow',
    'xdotool getmouselocation',
  ])('%s → null', (input) => {
    expect(tryInterceptShellCommand(input)).toBeNull()
  })
})

/* ─── reason field is informative for logging ────────────────────── */

describe('reason field for logging', () => {
  it('key_press intercept reason contains the translated keys', () => {
    const r = tryInterceptShellCommand('xdotool key Return')
    expect(r!.reason).toContain('key_press')
    expect(r!.reason).toContain('enter')
  })

  it('key_combo intercept reason contains the translated combo', () => {
    const r = tryInterceptShellCommand('xdotool key ctrl+c')
    expect(r!.reason).toContain('key_combo')
    expect(r!.reason).toContain('ctrl')
    expect(r!.reason).toContain('c')
  })

  it('type intercept reason contains text preview', () => {
    const r = tryInterceptShellCommand('xdotool type "secret-data"')
    expect(r!.reason).toContain('type')
    expect(r!.reason).toContain('secret-data')
  })
})

/* ─── splitStatements ───────────────────────────────────────────── */

describe('splitStatements', () => {
  // We test via tryInterceptShellCommand since splitStatements is internal.
  // These confirm that && and ; correctly chunk the command.

  it('single statement → 1 op', () => {
    const r = tryInterceptShellCommand('xdotool key Return')
    expect(r!.command).toBe('key_press')
  })

  it('&& separator → multiple statements', () => {
    const r = tryInterceptShellCommand('sleep 0.1 && xdotool key Return')
    // Sleep filter + key_press → single command
    expect(r!.command).toBe('key_press')
  })

  it('; separator → multiple statements', () => {
    const r = tryInterceptShellCommand('sleep 0.1 ; xdotool key Return')
    expect(r!.command).toBe('key_press')
  })

  it('mixed && and ; separators', () => {
    const r = tryInterceptShellCommand('sleep 0.1 && xdotool key A ; xdotool key B')
    // sleep noop + 2 key_presses → __sequence with 2 steps
    expect(r!.command).toBe('__sequence')
    expect(r!.parameters.steps).toHaveLength(2)
  })

  it('quoted && inside string is NOT a separator', () => {
    const r = tryInterceptShellCommand('xdotool type "hello && world"')
    expect(r!.command).toBe('type')
    expect(r!.parameters.text).toBe('hello && world')
  })

  it('quoted ; inside string is NOT a separator', () => {
    const r = tryInterceptShellCommand('xdotool type "hello;world"')
    expect(r!.command).toBe('type')
    expect(r!.parameters.text).toBe('hello;world')
  })
})

/* ─── sleep filtering ────────────────────────────────────────────── */

describe('sleep N is recognized but filtered', () => {
  it('bare "sleep 0.2" → null (let shell handle it; cheap)', () => {
    expect(tryInterceptShellCommand('sleep 0.2')).toBeNull()
  })

  it('"sleep 0.2 && xdotool key Return" → key_press (sleep filtered out)', () => {
    const r = tryInterceptShellCommand('sleep 0.2 && xdotool key Return')
    expect(r!.command).toBe('key_press')
    expect(r!.parameters.keys).toEqual(['enter'])
  })

  it.each([
    'sleep 0',
    'sleep 0.1',
    'sleep 0.05',
    'sleep 1',
    'sleep 5',
    'sleep 0.123456',
  ])('"%s" recognized as sleep', (input) => {
    // Inside a chain so we get an intercept
    const r = tryInterceptShellCommand(`${input} && xdotool key Tab`)
    expect(r).not.toBeNull()
    expect(r!.command).toBe('key_press')
  })

  it('sleep with non-numeric arg → not recognized → chain falls through', () => {
    expect(tryInterceptShellCommand('sleep abc && xdotool key Return')).toBeNull()
  })
})

/* ─── DRAG pattern (the user-reported case) ──────────────────────── */

describe('drag pattern recognition', () => {
  it('the exact production-log drag chain → drag (450,375) → (600,500)', () => {
    const cmd =
      'xdotool mousemove --sync 450 375 && sleep 0.2 && xdotool mousedown 1 ' +
      '&& sleep 0.15 && xdotool mousemove --sync 600 500 && sleep 0.15 && xdotool mouseup 1'
    const r = tryInterceptShellCommand(cmd)
    expect(r).not.toBeNull()
    expect(r!.command).toBe('drag')
    expect(r!.parameters).toEqual({ x1: 450, y1: 375, x2: 600, y2: 500 })
  })

  it('drag without --sync flag', () => {
    const r = tryInterceptShellCommand(
      'xdotool mousemove 100 200 && xdotool mousedown 1 && xdotool mousemove 300 400 && xdotool mouseup 1',
    )
    expect(r!.command).toBe('drag')
    expect(r!.parameters).toEqual({ x1: 100, y1: 200, x2: 300, y2: 400 })
  })

  it('drag without sleeps in between', () => {
    const r = tryInterceptShellCommand(
      'xdotool mousemove 0 0 && xdotool mousedown 1 && xdotool mousemove 100 100 && xdotool mouseup 1',
    )
    expect(r!.command).toBe('drag')
    expect(r!.parameters).toEqual({ x1: 0, y1: 0, x2: 100, y2: 100 })
  })

  it('drag with multiple intermediate mousemoves uses LAST one as endpoint', () => {
    const r = tryInterceptShellCommand(
      'xdotool mousemove 0 0 && xdotool mousedown 1 ' +
      '&& xdotool mousemove 10 10 && xdotool mousemove 20 20 && xdotool mousemove 30 30 ' +
      '&& xdotool mouseup 1',
    )
    expect(r!.command).toBe('drag')
    expect(r!.parameters).toEqual({ x1: 0, y1: 0, x2: 30, y2: 30 })
  })

  it('drag with right button (3) — buttons must match across down/up', () => {
    const r = tryInterceptShellCommand(
      'xdotool mousemove 50 50 && xdotool mousedown 3 && xdotool mousemove 100 100 && xdotool mouseup 3',
    )
    expect(r!.command).toBe('drag')
    expect(r!.parameters).toEqual({ x1: 50, y1: 50, x2: 100, y2: 100 })
  })

  it('drag with mismatched button (down=1, up=3) → not recognized as drag', () => {
    const r = tryInterceptShellCommand(
      'xdotool mousemove 50 50 && xdotool mousedown 1 && xdotool mousemove 100 100 && xdotool mouseup 3',
    )
    // Falls through to sequence builder, but mousemove/mousedown/mouseup
    // aren't standalone-executable, so the whole chain returns null.
    expect(r).toBeNull()
  })

  it('drag without intermediate mousemove → not a drag', () => {
    // mousemove → mousedown → mouseup (no second mousemove) — null
    const r = tryInterceptShellCommand(
      'xdotool mousemove 50 50 && xdotool mousedown 1 && xdotool mouseup 1',
    )
    expect(r).toBeNull()
  })

  it('drag with extra ops in middle → not a drag', () => {
    // mousemove → mousedown → key Return → mousemove → mouseup — invalid
    const r = tryInterceptShellCommand(
      'xdotool mousemove 0 0 && xdotool mousedown 1 && xdotool key Return ' +
      '&& xdotool mousemove 100 100 && xdotool mouseup 1',
    )
    expect(r).toBeNull()
  })
})

/* ─── modifier+click pattern ─────────────────────────────────────── */

describe('keydown+click+keyup pattern recognition', () => {
  it('shift+click chain → click_with_modifiers', () => {
    const r = tryInterceptShellCommand(
      'xdotool keydown shift && xdotool click 1 && xdotool keyup shift',
    )
    expect(r!.command).toBe('click_with_modifiers')
    expect(r!.parameters.modifiers).toEqual(['shift'])
    expect(r!.parameters.button).toBe('left')
    expect(r!.parameters.x).toBeUndefined()
    expect(r!.parameters.y).toBeUndefined()
  })

  it('ctrl+shift+click → click_with_modifiers with multiple modifiers', () => {
    const r = tryInterceptShellCommand(
      'xdotool keydown ctrl && xdotool keydown shift && xdotool click 1 ' +
      '&& xdotool keyup ctrl && xdotool keyup shift',
    )
    expect(r!.command).toBe('click_with_modifiers')
    expect(r!.parameters.modifiers).toEqual(['ctrl', 'shift'])
    expect(r!.parameters.button).toBe('left')
  })

  it('keyup order does not have to match keydown order', () => {
    const r = tryInterceptShellCommand(
      'xdotool keydown ctrl && xdotool keydown shift && xdotool click 1 ' +
      '&& xdotool keyup shift && xdotool keyup ctrl',
    )
    expect(r!.command).toBe('click_with_modifiers')
    expect(r!.parameters.modifiers).toEqual(['ctrl', 'shift'])
  })

  it('mismatched keydown/keyup → not recognized', () => {
    const r = tryInterceptShellCommand(
      'xdotool keydown ctrl && xdotool click 1 && xdotool keyup shift',
    )
    expect(r).toBeNull()
  })

  it('with leading mousemove → click_with_modifiers AT position', () => {
    const r = tryInterceptShellCommand(
      'xdotool keydown shift && xdotool mousemove 200 300 && xdotool click 1 && xdotool keyup shift',
    )
    expect(r!.command).toBe('click_with_modifiers')
    expect(r!.parameters).toMatchObject({
      x: 200, y: 300,
      modifiers: ['shift'],
      button: 'left',
    })
  })

  it('right button (3) modifier+click', () => {
    const r = tryInterceptShellCommand(
      'xdotool keydown ctrl && xdotool click 3 && xdotool keyup ctrl',
    )
    expect(r!.command).toBe('click_with_modifiers')
    expect(r!.parameters.button).toBe('right')
  })
})

/* ─── positioned click (mousemove + click) ───────────────────────── */

describe('mousemove + click → positioned click', () => {
  it('mousemove + click 1 → click {x, y}', () => {
    const r = tryInterceptShellCommand(
      'xdotool mousemove 100 200 && xdotool click 1',
    )
    expect(r!.command).toBe('click')
    expect(r!.parameters).toEqual({ x: 100, y: 200 })
  })

  it('mousemove --sync + click 1 → click {x, y}', () => {
    const r = tryInterceptShellCommand(
      'xdotool mousemove --sync 50 75 && xdotool click 1',
    )
    expect(r!.command).toBe('click')
    expect(r!.parameters).toEqual({ x: 50, y: 75 })
  })

  it('mousemove + click 3 (right button) → click_with_modifiers right', () => {
    const r = tryInterceptShellCommand(
      'xdotool mousemove 10 20 && xdotool click 3',
    )
    expect(r!.command).toBe('click_with_modifiers')
    expect(r!.parameters).toMatchObject({
      x: 10, y: 20, modifiers: [], button: 'right',
    })
  })

  it('mousemove + sleep + click works', () => {
    const r = tryInterceptShellCommand(
      'xdotool mousemove 100 200 && sleep 0.1 && xdotool click 1',
    )
    expect(r!.command).toBe('click')
    expect(r!.parameters).toEqual({ x: 100, y: 200 })
  })
})

/* ─── multi-key sequences via && or ; ────────────────────────────── */

describe('multi-key sequences via chains', () => {
  it('xdotool key A ; xdotool key B → __sequence with 2 key_press steps', () => {
    const r = tryInterceptShellCommand('xdotool key A ; xdotool key B')
    expect(r!.command).toBe('__sequence')
    expect(r!.parameters.steps).toHaveLength(2)
    expect(r!.parameters.steps[0]).toEqual({
      command: 'key_press', parameters: { keys: ['a'] },
    })
    expect(r!.parameters.steps[1]).toEqual({
      command: 'key_press', parameters: { keys: ['b'] },
    })
  })

  it('xdotool key Return && xdotool type "hello" → __sequence', () => {
    const r = tryInterceptShellCommand('xdotool key Return && xdotool type "hello"')
    expect(r!.command).toBe('__sequence')
    expect(r!.parameters.steps).toEqual([
      { command: 'key_press', parameters: { keys: ['enter'] } },
      { command: 'type', parameters: { text: 'hello' } },
    ])
  })

  it('three commands chained → __sequence of 3', () => {
    const r = tryInterceptShellCommand(
      'xdotool key Tab && xdotool key Tab && xdotool key Return',
    )
    expect(r!.command).toBe('__sequence')
    expect(r!.parameters.steps).toHaveLength(3)
    expect(r!.parameters.steps.every((s: any) => s.command === 'key_press')).toBe(true)
  })

  it('chain with mixed sleeps and commands → sequence excludes sleeps', () => {
    const r = tryInterceptShellCommand(
      'sleep 0.1 && xdotool key A && sleep 0.1 && xdotool key B',
    )
    expect(r!.command).toBe('__sequence')
    expect(r!.parameters.steps).toHaveLength(2)
  })

  it('chain with ANY unrecognized statement → null (entire chain falls through)', () => {
    expect(tryInterceptShellCommand(
      'xdotool key Return && pwsh-special-cmd',
    )).toBeNull()
    expect(tryInterceptShellCommand(
      'echo hi && xdotool key Return',
    )).toBeNull()
  })
})

/* ─── wmctrl interception ───────────────────────────────────────── */

describe('wmctrl -a "Title" → switch_to_window', () => {
  it('wmctrl -a "Chrome" → switch_to_window', () => {
    const r = tryInterceptShellCommand('wmctrl -a "Chrome"')
    expect(r!.command).toBe('switch_to_window')
    expect(r!.parameters).toEqual({ title: 'Chrome' })
  })

  it("wmctrl -a 'Visual Studio Code' (single quotes)", () => {
    const r = tryInterceptShellCommand("wmctrl -a 'Visual Studio Code'")
    expect(r!.command).toBe('switch_to_window')
    expect(r!.parameters).toEqual({ title: 'Visual Studio Code' })
  })

  it('wmctrl -a unquoted title with spaces → joined', () => {
    const r = tryInterceptShellCommand('wmctrl -a Some Window Title')
    expect(r!.command).toBe('switch_to_window')
    expect(r!.parameters.title).toBe('Some Window Title')
  })

  it('wmctrl with unsupported flag → null', () => {
    expect(tryInterceptShellCommand('wmctrl -l')).toBeNull()
    expect(tryInterceptShellCommand('wmctrl -c "Chrome"')).toBeNull()
  })
})

/* ─── safety: never throws ───────────────────────────────────────── */

describe('safety: never throws on adversarial input', () => {
  it.each([
    'xdotool',                              // no subcommand
    'xdotool   ',                           // whitespace
    'xdotool key',                          // no key
    'xdotool key   ',                       // no key with whitespace
    'xdotool key --window',                 // flag with missing value
    'xdotool key --',                       // just separator
    'xdotool foo bar baz',                  // unknown subcommand
    '"unterminated',                        // unclosed quote — tokenizer must not throw
    'xdotool key "unclosed',
    'xdotool type "',                       // empty quoted string
    'xdotool key ' + 'a'.repeat(10_000),    // huge input
  ])('"%s" does not throw', (input) => {
    expect(() => tryInterceptShellCommand(input)).not.toThrow()
  })
})
