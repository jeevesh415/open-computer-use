/**
 * Shell-command interceptor.
 *
 * The Coasty backend agent (CUA) was authored for Linux automation, so it
 * emits commands like `xdotool key Return`, `xdotool mousemove --sync X Y`,
 * `wmctrl -a "Title"`, `sleep 0.2`, etc. via terminal_execute. On Windows
 * and macOS those tools don't exist and every command fails with "command
 * not found", breaking the agent's automation chain.
 *
 * This module parses the shell command string and, when it matches a known
 * cross-platform pattern, returns the equivalent NATIVE Coasty command +
 * parameters. The LocalExecutor then dispatches that native command instead
 * of running the failing shell.
 *
 * Patterns recognized (single-statement):
 *   xdotool key [flags] KEY                → key_press
 *   xdotool key [flags] MOD+KEY            → key_combo
 *   xdotool keydown / keyup KEY            → key_press
 *   xdotool type [flags] "text"            → type
 *   wmctrl -a "Window Title"               → switch_to_window
 *
 * Patterns recognized (multi-statement, joined by && or ;):
 *   mousemove X1 Y1 → mousedown 1 → [mousemove(s)] → mouseup 1
 *      → drag { x1, y1, x2, y2 }
 *   keydown MOD(s) → mousemove X1 Y1 → mousedown 1 → [mousemove(s)] →
 *      mouseup 1 → keyup MOD(s)
 *      → drag { x1, y1, x2, y2, hold_keys }
 *   keydown MOD → click N → keyup MOD
 *      → click_with_modifiers { x?, y?, modifiers, button }
 *   mousemove X Y → click N
 *      → click { x, y, button }
 *   any other chain of fully-recognized statements
 *      → __sequence { steps: [...] }   (executed serially by LocalExecutor)
 *
 * `sleep <N>` is recognized but treated as a NO-OP — the native handlers
 * already include their own platform-appropriate delays, and forcing the
 * agent's Linux-tuned sleep budget on top would just slow everything down.
 *
 * Anything not recognized falls through to the shell as before.
 */

export interface InterceptResult {
  command: string
  parameters: Record<string, any>
  /** Human-readable description for logging. */
  reason: string
}

/** Internal: parsed individual statement. */
type ParsedOp =
  | { kind: 'noop' }
  | { kind: 'key_press'; keys: string[] }
  | { kind: 'key_combo'; keys: string[] }
  | { kind: 'keydown'; key: string }
  | { kind: 'keyup'; key: string }
  | { kind: 'type'; text: string }
  | { kind: 'mousemove'; x: number; y: number }
  | { kind: 'mousedown'; button: number }
  | { kind: 'mouseup'; button: number }
  | { kind: 'click'; button: number; x?: number; y?: number }
  | { kind: 'switch_window'; title: string }

/* ─── xdotool keysym → Coasty key-name translation ──────────────── */

const XDOTOOL_KEYSYM: Record<string, string> = {
  // Modifiers
  super: 'win', super_l: 'win', super_r: 'win',
  meta: 'win', meta_l: 'win', meta_r: 'win',
  ctrl: 'ctrl', control: 'ctrl', control_l: 'ctrl', control_r: 'ctrl',
  alt: 'alt', alt_l: 'alt', alt_r: 'alt',
  shift: 'shift', shift_l: 'shift', shift_r: 'shift',

  // Navigation / editing
  return: 'enter', kp_enter: 'enter',
  escape: 'esc', esc: 'esc',
  backspace: 'backspace',
  delete: 'delete', kp_delete: 'delete',
  tab: 'tab', iso_left_tab: 'tab',
  space: 'space',
  up: 'up', down: 'down', left: 'left', right: 'right',
  home: 'home', end: 'end',
  page_up: 'pageup', pageup: 'pageup', prior: 'pageup',
  page_down: 'pagedown', pagedown: 'pagedown', next: 'pagedown',
  insert: 'insert',

  // Locks / sysreq
  caps_lock: 'capslock', capslock: 'capslock',
  num_lock: 'numlock', numlock: 'numlock',
  scroll_lock: 'scrolllock', scrolllock: 'scrolllock',
  print: 'printscreen', sys_req: 'printscreen',
  pause: 'pause', break: 'pause',

  // Numpad
  kp_0: '0', kp_1: '1', kp_2: '2', kp_3: '3', kp_4: '4',
  kp_5: '5', kp_6: '6', kp_7: '7', kp_8: '8', kp_9: '9',
  kp_add: '+', kp_subtract: '-', kp_multiply: '*', kp_divide: '/',
  kp_decimal: '.',
}

export function translateXdotoolKey(key: string): string {
  if (!key) return key
  const lower = key.toLowerCase()
  if (XDOTOOL_KEYSYM[lower]) return XDOTOOL_KEYSYM[lower]
  if (/^f\d{1,2}$/.test(lower)) return lower
  return lower
}

export function translateXdotoolCombo(combo: string): string[] {
  return combo.split('+').filter(Boolean).map(translateXdotoolKey)
}

/* ─── xdotool mouse-button mapping ──────────────────────────────── */
// xdotool numbering: 1=left, 2=middle, 3=right, 4/5=scroll up/down
const XDOTOOL_BUTTON: Record<number, 'left' | 'middle' | 'right'> = {
  1: 'left', 2: 'middle', 3: 'right',
}

/* ─── Tokenizer (quote-aware) ───────────────────────────────────── */

function tokenize(cmd: string): string[] {
  const tokens: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    if (quote) {
      if (c === quote) {
        quote = null
      } else if (c === '\\' && cmd[i + 1] === quote) {
        cur += cmd[i + 1]; i++
      } else {
        cur += c
      }
    } else if (c === '"' || c === "'") {
      quote = c as any
    } else if (/\s/.test(c)) {
      if (cur) { tokens.push(cur); cur = '' }
    } else {
      cur += c
    }
  }
  if (cur) tokens.push(cur)
  return tokens
}

/**
 * Split a shell command on top-level statement separators (`&&` and `;`),
 * respecting quotes. Subshells `()` and `{}` blocks are not supported —
 * such constructs aren't intercepted and fall through to the shell.
 */
export function splitStatements(cmd: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  let i = 0
  while (i < cmd.length) {
    const c = cmd[i]
    if (quote) {
      if (c === quote) { quote = null }
      else if (c === '\\' && cmd[i + 1] === quote) { cur += c + cmd[i + 1]; i += 2; continue }
      cur += c
      i++
    } else if (c === '"' || c === "'") {
      quote = c as any; cur += c; i++
    } else if (c === '&' && cmd[i + 1] === '&') {
      const trimmed = cur.trim()
      if (trimmed) out.push(trimmed)
      cur = ''; i += 2
    } else if (c === ';') {
      const trimmed = cur.trim()
      if (trimmed) out.push(trimmed)
      cur = ''; i++
    } else {
      cur += c; i++
    }
  }
  const trimmed = cur.trim()
  if (trimmed) out.push(trimmed)
  return out
}

/* ─── Flag-stripping ────────────────────────────────────────────── */

const XDOTOOL_FLAGS_WITH_VALUE = new Set([
  '--window', '--delay', '--repeat', '--repeat-delay',
])

function stripXdotoolFlags(tokens: string[]): string[] {
  const out: string[] = []
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (t === '--') { i++; continue }
    if (t.startsWith('--')) {
      if (XDOTOOL_FLAGS_WITH_VALUE.has(t)) { i += 2 } else { i++ }
      continue
    }
    out.push(t); i++
  }
  return out
}

/* ─── Per-statement parsing ─────────────────────────────────────── */

function parseSleep(tokens: string[]): ParsedOp | null {
  if (tokens.length < 2 || tokens[0] !== 'sleep') return null
  // sleep N — N may be float ("0.2"). We don't actually wait — it's a no-op.
  if (isNaN(parseFloat(tokens[1]))) return null
  return { kind: 'noop' }
}

/** Parse `wmctrl -a "title"` → switch_window. */
function parseWmctrl(tokens: string[]): ParsedOp | null {
  if (tokens.length < 3 || tokens[0] !== 'wmctrl') return null
  if (tokens[1] !== '-a') return null
  const title = tokens.slice(2).join(' ')
  if (!title) return null
  return { kind: 'switch_window', title }
}

function parseXdotool(tokens: string[]): ParsedOp | null {
  if (tokens.length < 2 || tokens[0] !== 'xdotool') return null
  const sub = tokens[1]

  if (sub === 'key' || sub === 'keydown' || sub === 'keyup') {
    const positional = stripXdotoolFlags(tokens.slice(2))
    if (positional.length === 0) return null

    if (sub === 'keydown') {
      // Only meaningful in chains — single key only
      if (positional.length !== 1) return null
      return { kind: 'keydown', key: translateXdotoolKey(positional[0]) }
    }
    if (sub === 'keyup') {
      if (positional.length !== 1) return null
      return { kind: 'keyup', key: translateXdotoolKey(positional[0]) }
    }

    // sub === 'key' — treat combos and sequences appropriately
    const hasCombo = positional.some((p) => p.includes('+'))
    if (hasCombo) {
      const keys: string[] = []
      for (const tok of positional) {
        if (tok.includes('+')) keys.push(...translateXdotoolCombo(tok))
        else keys.push(translateXdotoolKey(tok))
      }
      return { kind: 'key_combo', keys }
    }
    return { kind: 'key_press', keys: positional.map(translateXdotoolKey) }
  }

  if (sub === 'type') {
    const positional = stripXdotoolFlags(tokens.slice(2))
    if (positional.length === 0) return null
    return { kind: 'type', text: positional.join(' ') }
  }

  if (sub === 'mousemove') {
    const positional = stripXdotoolFlags(tokens.slice(2))
    // Filter out --sync if present (handled by stripXdotoolFlags) and just
    // take the two coordinates. Some agents emit `mousemove_relative` —
    // we don't support that yet; return null to fall back to shell.
    if (positional.length < 2) return null
    const x = parseInt(positional[0], 10)
    const y = parseInt(positional[1], 10)
    if (isNaN(x) || isNaN(y)) return null
    return { kind: 'mousemove', x, y }
  }

  if (sub === 'mousedown' || sub === 'mouseup') {
    const positional = stripXdotoolFlags(tokens.slice(2))
    if (positional.length === 0) return null
    const button = parseInt(positional[0], 10)
    if (isNaN(button) || !XDOTOOL_BUTTON[button]) return null
    return { kind: sub, button }
  }

  if (sub === 'click') {
    const positional = stripXdotoolFlags(tokens.slice(2))
    if (positional.length === 0) return null
    const button = parseInt(positional[0], 10)
    if (isNaN(button) || !XDOTOOL_BUTTON[button]) return null
    // xdotool click clicks at the CURRENT cursor position. If we don't have
    // x/y from a preceding mousemove (handled by chain recognizer), we can
    // still emit a click at the current logical cursor — but we don't have
    // a "click at current position" handler. Return null and let the chain
    // recognizer resurrect this when paired with mousemove.
    return { kind: 'click', button }
  }

  // Unsupported subcommand → null
  return null
}

/** Try every per-statement parser in order. */
function parseStatement(stmt: string): ParsedOp | null {
  const tokens = tokenize(stmt)
  if (tokens.length === 0) return null
  if (tokens[0] === 'sleep') return parseSleep(tokens)
  if (tokens[0] === 'wmctrl') return parseWmctrl(tokens)
  if (tokens[0] === 'xdotool') return parseXdotool(tokens)
  return null
}

/** Convert a parsed op into an executable Coasty command (used for both
 *  single-statement intercepts and as steps inside a __sequence). */
function opToCommand(op: ParsedOp): { command: string; parameters: any } | null {
  switch (op.kind) {
    case 'key_press':
      return { command: 'key_press', parameters: { keys: op.keys } }
    case 'key_combo':
      return { command: 'key_combo', parameters: { keys: op.keys } }
    case 'type':
      return { command: 'type', parameters: { text: op.text } }
    case 'switch_window':
      return { command: 'switch_to_window', parameters: { title: op.title } }
    case 'noop':
      // Sleep-only — sequence-step no-op. The LocalExecutor recognizes
      // this and returns success silently.
      return { command: '__noop', parameters: {} }
    case 'keydown':
    case 'keyup':
      // Standalone keydown/keyup → treat as a full press. The chain
      // recognizers (modifier+click) handle the down/up pairing structurally.
      return { command: 'key_press', parameters: { keys: [op.key] } }
    default:
      // mousedown/up, mousemove, click are only meaningful inside a chain
      // recognized by recognizeDrag / recognizeModifierClick /
      // recognizePositionedClick. They cannot be executed standalone.
      return null
  }
}

/** Build a reason string that includes the actionable params for logging. */
function reasonFor(opKind: string, cmd: { command: string; parameters: any }): string {
  if (Array.isArray(cmd.parameters?.keys)) {
    return `${opKind} → ${cmd.command} ${JSON.stringify(cmd.parameters.keys)}`
  }
  if (typeof cmd.parameters?.text === 'string') {
    return `${opKind} → ${cmd.command} ${JSON.stringify(cmd.parameters.text.slice(0, 50))}`
  }
  if (typeof cmd.parameters?.title === 'string') {
    return `${opKind} → ${cmd.command} ${JSON.stringify(cmd.parameters.title)}`
  }
  return `${opKind} → ${cmd.command}`
}

/* ─── Multi-statement pattern recognizers ───────────────────────── */

/**
 * Drag pattern: mousemove X1 Y1 → mousedown N → [mousemove(s)] → mouseup N
 * (sleeps interspersed are filtered out)
 *
 * Returns intercept routing to the native `drag` handler.
 */
function recognizeDrag(ops: ParsedOp[]): InterceptResult | null {
  // Filter noops (sleeps)
  const real = ops.filter((o) => o.kind !== 'noop')
  if (real.length < 4) return null

  const first = real[0]
  const second = real[1]
  const last = real[real.length - 1]

  if (first.kind !== 'mousemove') return null
  if (second.kind !== 'mousedown') return null
  if (last.kind !== 'mouseup') return null
  if (second.button !== last.button) return null

  // Gather endpoint from the LAST mousemove between mousedown and mouseup
  let lastX = first.x, lastY = first.y
  let sawIntermediate = false
  for (let i = 2; i < real.length - 1; i++) {
    const o = real[i]
    if (o.kind === 'mousemove') {
      lastX = o.x; lastY = o.y; sawIntermediate = true
    } else {
      // Unexpected op in the middle — not a clean drag
      return null
    }
  }
  if (!sawIntermediate) return null

  return {
    command: 'drag',
    parameters: { x1: first.x, y1: first.y, x2: lastX, y2: lastY },
    reason: `xdotool drag chain → drag (${first.x},${first.y})→(${lastX},${lastY})`,
  }
}

/**
 * Modifier+drag pattern:
 *   keydown MOD(s) → mousemove X1 Y1 → mousedown N → [mousemove(s)] →
 *   mouseup N → keyup MOD(s)
 *
 * The agent emits this for shift-drag (text-selection extension), ctrl-drag
 * (multi-select), alt-drag (resize), etc. The chain failed silently before:
 * none of the existing recognizers handled the leading keydowns + drag, so
 * it fell through to the shell where Linux xdotool isn't installed and
 * PowerShell choked on `&&` (PS 5.1 syntax error). Routes to the native
 * `drag` handler with `hold_keys` — desktopDrag already supports modifiers
 * on Windows / macOS / Linux.
 */
function recognizeModifierDrag(ops: ParsedOp[]): InterceptResult | null {
  const real = ops.filter((o) => o.kind !== 'noop')
  // Need at minimum: 1 keydown + mousemove + mousedown + mousemove + mouseup + 1 keyup = 6
  if (real.length < 6) return null

  // Leading keydowns
  const modifiers: string[] = []
  let i = 0
  while (i < real.length && real[i].kind === 'keydown') {
    modifiers.push((real[i] as any).key)
    i++
  }
  if (modifiers.length === 0) return null

  // Required: mousemove (start) → mousedown → ... → mouseup
  if (i >= real.length || real[i].kind !== 'mousemove') return null
  const startMv = real[i] as any
  const x1 = startMv.x, y1 = startMv.y
  i++

  if (i >= real.length || real[i].kind !== 'mousedown') return null
  const downBtn = (real[i] as any).button
  i++

  // Intermediate mousemoves — at least one required (otherwise it's not a drag)
  let lastX = x1, lastY = y1
  let sawIntermediate = false
  while (i < real.length && real[i].kind === 'mousemove') {
    const mv = real[i] as any
    lastX = mv.x; lastY = mv.y
    sawIntermediate = true
    i++
  }
  if (!sawIntermediate) return null

  if (i >= real.length || real[i].kind !== 'mouseup') return null
  if ((real[i] as any).button !== downBtn) return null
  i++

  // Trailing keyups must match the leading keydowns (same set, any order)
  const keyups: string[] = []
  while (i < real.length && real[i].kind === 'keyup') {
    keyups.push((real[i] as any).key)
    i++
  }
  if (i !== real.length) return null
  if (keyups.length !== modifiers.length) return null
  const sortedDowns = [...modifiers].sort()
  const sortedUps = [...keyups].sort()
  if (sortedDowns.join(',') !== sortedUps.join(',')) return null

  return {
    command: 'drag',
    parameters: { x1, y1, x2: lastX, y2: lastY, hold_keys: modifiers },
    reason: `xdotool modifier-drag chain → drag (${x1},${y1})→(${lastX},${lastY}) hold ${JSON.stringify(modifiers)}`,
  }
}

/**
 * Modifier+click pattern: keydown MOD → click N → keyup MOD
 * (optionally with a leading mousemove for positioned click)
 */
function recognizeModifierClick(ops: ParsedOp[]): InterceptResult | null {
  const real = ops.filter((o) => o.kind !== 'noop')
  if (real.length < 3) return null

  // Collect leading keydowns + optional mousemove + click + matching keyups
  const modifiers: string[] = []
  let i = 0
  while (i < real.length && real[i].kind === 'keydown') {
    modifiers.push((real[i] as any).key)
    i++
  }
  if (modifiers.length === 0) return null

  let x: number | undefined, y: number | undefined
  if (i < real.length && real[i].kind === 'mousemove') {
    const mv = real[i] as any
    x = mv.x; y = mv.y; i++
  }

  if (i >= real.length || real[i].kind !== 'click') return null
  const click = real[i] as any
  i++

  // Trailing keyups must match the keydowns (same modifiers, in some order)
  const keyups: string[] = []
  while (i < real.length && real[i].kind === 'keyup') {
    keyups.push((real[i] as any).key)
    i++
  }
  if (i !== real.length) return null
  if (keyups.length !== modifiers.length) return null
  // Order doesn't matter — just need same set
  const sortedDowns = [...modifiers].sort()
  const sortedUps = [...keyups].sort()
  if (sortedDowns.join(',') !== sortedUps.join(',')) return null

  const button = XDOTOOL_BUTTON[click.button] ?? 'left'
  return {
    command: 'click_with_modifiers',
    parameters: {
      ...(x !== undefined && y !== undefined ? { x, y } : {}),
      modifiers,
      button,
    },
    reason: `xdotool keydown+click+keyup chain → click_with_modifiers ${JSON.stringify(modifiers)} ${button}`,
  }
}

/** Positioned click: mousemove X Y → click N (no modifiers) */
function recognizePositionedClick(ops: ParsedOp[]): InterceptResult | null {
  const real = ops.filter((o) => o.kind !== 'noop')
  if (real.length !== 2) return null
  if (real[0].kind !== 'mousemove') return null
  if (real[1].kind !== 'click') return null
  const mv = real[0] as any
  const click = real[1] as any
  const button = XDOTOOL_BUTTON[click.button] ?? 'left'
  if (button === 'left') {
    return {
      command: 'click',
      parameters: { x: mv.x, y: mv.y },
      reason: `xdotool mousemove+click → click (${mv.x},${mv.y})`,
    }
  }
  return {
    command: 'click_with_modifiers',
    parameters: { x: mv.x, y: mv.y, modifiers: [], button },
    reason: `xdotool mousemove+click → click_with_modifiers (${mv.x},${mv.y}) ${button}`,
  }
}

/** Generic fallback: every statement is independently recognizable as a
 *  Coasty command — execute them as a sequence. */
function buildSequence(ops: ParsedOp[]): InterceptResult | null {
  const steps: { command: string; parameters: any }[] = []
  for (const op of ops) {
    const cmd = opToCommand(op)
    if (!cmd) return null
    steps.push(cmd)
  }
  // Filter out noops that are the only step
  const realSteps = steps.filter((s) => s.command !== '__noop')
  if (realSteps.length === 0) return null
  if (realSteps.length === 1) {
    return {
      command: realSteps[0].command,
      parameters: realSteps[0].parameters,
      reason: `chain → single ${realSteps[0].command}`,
    }
  }
  return {
    command: '__sequence',
    parameters: { steps: realSteps },
    reason: `chain → sequence of ${realSteps.length} steps`,
  }
}

/* ─── Public entrypoint ─────────────────────────────────────────── */

/**
 * Linux-only tools the agent emits that cannot run on Windows / macOS.
 * Used as a defence-in-depth check after `tryInterceptShellCommand` returns
 * null — keeps unsupported patterns from leaking into PowerShell where they
 * produce confusing syntax errors (`&&` is not a valid statement separator
 * in PS 5.1) instead of a clear "unsupported on this platform" failure.
 */
const LINUX_ONLY_TOOLS = new Set(['xdotool', 'wmctrl'])

/**
 * Returns a clean failure result when `cmd` starts with a Linux-only tool
 * (or chains entirely composed of such tools) and we're not on Linux.
 * Caller checks this AFTER `tryInterceptShellCommand` returns null — a
 * recognized chain is always preferred over a hard fail.
 *
 * Returning null means "let the shell handle it normally."
 */
export function checkUnsupportedShellCommand(
  cmd: unknown,
  platform: NodeJS.Platform = process.platform,
): { success: false; error: string } | null {
  if (platform === 'linux') return null
  if (typeof cmd !== 'string') return null
  const trimmed = cmd.trim()
  if (!trimmed) return null

  let statements: string[]
  try {
    statements = splitStatements(trimmed)
  } catch {
    return null
  }
  if (statements.length === 0) return null

  // If ANY statement starts with a Linux-only tool, fail the whole chain.
  // The agent built the chain as one operation; partial execution is worse
  // than a clean refusal — half a drag with the modifier still held would
  // strand keyboard state.
  for (const stmt of statements) {
    const tokens = tokenize(stmt)
    if (tokens.length === 0) continue
    if (LINUX_ONLY_TOOLS.has(tokens[0])) {
      return {
        success: false,
        error:
          `Unsupported Linux-only command on ${platform}: "${tokens[0]}". ` +
          `The shell-intercept layer didn't recognize this pattern; route ` +
          `through the equivalent native handler (click / drag / key_press / ` +
          `type / switch_to_window) instead.`,
      }
    }
  }
  return null
}

export function tryInterceptShellCommand(cmd: unknown): InterceptResult | null {
  if (typeof cmd !== 'string') return null
  const trimmed = cmd.trim()
  if (!trimmed) return null

  let statements: string[]
  try {
    statements = splitStatements(trimmed)
  } catch {
    return null
  }
  if (statements.length === 0) return null

  // Parse every statement
  const parsed: ParsedOp[] = []
  for (const stmt of statements) {
    const op = parseStatement(stmt)
    if (!op) return null  // Any unrecognized statement → fall through to shell
    parsed.push(op)
  }

  // Single-statement fast paths
  if (parsed.length === 1) {
    const op = parsed[0]
    const single = opToCommand(op)
    if (!single) return null
    if (single.command === '__noop') return null  // bare `sleep N` — let shell run it (cheap)
    return {
      command: single.command,
      parameters: single.parameters,
      reason: reasonFor(op.kind, single),
    }
  }

  // Multi-statement: try the structural patterns first, then generic sequence.
  // Order matters — more-specific patterns (with leading keydowns) before
  // their plain counterparts so a shift-drag isn't misread as a plain drag
  // surrounded by keyup/keydown that buildSequence then can't lift.
  const modDrag = recognizeModifierDrag(parsed)
  if (modDrag) return modDrag

  const drag = recognizeDrag(parsed)
  if (drag) return drag

  const modClick = recognizeModifierClick(parsed)
  if (modClick) return modClick

  const posClick = recognizePositionedClick(parsed)
  if (posClick) return posClick

  return buildSequence(parsed)
}
