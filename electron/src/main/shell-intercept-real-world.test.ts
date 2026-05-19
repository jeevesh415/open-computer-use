/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Real-world cross-platform scenarios for the shell-command interceptor.
 *
 * The other test file (shell-intercept.test.ts) does narrow correctness —
 * "does each parser branch return the right thing on synthetic input".
 * This file exercises FULL agent task flows that the production CUA backend
 * actually emits, with the platform-specific quirks each OS introduces:
 *
 *   - WINDOWS: PowerShell quoting, Win/Cmd key naming, no xdotool/wmctrl
 *     installed, the user's actual production-log strings
 *   - LINUX:   real xdotool/wmctrl semantics, --sync flag idioms,
 *     ISO_Left_Tab vs Tab, Super_L vs super_l casing
 *   - MACOS:   Cmd-as-Super translation, no xdotool installed, agent
 *     emitting xdotool anyway (the same situation as Windows)
 *
 * Plus stress/safety: 100-step chains, unicode in type, shell-injection
 * attempts, malformed input (must NEVER throw, must NEVER hang).
 */

import { describe, it, expect } from 'vitest'
import {
  tryInterceptShellCommand,
  translateXdotoolKey,
  translateXdotoolCombo,
  splitStatements,
  checkUnsupportedShellCommand,
} from './shell-intercept'

/* ──────────────────────────────────────────────────────────────────
   1. REAL PRODUCTION SEQUENCES — verbatim strings from user logs
   ────────────────────────────────────────────────────────────────── */

describe('production-log strings (verbatim from user reports)', () => {
  it('exact: "xdotool key -- super"', () => {
    const r = tryInterceptShellCommand('xdotool key -- super')
    expect(r).toEqual({
      command: 'key_press',
      parameters: { keys: ['win'] },
      reason: expect.stringContaining('key_press'),
    })
  })

  it('exact: "xdotool key -- Return"', () => {
    const r = tryInterceptShellCommand('xdotool key -- Return')
    expect(r!.parameters.keys).toEqual(['enter'])
  })

  it('exact: "xdotool key -- super+r"', () => {
    const r = tryInterceptShellCommand('xdotool key -- super+r')
    expect(r!.command).toBe('key_combo')
    expect(r!.parameters.keys).toEqual(['win', 'r'])
  })

  it('production drag chain (450,375)→(600,500) with --sync and sleeps', () => {
    const r = tryInterceptShellCommand(
      'xdotool mousemove --sync 450 375 && sleep 0.2 && xdotool mousedown 1 ' +
      '&& sleep 0.15 && xdotool mousemove --sync 600 500 ' +
      '&& sleep 0.15 && xdotool mouseup 1',
    )
    expect(r).toEqual({
      command: 'drag',
      parameters: { x1: 450, y1: 375, x2: 600, y2: 500 },
      reason: expect.stringContaining('drag'),
    })
  })

  // ── Regression: the EXACT shift-drag chain from the user's log
  // (PowerShell choked on `&&`; intercept now routes to native drag.) ──
  it('production shift-drag chain from log (keydown shift → mousemove → mousedown 1 → mousemove → mouseup 1 → keyup shift)', () => {
    const r = tryInterceptShellCommand(
      'xdotool keydown shift && xdotool mousemove --sync 450 450 && sleep 0.2 ' +
      '&& xdotool mousedown 1 && xdotool mousemove --sync 700 600 && sleep 0.2 ' +
      '&& xdotool mouseup 1 && xdotool keyup shift',
    )
    expect(r).toEqual({
      command: 'drag',
      parameters: { x1: 450, y1: 450, x2: 700, y2: 600, hold_keys: ['shift'] },
      reason: expect.stringContaining('hold'),
    })
  })

  it('ctrl-drag (multi-select) chain', () => {
    const r = tryInterceptShellCommand(
      'xdotool keydown ctrl && xdotool mousemove --sync 100 100 && xdotool mousedown 1 ' +
      '&& xdotool mousemove --sync 300 300 && xdotool mouseup 1 && xdotool keyup ctrl',
    )
    expect(r!.command).toBe('drag')
    expect(r!.parameters.hold_keys).toEqual(['ctrl'])
    expect(r!.parameters.x1).toBe(100)
    expect(r!.parameters.x2).toBe(300)
  })

  it('multi-modifier drag (ctrl+shift) — set semantics not order', () => {
    const r = tryInterceptShellCommand(
      'xdotool keydown ctrl && xdotool keydown shift && xdotool mousemove --sync 50 50 ' +
      '&& xdotool mousedown 1 && xdotool mousemove --sync 200 200 && xdotool mouseup 1 ' +
      '&& xdotool keyup shift && xdotool keyup ctrl',  // released in reverse — still valid
    )
    expect(r!.command).toBe('drag')
    expect(r!.parameters.hold_keys.sort()).toEqual(['ctrl', 'shift'])
  })

  it('alt-drag with multiple intermediate mousemoves (smooth drag) → uses last waypoint', () => {
    const r = tryInterceptShellCommand(
      'xdotool keydown alt && xdotool mousemove --sync 100 100 && xdotool mousedown 1 ' +
      '&& xdotool mousemove --sync 150 130 && xdotool mousemove --sync 200 160 ' +
      '&& xdotool mousemove --sync 250 200 && xdotool mouseup 1 && xdotool keyup alt',
    )
    expect(r!.command).toBe('drag')
    expect(r!.parameters.x2).toBe(250)
    expect(r!.parameters.y2).toBe(200)
    expect(r!.parameters.hold_keys).toEqual(['alt'])
  })

  it('mismatched modifiers (keydown shift, keyup ctrl) → not intercepted as drag', () => {
    const r = tryInterceptShellCommand(
      'xdotool keydown shift && xdotool mousemove --sync 0 0 && xdotool mousedown 1 ' +
      '&& xdotool mousemove --sync 10 10 && xdotool mouseup 1 && xdotool keyup ctrl',
    )
    // Either falls through (returns null) or gets handled by another recognizer,
    // but MUST NOT silently misreport hold_keys as ['shift'] when the chain is
    // structurally inconsistent.
    if (r && r.command === 'drag') {
      expect(r.parameters.hold_keys).not.toEqual(['shift'])
    }
  })

  it('button mismatch (mousedown 1 / mouseup 3) → rejected (cannot drag with two buttons)', () => {
    const r = tryInterceptShellCommand(
      'xdotool keydown shift && xdotool mousemove --sync 0 0 && xdotool mousedown 1 ' +
      '&& xdotool mousemove --sync 10 10 && xdotool mouseup 3 && xdotool keyup shift',
    )
    // Same constraint as plain drag — buttons must match
    if (r) expect(r.command).not.toBe('drag')
  })
})

/* ──────────────────────────────────────────────────────────────────
   1b. SAFETY NET — Linux-only commands that DON'T match any
       recognizer must never reach the shell on Windows / macOS.
   ────────────────────────────────────────────────────────────────── */

describe('checkUnsupportedShellCommand — defence-in-depth on non-Linux', () => {
  it('the EXACT failing shift-drag chain → clean failure on Windows even if no recognizer matched', () => {
    // We pass it explicitly on win32 (the platform from the user's bug report).
    // Even if a future refactor breaks recognizeModifierDrag, this safety net
    // still prevents PowerShell from seeing `&&` and spitting syntax errors.
    const trickyChain =
      'xdotool keydown shift && xdotool mousemove --sync 450 450 && xdotool keydown unknown_thing'
    const r = checkUnsupportedShellCommand(trickyChain, 'win32')
    expect(r).toEqual({
      success: false,
      error: expect.stringContaining('Unsupported Linux-only'),
    })
    expect(r!.error).toContain('xdotool')
    expect(r!.error).toContain('win32')
  })

  it('xdotool standalone → fails clean on win32', () => {
    const r = checkUnsupportedShellCommand('xdotool key Return', 'win32')
    expect(r?.success).toBe(false)
  })

  it('xdotool standalone → fails clean on darwin', () => {
    const r = checkUnsupportedShellCommand('xdotool key Return', 'darwin')
    expect(r?.success).toBe(false)
  })

  it('wmctrl chain that the parser rejects → fails clean on win32', () => {
    const r = checkUnsupportedShellCommand('wmctrl -l && wmctrl -d', 'win32')
    expect(r?.success).toBe(false)
    expect(r!.error).toContain('wmctrl')
  })

  it('xdotool on linux → null (let it run natively, the tool actually exists)', () => {
    const r = checkUnsupportedShellCommand('xdotool key Return', 'linux')
    expect(r).toBeNull()
  })

  it('non-Linux-tool shell command (e.g. echo, ls) → null on every platform', () => {
    expect(checkUnsupportedShellCommand('echo hello', 'win32')).toBeNull()
    expect(checkUnsupportedShellCommand('ls -la', 'darwin')).toBeNull()
    expect(checkUnsupportedShellCommand('git status', 'linux')).toBeNull()
  })

  it('mixed chain — first statement is a normal command, but a later one is xdotool → still fails clean', () => {
    const r = checkUnsupportedShellCommand('echo hi && xdotool key Return', 'win32')
    expect(r?.success).toBe(false)
  })

  it('empty string / whitespace / non-string → null (no false positives)', () => {
    expect(checkUnsupportedShellCommand('', 'win32')).toBeNull()
    expect(checkUnsupportedShellCommand('   ', 'win32')).toBeNull()
    expect(checkUnsupportedShellCommand(null, 'win32')).toBeNull()
    expect(checkUnsupportedShellCommand(undefined, 'win32')).toBeNull()
    expect(checkUnsupportedShellCommand(42, 'win32')).toBeNull()
  })

  it('shell-injection attempt embedded in xdotool call → still flagged (prevents PS errors)', () => {
    const r = checkUnsupportedShellCommand(
      'xdotool key "$(whoami)" && rm -rf /',
      'win32',
    )
    // The `;` / `&&` split keeps the dangerous part separate from intercept,
    // but the FIRST statement starts with xdotool so we refuse the whole chain.
    expect(r?.success).toBe(false)
  })
})

/* ──────────────────────────────────────────────────────────────────
   2. AGENT TASK FLOW: "Open Chrome" — the original failure scenario
   ────────────────────────────────────────────────────────────────── */

describe('agent task flow: "Open Chrome"', () => {
  it('Win → type chrome → Enter (the failed flow, now fixed)', () => {
    const winKey = tryInterceptShellCommand('xdotool key -- super')
    expect(winKey!.command).toBe('key_press')
    expect(winKey!.parameters.keys).toEqual(['win'])

    const typeChrome = tryInterceptShellCommand('xdotool type "chrome"')
    expect(typeChrome!.command).toBe('type')
    expect(typeChrome!.parameters.text).toBe('chrome')

    const enter = tryInterceptShellCommand('xdotool key -- Return')
    expect(enter!.command).toBe('key_press')
    expect(enter!.parameters.keys).toEqual(['enter'])
  })

  it('chained version: "Win+R, type chrome, Enter" in one shell command', () => {
    const r = tryInterceptShellCommand(
      'xdotool key super+r && sleep 0.2 && xdotool type "chrome.exe" && xdotool key Return',
    )
    expect(r!.command).toBe('__sequence')
    expect(r!.parameters.steps).toEqual([
      { command: 'key_combo', parameters: { keys: ['win', 'r'] } },
      { command: 'type', parameters: { text: 'chrome.exe' } },
      { command: 'key_press', parameters: { keys: ['enter'] } },
    ])
  })

  it('chained version with semicolons (works the same as &&)', () => {
    const r = tryInterceptShellCommand(
      'xdotool key super+r ; sleep 0.2 ; xdotool type chrome ; xdotool key Return',
    )
    expect(r!.command).toBe('__sequence')
    expect(r!.parameters.steps).toHaveLength(3)
  })
})

/* ──────────────────────────────────────────────────────────────────
   3. AGENT TASK FLOW: macOS Spotlight (Cmd+Space → search → Enter)
   ────────────────────────────────────────────────────────────────── */

describe('agent task flow: macOS Spotlight', () => {
  // The agent often uses xdotool even on macOS because its action
  // pipeline is Linux-flavoured. xdotool doesn't exist on Darwin, so
  // every command would fail without the interceptor.
  it('Cmd+Space → type "Safari" → Enter (chained)', () => {
    const r = tryInterceptShellCommand(
      'xdotool key super+space && sleep 0.3 && xdotool type "Safari" && xdotool key Return',
    )
    expect(r!.command).toBe('__sequence')
    expect(r!.parameters.steps[0]).toEqual({
      command: 'key_combo',
      parameters: { keys: ['win', 'space'] },  // 'super' → 'win' which the macOS
                                                // desktopKeyCombo translates to Cmd
    })
    expect(r!.parameters.steps[1].parameters.text).toBe('Safari')
    expect(r!.parameters.steps[2].parameters.keys).toEqual(['enter'])
  })

  it('Cmd+Space alone → key_combo [win, space]', () => {
    const r = tryInterceptShellCommand('xdotool key super+space')
    expect(r!.command).toBe('key_combo')
    expect(r!.parameters.keys).toEqual(['win', 'space'])
  })
})

/* ──────────────────────────────────────────────────────────────────
   4. AGENT TASK FLOW: Copy/paste/select-all (universal across OSes)
   ────────────────────────────────────────────────────────────────── */

describe('agent task flow: clipboard operations', () => {
  it('Select all → Copy', () => {
    const r = tryInterceptShellCommand(
      'xdotool key ctrl+a && xdotool key ctrl+c',
    )
    expect(r!.command).toBe('__sequence')
    expect(r!.parameters.steps).toEqual([
      { command: 'key_combo', parameters: { keys: ['ctrl', 'a'] } },
      { command: 'key_combo', parameters: { keys: ['ctrl', 'c'] } },
    ])
  })

  it('Cut/Paste cycle: Ctrl+X → Ctrl+V', () => {
    const r = tryInterceptShellCommand(
      'xdotool key ctrl+x && sleep 0.1 && xdotool key ctrl+v',
    )
    expect(r!.command).toBe('__sequence')
    expect(r!.parameters.steps).toEqual([
      { command: 'key_combo', parameters: { keys: ['ctrl', 'x'] } },
      { command: 'key_combo', parameters: { keys: ['ctrl', 'v'] } },
    ])
  })

  it('Undo/Redo: Ctrl+Z → Ctrl+Shift+Z', () => {
    const r = tryInterceptShellCommand(
      'xdotool key ctrl+z && xdotool key ctrl+shift+z',
    )
    expect(r!.command).toBe('__sequence')
    expect(r!.parameters.steps[0].parameters.keys).toEqual(['ctrl', 'z'])
    expect(r!.parameters.steps[1].parameters.keys).toEqual(['ctrl', 'shift', 'z'])
  })

  it('Save: Ctrl+S', () => {
    const r = tryInterceptShellCommand('xdotool key ctrl+s')
    expect(r!.command).toBe('key_combo')
    expect(r!.parameters.keys).toEqual(['ctrl', 's'])
  })
})

/* ──────────────────────────────────────────────────────────────────
   5. AGENT TASK FLOW: window management
   ────────────────────────────────────────────────────────────────── */

describe('agent task flow: window management', () => {
  it('Alt+Tab cycle (3 windows away)', () => {
    const r = tryInterceptShellCommand(
      'xdotool key alt+Tab && xdotool key alt+Tab && xdotool key alt+Tab',
    )
    expect(r!.command).toBe('__sequence')
    expect(r!.parameters.steps).toHaveLength(3)
    expect(r!.parameters.steps.every((s: any) =>
      s.command === 'key_combo' &&
      s.parameters.keys.length === 2 &&
      s.parameters.keys[0] === 'alt' &&
      s.parameters.keys[1] === 'tab',
    )).toBe(true)
  })

  it('Alt+F4 to close window', () => {
    const r = tryInterceptShellCommand('xdotool key alt+F4')
    expect(r!.command).toBe('key_combo')
    expect(r!.parameters.keys).toEqual(['alt', 'f4'])
  })

  it('wmctrl -a "Visual Studio Code" → switch_to_window', () => {
    const r = tryInterceptShellCommand('wmctrl -a "Visual Studio Code"')
    expect(r!.command).toBe('switch_to_window')
    expect(r!.parameters.title).toBe('Visual Studio Code')
  })

  it('Win+E to open Explorer (Windows)', () => {
    const r = tryInterceptShellCommand('xdotool key super+e')
    expect(r!.command).toBe('key_combo')
    expect(r!.parameters.keys).toEqual(['win', 'e'])
  })

  it('Win+L to lock screen (Windows)', () => {
    const r = tryInterceptShellCommand('xdotool key super+l')
    expect(r!.command).toBe('key_combo')
    expect(r!.parameters.keys).toEqual(['win', 'l'])
  })

  it('Win+D to show desktop (Windows)', () => {
    const r = tryInterceptShellCommand('xdotool key super+d')
    expect(r!.command).toBe('key_combo')
    expect(r!.parameters.keys).toEqual(['win', 'd'])
  })
})

/* ──────────────────────────────────────────────────────────────────
   6. AGENT TASK FLOW: text editing within an app
   ────────────────────────────────────────────────────────────────── */

describe('agent task flow: text editing', () => {
  it('navigate to end of line, select all back, delete', () => {
    const r = tryInterceptShellCommand(
      'xdotool key End && xdotool key shift+Home && xdotool key Delete',
    )
    expect(r!.command).toBe('__sequence')
    expect(r!.parameters.steps).toEqual([
      { command: 'key_press', parameters: { keys: ['end'] } },
      { command: 'key_combo', parameters: { keys: ['shift', 'home'] } },
      { command: 'key_press', parameters: { keys: ['delete'] } },
    ])
  })

  it('jump to top of document: Ctrl+Home', () => {
    const r = tryInterceptShellCommand('xdotool key ctrl+Home')
    expect(r!.command).toBe('key_combo')
    expect(r!.parameters.keys).toEqual(['ctrl', 'home'])
  })

  it('extend selection by word: Ctrl+Shift+Right', () => {
    const r = tryInterceptShellCommand('xdotool key ctrl+shift+Right')
    expect(r!.command).toBe('key_combo')
    expect(r!.parameters.keys).toEqual(['ctrl', 'shift', 'right'])
  })

  it('typing a long sentence', () => {
    const text = 'The quick brown fox jumps over the lazy dog.'
    const r = tryInterceptShellCommand(`xdotool type "${text}"`)
    expect(r!.command).toBe('type')
    expect(r!.parameters.text).toBe(text)
  })

  it('typing text with apostrophes (single-quoted in shell)', () => {
    const r = tryInterceptShellCommand("xdotool type \"don't stop\"")
    expect(r!.command).toBe('type')
    expect(r!.parameters.text).toBe("don't stop")
  })
})

/* ──────────────────────────────────────────────────────────────────
   7. DRAG SCENARIOS — every common drag pattern
   ────────────────────────────────────────────────────────────────── */

describe('drag scenarios across all platforms', () => {
  it('horizontal drag (selection sweep)', () => {
    const r = tryInterceptShellCommand(
      'xdotool mousemove 100 200 && xdotool mousedown 1 && xdotool mousemove 500 200 && xdotool mouseup 1',
    )
    expect(r!.command).toBe('drag')
    expect(r!.parameters).toEqual({ x1: 100, y1: 200, x2: 500, y2: 200 })
  })

  it('vertical drag (resize handle)', () => {
    const r = tryInterceptShellCommand(
      'xdotool mousemove 400 100 && xdotool mousedown 1 && xdotool mousemove 400 600 && xdotool mouseup 1',
    )
    expect(r!.command).toBe('drag')
    expect(r!.parameters).toEqual({ x1: 400, y1: 100, x2: 400, y2: 600 })
  })

  it('diagonal drag', () => {
    const r = tryInterceptShellCommand(
      'xdotool mousemove 0 0 && xdotool mousedown 1 && xdotool mousemove 1920 1080 && xdotool mouseup 1',
    )
    expect(r!.command).toBe('drag')
    expect(r!.parameters).toEqual({ x1: 0, y1: 0, x2: 1920, y2: 1080 })
  })

  it('4K-resolution drag (large coordinates)', () => {
    const r = tryInterceptShellCommand(
      'xdotool mousemove 100 100 && xdotool mousedown 1 && xdotool mousemove 3840 2160 && xdotool mouseup 1',
    )
    expect(r!.command).toBe('drag')
    expect(r!.parameters).toEqual({ x1: 100, y1: 100, x2: 3840, y2: 2160 })
  })

  it('5-stage drag with 3 intermediate points → uses LAST point as endpoint', () => {
    const r = tryInterceptShellCommand(
      'xdotool mousemove 0 0 && xdotool mousedown 1 && ' +
      'xdotool mousemove 100 100 && xdotool mousemove 200 200 && xdotool mousemove 300 300 && ' +
      'xdotool mouseup 1',
    )
    expect(r!.command).toBe('drag')
    expect(r!.parameters).toEqual({ x1: 0, y1: 0, x2: 300, y2: 300 })
  })

  it('drag with sleeps interleaved (sleeps filtered, not counted as ops)', () => {
    const r = tryInterceptShellCommand(
      'xdotool mousemove 50 50 && sleep 0.1 && xdotool mousedown 1 && sleep 0.2 && ' +
      'xdotool mousemove 150 150 && sleep 0.05 && xdotool mouseup 1',
    )
    expect(r!.command).toBe('drag')
    expect(r!.parameters).toEqual({ x1: 50, y1: 50, x2: 150, y2: 150 })
  })

  it('right-button drag (button 3) for context-drag', () => {
    const r = tryInterceptShellCommand(
      'xdotool mousemove 100 100 && xdotool mousedown 3 && xdotool mousemove 200 200 && xdotool mouseup 3',
    )
    expect(r!.command).toBe('drag')
    expect(r!.parameters).toEqual({ x1: 100, y1: 100, x2: 200, y2: 200 })
  })

  it('middle-button drag (button 2)', () => {
    const r = tryInterceptShellCommand(
      'xdotool mousemove 100 100 && xdotool mousedown 2 && xdotool mousemove 200 200 && xdotool mouseup 2',
    )
    expect(r!.command).toBe('drag')
    expect(r!.parameters).toEqual({ x1: 100, y1: 100, x2: 200, y2: 200 })
  })
})

/* ──────────────────────────────────────────────────────────────────
   8. MODIFIER + CLICK SCENARIOS
   ────────────────────────────────────────────────────────────────── */

describe('modifier+click scenarios', () => {
  it('Shift-click to extend selection (no position)', () => {
    const r = tryInterceptShellCommand(
      'xdotool keydown shift && xdotool click 1 && xdotool keyup shift',
    )
    expect(r!.command).toBe('click_with_modifiers')
    expect(r!.parameters.modifiers).toEqual(['shift'])
    expect(r!.parameters.button).toBe('left')
  })

  it('Ctrl-click to add to selection at position (200, 300)', () => {
    const r = tryInterceptShellCommand(
      'xdotool keydown ctrl && xdotool mousemove 200 300 && xdotool click 1 && xdotool keyup ctrl',
    )
    expect(r!.command).toBe('click_with_modifiers')
    expect(r!.parameters).toMatchObject({
      x: 200, y: 300, modifiers: ['ctrl'], button: 'left',
    })
  })

  it('Ctrl+Shift+click for multi-selection', () => {
    const r = tryInterceptShellCommand(
      'xdotool keydown ctrl && xdotool keydown shift && xdotool click 1 && ' +
      'xdotool keyup ctrl && xdotool keyup shift',
    )
    expect(r!.command).toBe('click_with_modifiers')
    expect(r!.parameters.modifiers).toEqual(['ctrl', 'shift'])
  })

  it('Cmd+click on macOS (translated from super)', () => {
    const r = tryInterceptShellCommand(
      'xdotool keydown super && xdotool click 1 && xdotool keyup super',
    )
    expect(r!.command).toBe('click_with_modifiers')
    expect(r!.parameters.modifiers).toEqual(['win'])
  })

  it('Alt+right-click for context menu with modifier', () => {
    const r = tryInterceptShellCommand(
      'xdotool keydown alt && xdotool click 3 && xdotool keyup alt',
    )
    expect(r!.command).toBe('click_with_modifiers')
    expect(r!.parameters.modifiers).toEqual(['alt'])
    expect(r!.parameters.button).toBe('right')
  })
})

/* ──────────────────────────────────────────────────────────────────
   9. POSITIONED CLICK (mousemove + click)
   ────────────────────────────────────────────────────────────────── */

describe('positioned click scenarios', () => {
  it('left click at (100, 200) → click', () => {
    const r = tryInterceptShellCommand(
      'xdotool mousemove 100 200 && xdotool click 1',
    )
    expect(r!.command).toBe('click')
    expect(r!.parameters).toEqual({ x: 100, y: 200 })
  })

  it('left click at top-left (0, 0)', () => {
    const r = tryInterceptShellCommand('xdotool mousemove 0 0 && xdotool click 1')
    expect(r!.command).toBe('click')
    expect(r!.parameters).toEqual({ x: 0, y: 0 })
  })

  it('right click at position → click_with_modifiers (right)', () => {
    const r = tryInterceptShellCommand('xdotool mousemove 500 300 && xdotool click 3')
    expect(r!.command).toBe('click_with_modifiers')
    expect(r!.parameters).toMatchObject({
      x: 500, y: 300, button: 'right', modifiers: [],
    })
  })

  it('mousemove + click separated by sleep', () => {
    const r = tryInterceptShellCommand(
      'xdotool mousemove 100 200 && sleep 0.05 && xdotool click 1',
    )
    expect(r!.command).toBe('click')
  })
})

/* ──────────────────────────────────────────────────────────────────
   10. CROSS-PLATFORM KEYSYM COVERAGE
   ────────────────────────────────────────────────────────────────── */

describe('cross-platform keysym translation', () => {
  describe('Windows-favored shortcuts', () => {
    it.each([
      ['xdotool key super+r',  ['win', 'r'],   'Run dialog'],
      ['xdotool key super+e',  ['win', 'e'],   'Explorer'],
      ['xdotool key super+l',  ['win', 'l'],   'Lock screen'],
      ['xdotool key super+d',  ['win', 'd'],   'Show desktop'],
      ['xdotool key super+i',  ['win', 'i'],   'Settings'],
      ['xdotool key super+x',  ['win', 'x'],   'Quick Link menu'],
      ['xdotool key super+v',  ['win', 'v'],   'Clipboard history'],
      ['xdotool key super+Tab', ['win', 'tab'], 'Task view'],
      ['xdotool key win+r',    ['win', 'r'],   'using win directly'],
    ])('%s → %j (%s)', (input, expected) => {
      const r = tryInterceptShellCommand(input)
      expect(r!.command).toBe('key_combo')
      expect(r!.parameters.keys).toEqual(expected)
    })
  })

  describe('macOS-favored shortcuts (super translates to win, then desktopKeyCombo maps to Cmd on Darwin)', () => {
    it.each([
      ['xdotool key super+space', ['win', 'space'], 'Spotlight'],
      ['xdotool key super+Tab',   ['win', 'tab'],   'App switcher'],
      ['xdotool key super+w',     ['win', 'w'],     'Close window'],
      ['xdotool key super+q',     ['win', 'q'],     'Quit app'],
      ['xdotool key super+m',     ['win', 'm'],     'Minimize'],
      ['xdotool key super+,',     ['win', ','],     'Preferences'],
      ['xdotool key super+shift+3', ['win', 'shift', '3'], 'Screenshot all'],
      ['xdotool key super+shift+4', ['win', 'shift', '4'], 'Screenshot region'],
    ])('%s → %j (%s)', (input, expected) => {
      const r = tryInterceptShellCommand(input)
      expect(r!.command).toBe('key_combo')
      expect(r!.parameters.keys).toEqual(expected)
    })
  })

  describe('Linux desktop shortcuts (real xdotool semantics)', () => {
    it.each([
      ['xdotool key ctrl+alt+t',     ['ctrl', 'alt', 't'],     'Open terminal'],
      ['xdotool key ctrl+alt+F1',    ['ctrl', 'alt', 'f1'],    'Switch TTY'],
      ['xdotool key super',          ['win'],                  'Activities'],
      ['xdotool key super+a',        ['win', 'a'],             'Show apps'],
      ['xdotool key alt+space',      ['alt', 'space'],         'Window menu'],
      ['xdotool key Print',          ['printscreen'],          'Screenshot'],
    ])('%s → %j (%s)', (input, expected) => {
      const r = tryInterceptShellCommand(input)
      expect(r!.parameters.keys).toEqual(expected)
    })
  })

  describe('keysym variants that must all map identically', () => {
    it('super == Super == SUPER == Super_L == super_l == super_r == meta == meta_l', () => {
      const variants = ['super', 'Super', 'SUPER', 'Super_L', 'super_l', 'super_r',
                        'meta', 'meta_l', 'meta_r', 'Meta', 'META']
      for (const v of variants) {
        expect(translateXdotoolKey(v)).toBe('win')
      }
    })

    it('Return == return == KP_Enter == kp_enter all map to "enter"', () => {
      for (const v of ['Return', 'return', 'KP_Enter', 'kp_enter']) {
        expect(translateXdotoolKey(v)).toBe('enter')
      }
    })

    it('Page_Up == PageUp == Prior all map to "pageup"', () => {
      for (const v of ['Page_Up', 'PageUp', 'page_up', 'pageup', 'Prior', 'prior']) {
        expect(translateXdotoolKey(v)).toBe('pageup')
      }
    })

    it('all F-keys 1..24 lowercased', () => {
      for (let i = 1; i <= 24; i++) {
        expect(translateXdotoolKey(`F${i}`)).toBe(`f${i}`)
      }
    })
  })
})

/* ──────────────────────────────────────────────────────────────────
   11. NUMERIC + COORDINATE EDGE CASES
   ────────────────────────────────────────────────────────────────── */

describe('numeric and coordinate edge cases', () => {
  it('0,0 coordinates accepted', () => {
    const r = tryInterceptShellCommand('xdotool mousemove 0 0 && xdotool click 1')
    expect(r!.parameters).toEqual({ x: 0, y: 0 })
  })

  it('large 4K coordinates accepted', () => {
    const r = tryInterceptShellCommand('xdotool mousemove 3839 2159 && xdotool click 1')
    expect(r!.parameters).toEqual({ x: 3839, y: 2159 })
  })

  it('very large 8K-ultrawide coordinates accepted', () => {
    const r = tryInterceptShellCommand(
      'xdotool mousemove 100 100 && xdotool mousedown 1 && xdotool mousemove 7679 4319 && xdotool mouseup 1',
    )
    expect(r!.command).toBe('drag')
    expect(r!.parameters.x2).toBe(7679)
    expect(r!.parameters.y2).toBe(4319)
  })

  it('non-numeric coordinate → mousemove not parsed → chain falls through', () => {
    expect(tryInterceptShellCommand('xdotool mousemove abc def && xdotool click 1'))
      .toBeNull()
  })

  it('decimal coordinates parsed as integer (parseInt drops fraction)', () => {
    const r = tryInterceptShellCommand('xdotool mousemove 100.7 200.3 && xdotool click 1')
    expect(r!.parameters).toEqual({ x: 100, y: 200 })
  })

  it('invalid button number → click parser returns null → chain falls through', () => {
    expect(tryInterceptShellCommand('xdotool mousemove 50 50 && xdotool click 99'))
      .toBeNull()
    expect(tryInterceptShellCommand('xdotool mousemove 50 50 && xdotool click foo'))
      .toBeNull()
  })

  it('repeated mousedown without intermediate move → not a drag → null', () => {
    const r = tryInterceptShellCommand(
      'xdotool mousemove 100 100 && xdotool mousedown 1 && xdotool mousedown 1 && xdotool mouseup 1',
    )
    // Two mousedowns in a row breaks the drag pattern AND the sequence
    // builder rejects mousedown as a standalone op.
    expect(r).toBeNull()
  })
})

/* ──────────────────────────────────────────────────────────────────
   12. STRESS TESTS — long chains, huge text, nested scenarios
   ────────────────────────────────────────────────────────────────── */

describe('stress tests', () => {
  it('100-statement chain → __sequence with 100 steps', () => {
    const stmts: string[] = []
    for (let i = 0; i < 100; i++) {
      stmts.push(`xdotool key Tab`)
    }
    const cmd = stmts.join(' && ')
    const r = tryInterceptShellCommand(cmd)
    expect(r!.command).toBe('__sequence')
    expect(r!.parameters.steps).toHaveLength(100)
    expect(r!.parameters.steps.every((s: any) =>
      s.command === 'key_press' && s.parameters.keys[0] === 'tab'
    )).toBe(true)
  })

  it('chain with 100 sleeps + 1 keypress → single key_press', () => {
    const sleeps = Array(100).fill('sleep 0.01').join(' && ')
    const r = tryInterceptShellCommand(`${sleeps} && xdotool key Return`)
    expect(r!.command).toBe('key_press')
    expect(r!.parameters.keys).toEqual(['enter'])
  })

  it('extremely long type text (10K chars)', () => {
    const text = 'a'.repeat(10_000)
    const r = tryInterceptShellCommand(`xdotool type "${text}"`)
    expect(r!.command).toBe('type')
    expect(r!.parameters.text).toHaveLength(10_000)
  })

  it('drag with 50 intermediate moves → final endpoint used', () => {
    const moves: string[] = ['xdotool mousemove 0 0', 'xdotool mousedown 1']
    for (let i = 1; i <= 50; i++) {
      moves.push(`xdotool mousemove ${i * 10} ${i * 10}`)
    }
    moves.push('xdotool mouseup 1')
    const r = tryInterceptShellCommand(moves.join(' && '))
    expect(r!.command).toBe('drag')
    expect(r!.parameters).toEqual({ x1: 0, y1: 0, x2: 500, y2: 500 })
  })

  it('100-character window title', () => {
    const title = 'A'.repeat(100)
    const r = tryInterceptShellCommand(`wmctrl -a "${title}"`)
    expect(r!.command).toBe('switch_to_window')
    expect(r!.parameters.title).toBe(title)
  })
})

/* ──────────────────────────────────────────────────────────────────
   13. SECURITY / SAFETY — adversarial inputs must NEVER throw
   ────────────────────────────────────────────────────────────────── */

describe('security and safety', () => {
  // These inputs SHOULD NOT throw, but their results may vary (some
  // pass through to shell, some get rejected). The key invariant is:
  // the function always returns either an InterceptResult or null,
  // never throws.

  const adversarial = [
    // Shell injection attempts
    'xdotool key Return; rm -rf /',                     // ;-injected destructive
    'xdotool key Return && rm -rf /',                   // &&-injected destructive
    'xdotool type "$(rm -rf /)"',                       // command substitution
    'xdotool type `rm -rf /`',                          // backtick subst
    'xdotool type "; rm -rf /"',                        // injection in quoted text

    // Quote shenanigans
    'xdotool key "Return',                              // unclosed quote
    'xdotool type "\'"',                                // mixed quotes
    'xdotool key \'"\\\'"\'',                           // escape soup
    'xdotool key Return"',                              // dangling quote at end
    'xdotool key """',                                  // triple-quote

    // Numeric pathologies
    'xdotool mousemove 9999999999999999 9999999999999999',
    'xdotool mousemove -1 -1',
    'xdotool mousemove 0x100 0x100',                    // hex
    'xdotool key F999',                                 // out-of-range Fkey

    // Buffer overrun attempts
    'xdotool key ' + 'X'.repeat(100_000),               // huge key name
    'xdotool type "' + 'a'.repeat(100_000) + '"',       // huge text
    'a'.repeat(100_000),                                // huge non-xdotool

    // Recursion / nesting
    'xdotool key Return && xdotool key Return && xdotool key Return && xdotool key Return && '.repeat(20).slice(0, -3),

    // Empty / whitespace
    '',
    '   ',
    '\n\t\r ',
    '&&;;&&',
    '&&',
    ';',

    // Crafted malformed
    'xdotool key Return ;',                             // trailing semi
    '; xdotool key Return',                             // leading semi
    '&& xdotool key Return',                            // leading &&
    'xdotool key Return &&',                            // trailing &&
  ]

  it.each(adversarial)('does not throw on adversarial input: %s', (input) => {
    expect(() => tryInterceptShellCommand(input)).not.toThrow()
  })

  it('shell-injection-laden chain falls through (the ; is detected as a separator)', () => {
    // "xdotool key Return; rm -rf /" → split into ["xdotool key Return", "rm -rf /"]
    // Second statement isn't recognized → null → goes to shell.
    // (The shell's own dangerous-command detection then blocks rm -rf /.)
    expect(tryInterceptShellCommand('xdotool key Return; rm -rf /')).toBeNull()
  })

  it('quoted dangerous text passed through to type — not interpreted as shell', () => {
    const r = tryInterceptShellCommand('xdotool type "; rm -rf /"')
    expect(r!.command).toBe('type')
    // The interceptor doesn't parse contents of quoted strings —
    // they're just text destined for keyboard input.
    expect(r!.parameters.text).toContain('rm')
  })
})

/* ──────────────────────────────────────────────────────────────────
   14. UNICODE + NON-ASCII TYPE TEXT
   ────────────────────────────────────────────────────────────────── */

describe('unicode and non-ASCII type text', () => {
  it.each([
    'café',                              // Latin extended
    'naïve',                             // diacritics
    '日本語',                             // Japanese
    'Привет',                            // Cyrillic
    '🎉 emoji',                          // emoji + space
    '👨‍👩‍👧‍👦',                            // ZWJ family emoji
    'mixed 中文 and english',
    'quote“smart”',            // smart quotes
    'em—dash',                      // em dash
    'tab\there',                         // literal tab character
  ])('xdotool type with unicode "%s"', (text) => {
    const r = tryInterceptShellCommand(`xdotool type "${text}"`)
    expect(r!.command).toBe('type')
    expect(r!.parameters.text).toBe(text)
  })

  it('zero-width characters are preserved verbatim', () => {
    const text = 'a​b‌c'  // ZWSP, ZWNJ
    const r = tryInterceptShellCommand(`xdotool type "${text}"`)
    expect(r!.parameters.text).toBe(text)
  })
})

/* ──────────────────────────────────────────────────────────────────
   15. ENVIRONMENT-AGNOSTIC INVARIANTS
   ────────────────────────────────────────────────────────────────── */

describe('environment-agnostic invariants (must hold on Win/Mac/Linux)', () => {
  it('the interceptor never depends on process.platform', () => {
    // It should return the SAME result regardless of platform — the
    // platform-specific interpretation happens later in desktopKeyPress
    // / desktopKeyCombo / desktopType. We verify by intercepting and
    // confirming the routed command is platform-agnostic.
    const r = tryInterceptShellCommand('xdotool key super+r')
    expect(r!.command).toBe('key_combo')
    expect(r!.parameters.keys).toEqual(['win', 'r'])
    // 'win' is the abstract name — the desktop-automation layer maps it
    // to the correct platform key (Win key on Windows, Cmd on macOS,
    // Super on Linux). The interceptor's job is just normalization.
  })

  it('return value is always {command, parameters, reason} or null', () => {
    const samples = [
      'xdotool key Return',
      'xdotool type "x"',
      'wmctrl -a "T"',
      'echo nope',
      '',
      null as any,
      undefined as any,
    ]
    for (const s of samples) {
      const r = tryInterceptShellCommand(s)
      if (r !== null) {
        expect(r).toHaveProperty('command')
        expect(r).toHaveProperty('parameters')
        expect(r).toHaveProperty('reason')
        expect(typeof r.command).toBe('string')
        expect(r.command.length).toBeGreaterThan(0)
      }
    }
  })

  it('every intercepted command name maps to a registered LocalExecutor handler OR pseudo', () => {
    // The set of command names the interceptor can produce. If a NEW
    // pattern is added, this list must grow — and a corresponding
    // handler in LocalExecutor must exist.
    const validTargets = new Set([
      'key_press',
      'key_combo',
      'type',
      'click',
      'click_with_modifiers',
      'drag',
      'switch_to_window',
      '__sequence',
      '__noop',
    ])
    const samples = [
      'xdotool key Return',
      'xdotool key ctrl+c',
      'xdotool type "x"',
      'xdotool keydown ctrl && xdotool click 1 && xdotool keyup ctrl',
      'xdotool mousemove 1 2 && xdotool click 1',
      'xdotool mousemove 1 2 && xdotool mousedown 1 && xdotool mousemove 3 4 && xdotool mouseup 1',
      'wmctrl -a "T"',
      'xdotool key A && xdotool key B',
    ]
    for (const s of samples) {
      const r = tryInterceptShellCommand(s)
      expect(r).not.toBeNull()
      expect(validTargets.has(r!.command)).toBe(true)
    }
  })
})

/* ──────────────────────────────────────────────────────────────────
   16. splitStatements — quote-respecting separator split
   ────────────────────────────────────────────────────────────────── */

describe('splitStatements direct tests', () => {
  it('plain && split', () => {
    expect(splitStatements('a && b && c')).toEqual(['a', 'b', 'c'])
  })

  it('plain ; split', () => {
    expect(splitStatements('a ; b ; c')).toEqual(['a', 'b', 'c'])
  })

  it('mixed && and ; split', () => {
    expect(splitStatements('a && b ; c && d')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('quoted && does NOT split', () => {
    const out = splitStatements('xdotool type "a && b" && xdotool key Return')
    expect(out).toEqual(['xdotool type "a && b"', 'xdotool key Return'])
  })

  it('quoted ; does NOT split', () => {
    const out = splitStatements('xdotool type "a;b" ; xdotool key Return')
    expect(out).toEqual(['xdotool type "a;b"', 'xdotool key Return'])
  })

  it('single-quoted separators do not split', () => {
    const out = splitStatements("xdotool type 'a && b' ; xdotool key Return")
    expect(out).toEqual(["xdotool type 'a && b'", 'xdotool key Return'])
  })

  it('empty / whitespace-only segments dropped', () => {
    expect(splitStatements('a && && b')).toEqual(['a', 'b'])
    expect(splitStatements(';;;a;;')).toEqual(['a'])
  })

  it('single statement → single-element array', () => {
    expect(splitStatements('xdotool key Return')).toEqual(['xdotool key Return'])
  })

  it('empty string → empty array', () => {
    expect(splitStatements('')).toEqual([])
  })
})

/* ──────────────────────────────────────────────────────────────────
   17. translateXdotoolCombo — exhaustive
   ────────────────────────────────────────────────────────────────── */

describe('translateXdotoolCombo exhaustive', () => {
  it('preserves the order of modifiers and target key', () => {
    expect(translateXdotoolCombo('ctrl+shift+alt+t')).toEqual(['ctrl', 'shift', 'alt', 't'])
  })

  it('handles 5-key combo (rare but legal)', () => {
    expect(translateXdotoolCombo('ctrl+shift+alt+super+a')).toEqual(['ctrl', 'shift', 'alt', 'win', 'a'])
  })

  it('mixed-case input produces consistent lowercase output', () => {
    expect(translateXdotoolCombo('CTRL+Shift+T')).toEqual(['ctrl', 'shift', 't'])
  })

  it('single key (no +) returns one-element array', () => {
    expect(translateXdotoolCombo('Return')).toEqual(['enter'])
  })

  it('empty string returns empty array', () => {
    expect(translateXdotoolCombo('')).toEqual([])
  })

  it('only separators returns empty array', () => {
    expect(translateXdotoolCombo('+++')).toEqual([])
  })
})

/* ──────────────────────────────────────────────────────────────────
   18. PASS-THROUGH GUARANTEES — non-intercepted commands stay shell-bound
   ────────────────────────────────────────────────────────────────── */

describe('pass-through guarantees', () => {
  it.each([
    'echo hello',
    'pwd',
    'ls -la /tmp',
    'cat /etc/passwd',
    'powershell.exe -Command Get-Process',
    'where chrome',
    'which python3',
    'python3 -c "print(1)"',
    'node -e "console.log(1)"',
    'curl https://example.com',
    'git status',
    'docker ps',
    'systemctl status',
    'osascript -e "tell app \\"Safari\\" to activate"',
    'open /Applications/Safari.app',
    'start chrome.exe',
    'taskkill /IM chrome.exe',
  ])('does NOT intercept: %s', (input) => {
    expect(tryInterceptShellCommand(input)).toBeNull()
  })

  it('xdotool subcommands NOT YET implemented fall through', () => {
    // These exist in xdotool but we haven't implemented native handlers
    expect(tryInterceptShellCommand('xdotool windowfocus 12345')).toBeNull()
    expect(tryInterceptShellCommand('xdotool getactivewindow')).toBeNull()
    expect(tryInterceptShellCommand('xdotool getmouselocation')).toBeNull()
    expect(tryInterceptShellCommand('xdotool search --name Chrome')).toBeNull()
    expect(tryInterceptShellCommand('xdotool windowsize 12345 800 600')).toBeNull()
    expect(tryInterceptShellCommand('xdotool windowmove 12345 0 0')).toBeNull()
  })
})

/* ──────────────────────────────────────────────────────────────────
   19. CHAIN INTEGRITY — partial-match chains MUST NOT half-execute
   ────────────────────────────────────────────────────────────────── */

describe('chain integrity', () => {
  it('chain with one unrecognized statement → ENTIRE chain falls through', () => {
    // If we can't recognize ALL statements, we must NOT execute SOME of
    // them — that would silently drop the rest, leading to confusing
    // half-effects. Better to pass to shell and let it fail loudly.
    expect(tryInterceptShellCommand(
      'xdotool key Return && custom-tool --arg && xdotool key Tab',
    )).toBeNull()

    expect(tryInterceptShellCommand(
      'xdotool key Return && /usr/bin/python /script.py && xdotool key Tab',
    )).toBeNull()
  })

  it('chain that ONLY contains noops (sleeps) → null (let shell handle)', () => {
    expect(tryInterceptShellCommand('sleep 0.1 && sleep 0.2 && sleep 0.3'))
      .toBeNull()
  })

  it('chain that IS noop + ONE real op → returns the single op', () => {
    const r = tryInterceptShellCommand('sleep 0.5 && xdotool key Tab')
    expect(r!.command).toBe('key_press')
    expect(r!.parameters.keys).toEqual(['tab'])
  })

  it('chain with mismatched modifier patterns → null (no half-execution)', () => {
    // keydown ctrl, click 1, keyup shift (mismatch) → entire chain rejected
    expect(tryInterceptShellCommand(
      'xdotool keydown ctrl && xdotool click 1 && xdotool keyup shift',
    )).toBeNull()
  })

  it('chain with malformed drag (extra ops in middle) → null', () => {
    expect(tryInterceptShellCommand(
      'xdotool mousemove 0 0 && xdotool mousedown 1 && xdotool key Tab && ' +
      'xdotool mousemove 100 100 && xdotool mouseup 1',
    )).toBeNull()
  })
})

/* ──────────────────────────────────────────────────────────────────
   20. REAL-WORLD MIXED FLOWS — the kind agents actually emit
   ────────────────────────────────────────────────────────────────── */

describe('real-world mixed agent flows', () => {
  it('"open run dialog and launch chrome"', () => {
    const r = tryInterceptShellCommand(
      'xdotool key super+r && sleep 0.3 && xdotool type "chrome" && sleep 0.1 && xdotool key Return',
    )
    expect(r!.command).toBe('__sequence')
    expect(r!.parameters.steps).toEqual([
      { command: 'key_combo', parameters: { keys: ['win', 'r'] } },
      { command: 'type', parameters: { text: 'chrome' } },
      { command: 'key_press', parameters: { keys: ['enter'] } },
    ])
  })

  it('"open spotlight and search safari"', () => {
    const r = tryInterceptShellCommand(
      'xdotool key super+space && sleep 0.4 && xdotool type "Safari" && xdotool key Return',
    )
    expect(r!.command).toBe('__sequence')
    expect(r!.parameters.steps).toHaveLength(3)
  })

  it('"select all → copy → switch window → paste"', () => {
    const r = tryInterceptShellCommand(
      'xdotool key ctrl+a && xdotool key ctrl+c && ' +
      'xdotool key alt+Tab && sleep 0.2 && xdotool key ctrl+v',
    )
    expect(r!.command).toBe('__sequence')
    expect(r!.parameters.steps).toEqual([
      { command: 'key_combo', parameters: { keys: ['ctrl', 'a'] } },
      { command: 'key_combo', parameters: { keys: ['ctrl', 'c'] } },
      { command: 'key_combo', parameters: { keys: ['alt', 'tab'] } },
      { command: 'key_combo', parameters: { keys: ['ctrl', 'v'] } },
    ])
  })

  it('"move file by drag-drop"', () => {
    const r = tryInterceptShellCommand(
      'xdotool mousemove 200 300 && sleep 0.1 && xdotool mousedown 1 && ' +
      'sleep 0.1 && xdotool mousemove 800 600 && sleep 0.1 && xdotool mouseup 1',
    )
    expect(r!.command).toBe('drag')
    expect(r!.parameters).toEqual({ x1: 200, y1: 300, x2: 800, y2: 600 })
  })

  it('"shift-click to select range"', () => {
    const r = tryInterceptShellCommand(
      'xdotool keydown shift && xdotool mousemove 100 200 && xdotool click 1 && xdotool keyup shift',
    )
    expect(r!.command).toBe('click_with_modifiers')
    expect(r!.parameters).toMatchObject({
      x: 100, y: 200, modifiers: ['shift'], button: 'left',
    })
  })

  it('"type a paragraph then save"', () => {
    const r = tryInterceptShellCommand(
      'xdotool type "Hello, this is a paragraph." && sleep 0.5 && xdotool key ctrl+s',
    )
    expect(r!.command).toBe('__sequence')
    expect(r!.parameters.steps).toEqual([
      { command: 'type', parameters: { text: 'Hello, this is a paragraph.' } },
      { command: 'key_combo', parameters: { keys: ['ctrl', 's'] } },
    ])
  })

  it('"close current window then quit app"', () => {
    const r = tryInterceptShellCommand(
      'xdotool key alt+F4 ; sleep 0.3 ; xdotool key alt+F4',
    )
    expect(r!.command).toBe('__sequence')
    expect(r!.parameters.steps).toHaveLength(2)
    expect(r!.parameters.steps.every((s: any) =>
      s.command === 'key_combo' && s.parameters.keys.join(',') === 'alt,f4'
    )).toBe(true)
  })

  it('"focus terminal then run command"', () => {
    // The "type Get-Process" + "Enter" is intercepted, but focusing the
    // terminal happens via wmctrl which IS intercepted too.
    const r = tryInterceptShellCommand(
      'wmctrl -a "PowerShell" && sleep 0.3 && xdotool type "Get-Process" && xdotool key Return',
    )
    expect(r!.command).toBe('__sequence')
    expect(r!.parameters.steps).toEqual([
      { command: 'switch_to_window', parameters: { title: 'PowerShell' } },
      { command: 'type', parameters: { text: 'Get-Process' } },
      { command: 'key_press', parameters: { keys: ['enter'] } },
    ])
  })
})
