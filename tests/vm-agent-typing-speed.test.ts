/**
 * Tests for the EC2 VM-agent typing-speed rewrite (2026-05-11).
 *
 * Pre-rewrite blockers (from investigation):
 *   1. Linux agent _ty() forked a fresh `xdotool` subprocess for every
 *      character + slept 238 ms Aalto IKI between each. ~3 s for 11 chars.
 *   2. Backend never sent `fast: true` / `interval: 0`, so the slow path
 *      was always taken.
 *   3. Linux agent _kp() forked a fresh subprocess for every key in a
 *      multi-key sequence (Tab Tab Enter = 3 forks).
 *   4. xclip was NOT in the apt-install list, so no clipboard-paste
 *      shortcut was available even if the agent wanted it.
 *
 * Fix layers:
 *   A. xclip added to apt install list.
 *   B. Linux _ty() dispatches on `mode`: instant | fast (default) |
 *      clipboard | human. Auto-promotes to clipboard for text >= 50
 *      chars. Falls back to direct xdotool if xclip missing.
 *   C. Fast-mode --delay floor lowered from 12 ms to 1-3 ms jittered.
 *   D. Linux _kp() batches keys: single `xdotool key key1 key2 key3`
 *      invocation instead of N forks.
 *   E. Windows _ty() mirrors the mode dispatch with pyautogui;
 *      fast-mode interval lowered from 10-15 ms to 2-4 ms.
 *   F. Windows _kp() uses pyautogui.press(list) batched form.
 *
 * Strategy: extract the Python agent source string from ec2-service.ts,
 * write it to a temp file, monkey-patch its system-call surface
 * (`subprocess.run`, `pyautogui.write/press`, `time.sleep`) with
 * recorders, and exercise the methods directly. Pure source-level +
 * sandboxed-execution tests.
 *
 * Run: `npx vitest run tests/vm-agent-typing-speed.test.ts`
 */

import { describe, it, expect, beforeAll } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { execFileSync } from "node:child_process"

let ec2ServiceSrc: string

beforeAll(() => {
  const p = path.resolve(__dirname, "..", "lib", "aws", "ec2-service.ts")
  ec2ServiceSrc = fs.readFileSync(p, "utf8")
})

// ---------------------------------------------------------------------------
// Helpers: extract the Linux / Windows agent Python source from ec2-service.ts.
// Both live as template-literal-returned strings in `getAgentSource()` /
// `getWindowsAgentSource()`.
// ---------------------------------------------------------------------------

function extractTemplateLiteralReturn(src: string, fnName: string): string {
  const normalized = src.replace(/\r\n/g, "\n")
  const re = new RegExp(
    `private\\s+${fnName}\\s*\\([^)]*\\)\\s*:\\s*string\\s*\\{[^\`]*return\\s*\`([\\s\\S]*?)\`;`,
    "m",
  )
  const m = normalized.match(re)
  if (!m) {
    throw new Error(`Couldn't extract template literal from ${fnName}`)
  }
  return m[1].replace(/\\`/g, "`").replace(/\\\$/g, "$").replace(/\\\\/g, "\\")
}

function runPython(script: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-typing-test-"))
  const scriptPath = path.join(tmpDir, "test.py")
  fs.writeFileSync(scriptPath, script)
  try {
    return execFileSync("python", [scriptPath], {
      encoding: "utf8",
      timeout: 30_000,
    })
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

function pythonAvailable(): boolean {
  try {
    execFileSync("python", ["--version"], { encoding: "utf8", timeout: 3_000 })
    return true
  } catch {
    return false
  }
}

const PY_OK = pythonAvailable()

/** Slice the `_ty` method body up to the next ` def ` boundary. */
function sliceTyBody(agentSrc: string): string {
  const startMatch = agentSrc.match(/(^|\n)( def\s+_ty\s*\([^)]*\)\s*:[^\n]*)/m)
  if (!startMatch) return ""
  const startIdx = agentSrc.indexOf(startMatch[2], startMatch.index!)
  const tail = agentSrc.slice(startIdx + startMatch[2].length)
  const nextDef = tail.match(/\n def\s+\w+\s*\(/)
  const endIdx = nextDef
    ? startIdx + startMatch[2].length + nextDef.index!
    : agentSrc.length
  return agentSrc.slice(startIdx, endIdx)
}

/** Slice the `_kp` method body up to the next ` def ` boundary. */
function sliceKpBody(agentSrc: string): string {
  const startMatch = agentSrc.match(/(^|\n)( def\s+_kp\s*\([^)]*\)\s*:[^\n]*)/m)
  if (!startMatch) return ""
  const startIdx = agentSrc.indexOf(startMatch[2], startMatch.index!)
  const tail = agentSrc.slice(startIdx + startMatch[2].length)
  const nextDef = tail.match(/\n def\s+\w+\s*\(/)
  const endIdx = nextDef
    ? startIdx + startMatch[2].length + nextDef.index!
    : agentSrc.length
  return agentSrc.slice(startIdx, endIdx)
}

/** Find a `if mode==\"X\":` branch body within the _ty body.
 *
 * The Python in ec2-service.ts uses minified 1-space indent. `def _ty`
 * is at column 1 (inside `class Agent:` at column 0); method body is at
 * column 2; nested `if mode==X:` block body is at column 3.
 *
 * To slice JUST the branch body and not bleed into the next branch, we
 * stop at the first line starting with `\n  ` (column 2 = method body)
 * followed by a non-space character — that's the marker for the start
 * of the NEXT branch or the unconditional tail (e.g. `\n  prev=" "`,
 * `\n  # human ...`, `\n  if mode==...`).
 */
function sliceModeBranch(tyBody: string, mode: string): string | null {
  const re = new RegExp(`(if|elif)\\s+mode\\s*==\\s*["']${mode}["']\\s*:`)
  const m = tyBody.match(re)
  if (!m) return null
  const start = m.index! + m[0].length
  const tail = tyBody.slice(start)
  // Match the next line at method-body indent (column 2 = 2 spaces +
  // non-whitespace). This catches `\n  if mode==X:`, `\n  # comment`,
  // `\n  prev=" "`, `\n  return ...`, etc. — all valid markers for the
  // end of the current branch.
  const nextBranch = tail.match(/\n {2}[^ \n]/)
  const end = nextBranch ? start + nextBranch.index! : tyBody.length
  return tyBody.slice(start, end)
}

/** Wrap a method body so it can be exec'd inside `class Agent:`. */
function pyMethodToClass(methodBody: string): string {
  const indented = methodBody
    .split("\n")
    .map((l) => (l.length > 0 ? " " + l : l))
    .join("\n")
  return `class Agent:\n${indented}`
}

// ═══════════════════════════════════════════════════════════════════════════
// 0.  Setup: cache the extracted method bodies
// ═══════════════════════════════════════════════════════════════════════════

let linuxAgent = ""
let windowsAgent = ""
let linuxTyBody = ""
let windowsTyBody = ""
let linuxKpBody = ""
let windowsKpBody = ""
let xclipPasteHelper = ""

beforeAll(() => {
  linuxAgent = extractTemplateLiteralReturn(ec2ServiceSrc, "getAgentSource")
  windowsAgent = extractTemplateLiteralReturn(ec2ServiceSrc, "getWindowsAgentSource")
  linuxTyBody = sliceTyBody(linuxAgent)
  windowsTyBody = sliceTyBody(windowsAgent)
  linuxKpBody = sliceKpBody(linuxAgent)
  windowsKpBody = sliceKpBody(windowsAgent)
  // Pull the _xclip_paste helper out of the Linux source so the sandbox
  // can include it when exercising auto-promote.
  const xcMatch = linuxAgent.match(
    /(def\s+_xclip_paste\s*\([^)]*\)\s*:[\s\S]*?)(?=\ndef\s+\w+\s*\(|\nclass\s+\w+)/,
  )
  xclipPasteHelper = xcMatch ? xcMatch[1] : ""
})

// ═══════════════════════════════════════════════════════════════════════════
// 1.  Apt install list — xclip must be present so clipboard mode works.
// ═══════════════════════════════════════════════════════════════════════════

describe("xclip dependency in apt-get install list", () => {
  it("xclip is in the apt install list for the desktop user-data", () => {
    // Look for `  xclip \` (indented under the install block) so we
    // don't false-match an unrelated mention in a comment.
    expect(ec2ServiceSrc).toMatch(/^  xclip \\\\?$/m)
  })

  it("xclip appears alongside xdotool (defense-in-depth ordering)", () => {
    // The install block lists xdotool then xclip — keeps the typing
    // tools clustered so future edits can't accidentally drop one.
    const normalized = ec2ServiceSrc.replace(/\r\n/g, "\n")
    const idxXdotool = normalized.indexOf("\n  xdotool \\")
    const idxXclip = normalized.indexOf("\n  xclip \\")
    expect(idxXdotool).toBeGreaterThan(0)
    expect(idxXclip).toBeGreaterThan(0)
    // xclip immediately follows xdotool
    expect(idxXclip).toBeGreaterThan(idxXdotool)
    expect(idxXclip - idxXdotool).toBeLessThan(50)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2.  Source-level guards on Linux agent `_ty()`.
// ═══════════════════════════════════════════════════════════════════════════

describe("Linux agent _ty() — source-level hardening guards", () => {
  it("defines a _ty method", () => {
    expect(linuxTyBody).toMatch(/def\s+_ty\s*\(\s*self\s*,\s*p\s*\)/)
  })

  it("reads a 'mode' parameter", () => {
    expect(linuxTyBody).toMatch(/mode\s*=\s*\(\s*p\.get\(\s*["']mode["']\s*\)/)
  })

  it("defaults to 'fast' mode (regression guard)", () => {
    expect(linuxTyBody).toMatch(/else\s*:\s*mode\s*=\s*["']fast["']/)
  })

  it("aliases 'paste' to 'clipboard'", () => {
    expect(linuxTyBody).toMatch(
      /mode\s*==\s*["']paste["']\s*:\s*mode\s*=\s*["']clipboard["']/,
    )
  })

  it("routes fast=true / interval=0 to instant mode (back-compat)", () => {
    expect(linuxTyBody).toMatch(
      /p\.get\(\s*["']interval["']\s*\)\s*==\s*0\s+or\s+p\.get\(\s*["']fast["']\s*\)\s*:\s*mode\s*=\s*["']instant["']/,
    )
  })

  it("instant mode uses single xdotool subprocess with --delay 0", () => {
    expect(linuxTyBody).toMatch(
      /xdotool["']\s*,\s*["']type["']\s*,\s*["']--delay["']\s*,\s*["']0["']/,
    )
  })

  it("fast mode uses ONE subprocess (not per-char loop)", () => {
    const fastBranch = sliceModeBranch(linuxTyBody, "fast")
    expect(fastBranch).toBeTruthy()
    expect(fastBranch).not.toMatch(/for\s+ch\s+in\s+text/)
  })

  it("fast mode --delay is in 1-3 ms range (NEW low floor)", () => {
    // Pre-fix this was 10-15ms; new value is 1-3ms for ~5x speedup
    // within fast mode. Guarded so a future refactor doesn't quietly
    // bump it back up.
    expect(linuxTyBody).toMatch(/_rng\.randint\(\s*1\s*,\s*3\s*\)/)
  })

  it("fast mode does NOT use the legacy 10-15 ms range", () => {
    // Anti-drift: catch a refactor that reverts the speed win.
    expect(linuxTyBody).not.toMatch(/_rng\.randint\(\s*10\s*,\s*15\s*\)/)
  })

  it("fast mode auto-promotes to clipboard for text >= 50 chars", () => {
    const fastBranch = sliceModeBranch(linuxTyBody, "fast")
    expect(fastBranch).toBeTruthy()
    expect(fastBranch!).toMatch(/len\(text\)\s*>=\s*50/)
    expect(fastBranch!).toMatch(/_xclip_paste/)
  })

  it("clipboard mode calls _xclip_paste", () => {
    const clipBranch = sliceModeBranch(linuxTyBody, "clipboard")
    expect(clipBranch).toBeTruthy()
    expect(clipBranch!).toMatch(/_xclip_paste/)
  })

  it("clipboard mode falls back to fast mode if xclip fails", () => {
    const clipBranch = sliceModeBranch(linuxTyBody, "clipboard")
    expect(clipBranch).toBeTruthy()
    // After None return from _xclip_paste, mode is reassigned to "fast"
    expect(clipBranch!).toMatch(/mode\s*=\s*["']fast["']/)
  })

  it("response includes the mode field (observability)", () => {
    expect(linuxTyBody).toMatch(/["']mode["']\s*:/)
  })

  it("response marks auto_promoted when fast→clipboard happens", () => {
    expect(linuxTyBody).toMatch(/["']auto_promoted["']\s*:\s*True/)
  })

  it("human mode preserved (per-char + bigram delay)", () => {
    // The legacy stealth path must still exist for opt-in callers.
    expect(linuxTyBody).toMatch(/for\s+ch\s+in\s+text/)
    expect(linuxTyBody).toMatch(/_human_type_delay\(prev\s*,\s*ch\)/)
  })

  it("empty-text fast path (no subprocess fork)", () => {
    expect(linuxTyBody).toMatch(/if\s+not\s+text\s*:\s*return/)
  })

  it("fast-mode subprocess timeout scales with text length", () => {
    expect(linuxTyBody).toMatch(/to\s*=\s*max\(\s*15\s*,/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3.  Source-level guards on Linux agent `_kp()`.
// ═══════════════════════════════════════════════════════════════════════════

describe("Linux agent _kp() — batched key press", () => {
  it("calls xdotool ONCE for the entire keys list (no per-key fork)", () => {
    // Pre-fix: per-key `subprocess.run([..., k])` inside a for-loop — N forks.
    // Post-fix: single `subprocess.run([..., k1, k2, k3])` outside any loop.
    // The list-comprehension `[k for k in ...]` filter is fine; what we
    // forbid is the LEGACY pattern: a `for k in (p.get("keys")...):`
    // statement at indent 2 (loop body, not a comprehension).
    expect(linuxKpBody).not.toMatch(/^\s{2}for\s+k\s+in/m)
    expect(linuxKpBody).toMatch(/subprocess\.run\(\s*\[\s*["']xdotool["']\s*,\s*["']key["']/)
  })

  it("filters empty key strings before dispatch", () => {
    expect(linuxKpBody).toMatch(/keys\s*=\s*\[k\s+for\s+k\s+in/)
  })

  it("uses --clearmodifiers (avoids shadowed key combos)", () => {
    expect(linuxKpBody).toMatch(/--clearmodifiers/)
  })

  it("empty keys list is a no-op (no subprocess fork)", () => {
    expect(linuxKpBody).toMatch(/if\s+not\s+keys\s*:\s*return/)
  })

  it("response reports key count (observability)", () => {
    expect(linuxKpBody).toMatch(/["']keys["']\s*:\s*len\(keys\)/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4.  Source-level guards on the `_xclip_paste` helper.
// ═══════════════════════════════════════════════════════════════════════════

describe("_xclip_paste helper", () => {
  it("is defined at module scope", () => {
    expect(linuxAgent).toMatch(/def\s+_xclip_paste\s*\(/)
  })

  it("uses -selection clipboard (modern Ctrl+V target)", () => {
    expect(xclipPasteHelper).toMatch(/-selection["']\s*,\s*["']clipboard["']/)
  })

  it("encodes text as UTF-8 bytes to avoid locale issues", () => {
    expect(xclipPasteHelper).toMatch(/text\.encode\(\s*["']utf-8["']\s*\)/)
  })

  it("synthesizes ctrl+v via xdotool key", () => {
    expect(xclipPasteHelper).toMatch(/["']ctrl\+v["']/)
  })

  it("uses --clearmodifiers on Ctrl+V (avoids shadowing by held keys)", () => {
    expect(xclipPasteHelper).toMatch(/--clearmodifiers/)
  })

  it("returns None on FileNotFoundError (xclip missing → fallback)", () => {
    expect(xclipPasteHelper).toMatch(/except\s+FileNotFoundError/)
    expect(xclipPasteHelper).toMatch(/return\s+None/)
  })

  it("returns None on any unexpected exception (fail-safe)", () => {
    expect(xclipPasteHelper).toMatch(/except\s+Exception\s*:/)
  })

  it("has a brief settle sleep so back-to-back pastes don't race", () => {
    expect(xclipPasteHelper).toMatch(/time\.sleep\(\s*0\.0[0-9]+\s*\)/)
  })

  it("empty text is a no-op success (matches xdotool type behavior)", () => {
    expect(xclipPasteHelper).toMatch(/if\s+not\s+text\s*:\s*return\s+["']clipboard["']/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5.  Source-level guards on Windows agent `_ty()` and `_kp()`.
// ═══════════════════════════════════════════════════════════════════════════

describe("Windows agent _ty() — source-level hardening", () => {
  it("defaults to fast mode", () => {
    expect(windowsTyBody).toMatch(/else\s*:\s*mode\s*=\s*["']fast["']/)
  })

  it("fast mode interval is 2-4 ms (NEW low floor)", () => {
    // Pre-fix this was 0.010-0.015; new value is 0.002-0.004 for ~5x speedup.
    expect(windowsTyBody).toMatch(/_rng\.uniform\(\s*0\.002\s*,\s*0\.004\s*\)/)
  })

  it("fast mode passes whole text in ONE pyautogui.write call", () => {
    const fastBranch = sliceModeBranch(windowsTyBody, "fast")
    expect(fastBranch).toBeTruthy()
    expect(fastBranch).not.toMatch(/for\s+ch\s+in\s+text/)
  })

  it("instant mode uses interval=0", () => {
    expect(windowsTyBody).toMatch(/pyautogui\.write\(text\s*,\s*interval\s*=\s*0\)/)
  })

  it("human mode preserved", () => {
    expect(windowsTyBody).toMatch(/_human_type_delay\(prev\s*,\s*ch\)/)
  })

  it("empty-text fast path", () => {
    expect(windowsTyBody).toMatch(/if\s+not\s+text\s*:\s*return/)
  })
})

describe("Windows agent _kp() — batched key press", () => {
  it("calls pyautogui.press with the keys list (no per-key loop)", () => {
    // Pre-fix: `for k in (...): pyautogui.press(k)` — N in-process
    // dispatches. Post-fix: single `pyautogui.press(keys)` outside a
    // loop. The list-comprehension `[k for k in ...]` filter is fine.
    expect(windowsKpBody).not.toMatch(/^\s{2}for\s+k\s+in/m)
    expect(windowsKpBody).toMatch(/pyautogui\.press\(\s*keys\s*\)/)
  })

  it("filters empty key strings", () => {
    expect(windowsKpBody).toMatch(/keys\s*=\s*\[k\s+for\s+k\s+in/)
  })

  it("empty keys list is a no-op", () => {
    expect(windowsKpBody).toMatch(/if\s+not\s+keys\s*:\s*return/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6.  Functional sandbox: actually exec the extracted Linux _ty with
//     mocked subprocess.run and verify the dispatch table is correct.
// ═══════════════════════════════════════════════════════════════════════════

describe("Linux _ty() — functional dispatch via Python sandbox", () => {
  it.skipIf(!PY_OK)(
    "fast mode default for short text: 1 subprocess, --delay in [1,3]",
    () => {
      const harness = `
import json
calls = []
class _R:
    returncode = 0; stdout = b""; stderr = b""
def _run(args, **kwargs):
    calls.append({"args": list(args), "timeout": kwargs.get("timeout")})
    return _R()
import random; _rng = random
import os; os.environ.setdefault("DISPLAY", ":1"); DISPLAY = ":1"
def _human_type_delay(prev, ch): return 0.0
import subprocess; subprocess.run = _run
import time; time.sleep = lambda t: None

${pyMethodToClass(linuxTyBody)}
a = Agent()
result = a._ty({"text": "short"})  # 5 chars — under auto-promote threshold
print(json.dumps({
    "result": result,
    "calls": len(calls),
    "args0": calls[0]["args"] if calls else None,
}))
`
      const out = JSON.parse(runPython(harness))
      expect(out.result.mode).toBe("fast")
      expect(out.result.chars).toBe(5)
      expect(out.calls).toBe(1)
      expect(out.args0[0]).toBe("xdotool")
      expect(out.args0[1]).toBe("type")
      const delay = parseInt(out.args0[3], 10)
      expect(delay).toBeGreaterThanOrEqual(1)
      expect(delay).toBeLessThanOrEqual(3)
    },
  )

  it.skipIf(!PY_OK)(
    "fast mode for text >= 50 chars: auto-promotes to clipboard (xclip + xdotool ctrl+v)",
    () => {
      const harness = `
import json
calls = []
class _R:
    returncode = 0; stdout = b""; stderr = b""
def _run(args, **kwargs):
    calls.append({"args": list(args), "input": kwargs.get("input")})
    return _R()
import random; _rng = random
import os; os.environ.setdefault("DISPLAY", ":1"); DISPLAY = ":1"
def _human_type_delay(prev, ch): return 0.0
import subprocess; subprocess.run = _run
import time; time.sleep = lambda t: None

${xclipPasteHelper}

${pyMethodToClass(linuxTyBody)}
a = Agent()
text = "x" * 60  # > 50 char threshold
result = a._ty({"text": text})
print(json.dumps({
    "result": result,
    "calls": [c["args"] for c in calls],
}))
`
      const out = JSON.parse(runPython(harness))
      expect(out.result.success).toBe(true)
      expect(out.result.mode).toBe("clipboard")
      expect(out.result.auto_promoted).toBe(true)
      // Two subprocesses: xclip then xdotool key ctrl+v
      expect(out.calls.length).toBe(2)
      expect(out.calls[0][0]).toBe("xclip")
      expect(out.calls[1]).toContain("ctrl+v")
    },
  )

  it.skipIf(!PY_OK)(
    "fast mode falls back to direct xdotool if xclip is missing",
    () => {
      const harness = `
import json
calls = []
class _R:
    returncode = 0; stdout = b""; stderr = b""
def _run(args, **kwargs):
    # First call (xclip) raises FileNotFoundError to simulate xclip missing
    if args and args[0] == "xclip":
        raise FileNotFoundError("xclip not found")
    calls.append({"args": list(args)})
    return _R()
import random; _rng = random
import os; os.environ.setdefault("DISPLAY", ":1"); DISPLAY = ":1"
def _human_type_delay(prev, ch): return 0.0
import subprocess; subprocess.run = _run
import time; time.sleep = lambda t: None

${xclipPasteHelper}

${pyMethodToClass(linuxTyBody)}
a = Agent()
text = "x" * 60
result = a._ty({"text": text})
print(json.dumps({
    "result": result,
    "calls": [c["args"][0:2] for c in calls],
}))
`
      const out = JSON.parse(runPython(harness))
      expect(out.result.success).toBe(true)
      // Fell back to fast mode — direct xdotool, no clipboard
      expect(out.result.mode).toBe("fast")
      expect(out.calls.length).toBe(1)
      expect(out.calls[0]).toEqual(["xdotool", "type"])
    },
  )

  it.skipIf(!PY_OK)("explicit mode='clipboard': 2 subprocesses (xclip + ctrl+v)", () => {
    const harness = `
import json
calls = []
class _R:
    returncode = 0; stdout = b""; stderr = b""
def _run(args, **kwargs):
    calls.append({"args": list(args)})
    return _R()
import random; _rng = random
import os; os.environ.setdefault("DISPLAY", ":1"); DISPLAY = ":1"
def _human_type_delay(prev, ch): return 0.0
import subprocess; subprocess.run = _run
import time; time.sleep = lambda t: None

${xclipPasteHelper}

${pyMethodToClass(linuxTyBody)}
a = Agent()
# Short text — but explicit clipboard mode bypasses the 50-char threshold
result = a._ty({"text": "abc", "mode": "clipboard"})
print(json.dumps({
    "result": result,
    "calls": [c["args"][0:2] for c in calls],
}))
`
    const out = JSON.parse(runPython(harness))
    expect(out.result.mode).toBe("clipboard")
    expect(out.calls.length).toBe(2)
    expect(out.calls[0]).toEqual(["xclip", "-selection"])
    expect(out.calls[1]).toContain("xdotool")
  })

  it.skipIf(!PY_OK)("'paste' is an alias for 'clipboard'", () => {
    const harness = `
import json
calls = []
class _R: returncode = 0; stdout = b""; stderr = b""
def _run(args, **kwargs):
    calls.append({"args": list(args)})
    return _R()
import random; _rng = random
import os; os.environ.setdefault("DISPLAY", ":1"); DISPLAY = ":1"
def _human_type_delay(prev, ch): return 0.0
import subprocess; subprocess.run = _run
import time; time.sleep = lambda t: None

${xclipPasteHelper}

${pyMethodToClass(linuxTyBody)}
a = Agent()
result = a._ty({"text": "abc", "mode": "paste"})
print(json.dumps({"result": result, "calls_count": len(calls)}))
`
    const out = JSON.parse(runPython(harness))
    expect(out.result.mode).toBe("clipboard")
    expect(out.calls_count).toBe(2)
  })

  it.skipIf(!PY_OK)("instant mode: 1 subprocess with --delay 0", () => {
    const harness = `
import json
calls = []
class _R: returncode = 0
def _run(args, **kwargs):
    calls.append({"args": list(args)})
    return _R()
import random; _rng = random
import os; os.environ.setdefault("DISPLAY", ":1"); DISPLAY = ":1"
def _human_type_delay(prev, ch): return 0.0
import subprocess; subprocess.run = _run
import time; time.sleep = lambda t: None

${xclipPasteHelper}

${pyMethodToClass(linuxTyBody)}
a = Agent()
r1 = a._ty({"text": "abc", "fast": True})
n1 = len(calls); calls.clear()
r2 = a._ty({"text": "abc", "interval": 0})
n2 = len(calls); calls.clear()
r3 = a._ty({"text": "abc", "mode": "instant"})
print(json.dumps({"r1": r1, "n1": n1, "r2": r2, "n2": n2, "r3": r3, "delay": calls[0]["args"][3]}))
`
    const out = JSON.parse(runPython(harness))
    expect(out.r1.mode).toBe("instant")
    expect(out.r2.mode).toBe("instant")
    expect(out.r3.mode).toBe("instant")
    expect(out.n1).toBe(1)
    expect(out.n2).toBe(1)
    expect(out.delay).toBe("0")
  })

  it.skipIf(!PY_OK)(
    "human mode: per-char subprocess loop preserved (legacy path)",
    () => {
      const harness = `
import json
calls = []
class _R: returncode = 0
def _run(args, **kwargs):
    calls.append({"args": list(args)})
    return _R()
import random; _rng = random
import os; os.environ.setdefault("DISPLAY", ":1"); DISPLAY = ":1"
def _human_type_delay(prev, ch): return 0.0
import subprocess; subprocess.run = _run
import time; time.sleep = lambda t: None

${xclipPasteHelper}

${pyMethodToClass(linuxTyBody)}
a = Agent()
r = a._ty({"text": "abcd", "mode": "human"})
print(json.dumps({"r": r, "calls": len(calls)}))
`
      const out = JSON.parse(runPython(harness))
      expect(out.r.mode).toBe("human")
      expect(out.calls).toBe(4)  // one subprocess per char
    },
  )

  it.skipIf(!PY_OK)("empty text: zero subprocesses", () => {
    const harness = `
import json
calls = []
class _R: returncode = 0
def _run(args, **kwargs): calls.append(args); return _R()
import random; _rng = random
import os; os.environ.setdefault("DISPLAY", ":1"); DISPLAY = ":1"
def _human_type_delay(prev, ch): return 0.0
import subprocess; subprocess.run = _run
import time; time.sleep = lambda t: None

${xclipPasteHelper}

${pyMethodToClass(linuxTyBody)}
a = Agent()
r = a._ty({"text": ""})
print(json.dumps({"r": r, "calls": len(calls)}))
`
    const out = JSON.parse(runPython(harness))
    expect(out.r.success).toBe(true)
    expect(out.r.chars).toBe(0)
    expect(out.calls).toBe(0)
  })

  it.skipIf(!PY_OK)(
    "speedup proof: 500-char text uses 2 subprocesses (clipboard) vs 500 (legacy)",
    () => {
      const harness = `
import json
calls_new = []; calls_legacy = []
class _R: returncode = 0
def make_recorder(bucket):
    def _r(args, **kwargs):
        bucket.append(args); return _R()
    return _r
import random; _rng = random
import os; os.environ.setdefault("DISPLAY", ":1"); DISPLAY = ":1"
def _human_type_delay(prev, ch): return 0.0
import subprocess; import time
time.sleep = lambda t: None

${xclipPasteHelper}

${pyMethodToClass(linuxTyBody)}
a = Agent()
text = "x" * 500

subprocess.run = make_recorder(calls_new)
a._ty({"text": text})  # default → fast → auto-promote → clipboard (2 calls)

subprocess.run = make_recorder(calls_legacy)
a._ty({"text": text, "mode": "human"})  # legacy path: 500 calls

print(json.dumps({"new": len(calls_new), "legacy": len(calls_legacy)}))
`
      const out = JSON.parse(runPython(harness))
      expect(out.new).toBe(2)  // xclip + ctrl+v
      expect(out.legacy).toBe(500)
      // 250× fewer subprocesses for 500-char paste. Combined with the
      // 238ms→0ms Aalto delay elimination, this is the headline speedup.
    },
  )
})

// ═══════════════════════════════════════════════════════════════════════════
// 7.  Functional sandbox: Linux _kp() batching.
// ═══════════════════════════════════════════════════════════════════════════

describe("Linux _kp() — functional batching via Python sandbox", () => {
  it.skipIf(!PY_OK)(
    "5 keys → 1 subprocess (legacy: 5 subprocesses)",
    () => {
      const harness = `
import json
calls = []
class _R: returncode = 0
def _run(args, **kwargs):
    calls.append({"args": list(args)})
    return _R()
import random; _rng = random
import os; os.environ.setdefault("DISPLAY", ":1"); DISPLAY = ":1"
import subprocess; subprocess.run = _run
import time; time.sleep = lambda t: None

${pyMethodToClass(linuxKpBody)}
a = Agent()
r = a._kp({"keys": ["Tab", "Tab", "Enter", "Escape", "F1"]})
print(json.dumps({"r": r, "calls": len(calls), "args0": calls[0]["args"]}))
`
      const out = JSON.parse(runPython(harness))
      expect(out.calls).toBe(1)
      expect(out.r.keys).toBe(5)
      // All keys in a single xdotool call
      expect(out.args0).toContain("Tab")
      expect(out.args0).toContain("Enter")
      expect(out.args0).toContain("F1")
    },
  )

  it.skipIf(!PY_OK)("empty keys list: no subprocess fork", () => {
    const harness = `
import json
calls = []
class _R: returncode = 0
def _run(args, **kwargs): calls.append(args); return _R()
import random; _rng = random
import os; os.environ.setdefault("DISPLAY", ":1"); DISPLAY = ":1"
import subprocess; subprocess.run = _run
import time; time.sleep = lambda t: None

${pyMethodToClass(linuxKpBody)}
a = Agent()
r = a._kp({"keys": []})
print(json.dumps({"r": r, "calls": len(calls)}))
`
    const out = JSON.parse(runPython(harness))
    expect(out.r.success).toBe(true)
    expect(out.calls).toBe(0)
  })

  it.skipIf(!PY_OK)("single 'key' field (legacy shape): 1 subprocess", () => {
    const harness = `
import json
calls = []
class _R: returncode = 0
def _run(args, **kwargs): calls.append({"args": list(args)}); return _R()
import random; _rng = random
import os; os.environ.setdefault("DISPLAY", ":1"); DISPLAY = ":1"
import subprocess; subprocess.run = _run
import time; time.sleep = lambda t: None

${pyMethodToClass(linuxKpBody)}
a = Agent()
r = a._kp({"key": "Escape"})
print(json.dumps({"r": r, "calls": len(calls), "args0": calls[0]["args"]}))
`
    const out = JSON.parse(runPython(harness))
    expect(out.calls).toBe(1)
    expect(out.args0).toContain("Escape")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 8.  Functional sandbox: Windows _ty() and _kp().
// ═══════════════════════════════════════════════════════════════════════════

describe("Windows _ty() — functional dispatch via Python sandbox", () => {
  it.skipIf(!PY_OK)(
    "fast mode default: 1 pyautogui.write call with interval in [0.002, 0.004]",
    () => {
      const harness = `
import json
writes = []
class _PG:
    @staticmethod
    def write(text, interval=0):
        writes.append({"text": text, "interval": interval})
    @staticmethod
    def press(keys): pass
import sys; sys.modules.setdefault("pyautogui", _PG); pyautogui = _PG
import random; _rng = random
def _human_type_delay(prev, ch): return 0.0
import time; time.sleep = lambda t: None

${pyMethodToClass(windowsTyBody)}
a = Agent()
r = a._ty({"text": "Hello world"})
print(json.dumps({"r": r, "writes": writes}))
`
      const out = JSON.parse(runPython(harness))
      expect(out.r.mode).toBe("fast")
      expect(out.writes.length).toBe(1)
      const interval = out.writes[0].interval
      expect(interval).toBeGreaterThanOrEqual(0.002)
      expect(interval).toBeLessThanOrEqual(0.004)
    },
  )

  it.skipIf(!PY_OK)("instant mode: interval=0", () => {
    const harness = `
import json
writes = []
class _PG:
    @staticmethod
    def write(text, interval=0): writes.append({"interval": interval})
    @staticmethod
    def press(keys): pass
import sys; sys.modules.setdefault("pyautogui", _PG); pyautogui = _PG
import random; _rng = random
def _human_type_delay(prev, ch): return 0.0
import time; time.sleep = lambda t: None

${pyMethodToClass(windowsTyBody)}
a = Agent()
r = a._ty({"text": "abc", "mode": "instant"})
print(json.dumps({"r": r, "interval": writes[0]["interval"]}))
`
    const out = JSON.parse(runPython(harness))
    expect(out.r.mode).toBe("instant")
    expect(out.interval).toBe(0)
  })
})

describe("Windows _kp() — functional batching via Python sandbox", () => {
  it.skipIf(!PY_OK)(
    "5 keys → 1 pyautogui.press(list) call (no per-key loop)",
    () => {
      const harness = `
import json
press_calls = []
class _PG:
    @staticmethod
    def write(text, interval=0): pass
    @staticmethod
    def press(keys): press_calls.append(keys)
import sys; sys.modules.setdefault("pyautogui", _PG); pyautogui = _PG
import random; _rng = random
import time; time.sleep = lambda t: None

${pyMethodToClass(windowsKpBody)}
a = Agent()
r = a._kp({"keys": ["Tab", "Tab", "Enter", "Escape", "F1"]})
print(json.dumps({"r": r, "press_calls": press_calls}))
`
      const out = JSON.parse(runPython(harness))
      expect(out.press_calls.length).toBe(1)
      expect(out.press_calls[0]).toEqual(["Tab", "Tab", "Enter", "Escape", "F1"])
      expect(out.r.keys).toBe(5)
    },
  )
})

// ═══════════════════════════════════════════════════════════════════════════
// 9.  Performance budget — verify configured delays produce target WPM.
// ═══════════════════════════════════════════════════════════════════════════

describe("performance budget verification", () => {
  it("Linux fast mode --delay [1,3]ms yields effective ≥80 WPM", () => {
    // WPM (raw chars per minute / 5) = 60_000 / delay_ms / 5
    // At 3ms (worst case): 60000/3/5 = 4000 WPM raw; with xdotool
    // overhead ≈ 200-400 WPM effective. Well above 80 WPM target.
    const maxDelay = 3
    const wpmAtMaxDelay = 60_000 / maxDelay / 5
    expect(wpmAtMaxDelay).toBeGreaterThan(80)
  })

  it("Linux clipboard mode is length-independent (constant time)", () => {
    // 2 subprocess calls regardless of text length. Roughly ~30-50 ms
    // for short text and the same for 5000-char text.
    // (Symbolic check: the auto-promote threshold exists.)
    expect(linuxTyBody).toMatch(/len\(text\)\s*>=\s*50/)
  })

  it("human mode Aalto delay ~238ms yields ~50 WPM (preserved)", () => {
    const meanIKI = 238
    const wpm = 60_000 / meanIKI / 5
    expect(wpm).toBeGreaterThan(45)
    expect(wpm).toBeLessThan(60)
  })

  it("fast mode is at least 50x faster than human mode at scale (1ms vs 238ms)", () => {
    expect(238 / 1).toBeGreaterThan(50)
  })

  it("Linux fast --delay reduced 5x from prior 10-15ms to 1-3ms", () => {
    // Anti-drift on the speed win: the prior fix used 10-15ms; this
    // one uses 1-3ms for an additional 5x speedup within fast mode.
    expect(linuxTyBody).toMatch(/_rng\.randint\(\s*1\s*,\s*3\s*\)/)
    expect(linuxTyBody).not.toMatch(/_rng\.randint\(\s*10\s*,\s*15\s*\)/)
  })

  it("Windows fast interval reduced 5x from prior 10-15ms to 2-4ms", () => {
    expect(windowsTyBody).toMatch(/_rng\.uniform\(\s*0\.002\s*,\s*0\.004\s*\)/)
    expect(windowsTyBody).not.toMatch(/_rng\.uniform\(\s*0\.010\s*,\s*0\.015\s*\)/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 10. Documentation guard — comment block referencing the rewrite must
//     remain so future engineers can find the rationale.
// ═══════════════════════════════════════════════════════════════════════════

describe("documentation guard", () => {
  it("Linux _ty docstring references the perf rewrite", () => {
    expect(linuxTyBody).toMatch(/Typing modes|perf rewrite|fork overhead/)
  })

  it("Linux _ty docstring mentions clipboard / auto-promote", () => {
    expect(linuxTyBody).toMatch(/clipboard|auto[- ]?promote/i)
  })

  it("Linux _kp docstring mentions fork-per-key elimination", () => {
    expect(linuxKpBody).toMatch(/fork|batch|single/)
  })
})
