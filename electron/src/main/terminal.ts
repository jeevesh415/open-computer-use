import { execFile, spawn } from 'child_process'
import * as os from 'os'
import { sanitizeChildEnv, checkDangerousCommand } from './security'

// ─── Stdout/stderr buffer cap (Issue #4, 2026-05-17) ──────────────────────
//
// Node's default ``child_process.exec`` / ``execFile`` buffer is 1 MB.
// Three production events on 2026-05-{14,15,17} fired
// ``ERR_CHILD_PROCESS_STDIO_MAXBUFFER`` from PowerShell-driven update
// scripts whose output (Verbose logs + module reload chatter) routinely
// clears 1 MB. The fix is to:
//
//   1. Raise the cap to 10 MB for every ``execFile`` call below.
//   2. For commands that legitimately produce more than 10 MB (rare —
//      mostly file dumps), the long-form ``spawn`` path streams stdout
//      in chunks instead of buffering. We keep ``execFile`` here for
//      simplicity but truncate the captured output at the boundary,
//      which is what the agent expects anyway (it slices the result to
//      5,000 chars before sending back to the model).
//
// 10 MB is chosen as ~10× the largest legitimate PowerShell output we've
// observed in production (worst case: ``Get-Process | Format-List *``
// ~ 4 MB on a busy workstation) with headroom for verbose logging.
const MAX_OUTPUT_BUFFER_BYTES = 10 * 1024 * 1024

interface TerminalSession {
  id: string
  cwd: string
}

const sessions: Map<string, TerminalSession> = new Map()
let sessionCounter = 0

export async function connectTerminal(params: { cwd?: string } = {}): Promise<any> {
  const id = `term_${++sessionCounter}`
  const cwd = params.cwd || os.homedir()

  sessions.set(id, { id, cwd })

  return {
    success: true,
    session_id: id,
    cwd,
    message: `Terminal session ${id} created`,
  }
}

/**
 * Execute a shell command via PowerShell (Windows) or bash (Unix).
 *
 * Robustness checklist:
 *  - Validates `command` is a non-empty string before spawning anything
 *    (the agent occasionally sends `{ command: undefined }` which
 *    previously made execFile silently fail with no useful error)
 *  - Single resolve path — promise resolves exactly once even if the
 *    timeout AND the callback both fire (the previous version had two
 *    independent timers that could both call resolve)
 *  - Captures stdout/stderr separately so the caller can tell whether
 *    a command "succeeded but printed warnings" vs "failed silently"
 *  - Reports `exit_code` distinct from `success` — a non-zero exit is
 *    still a useful agent signal (e.g. `where chrome` returning 1
 *    means "not found", which is information, not a tool failure)
 *  - Maps spawn errors (ENOENT, EACCES) to clear messages
 *  - Always returns a result with `success`, `error`, `exit_code`,
 *    `output`, `stdout`, `stderr` populated — never undefined
 */
export async function executeTerminal(params: {
  command: string
  timeout?: number
  session_id?: string
}): Promise<any> {
  const command = params?.command
  const timeout = typeof params?.timeout === 'number' && params.timeout > 0 ? params.timeout : 30

  // Validate input — silently passing undefined to execFile spawns
  // an empty PowerShell session that "succeeds" but does nothing.
  if (typeof command !== 'string' || !command.trim()) {
    return {
      success: false,
      output: '',
      stdout: '',
      stderr: '',
      exit_code: -1,
      error: 'terminal_execute called without a "command" string parameter',
    }
  }

  // Block catastrophic commands even if auto-approved.
  const risk = checkDangerousCommand(command)
  if (risk.blocked) {
    return {
      success: false,
      output: '',
      stdout: '',
      stderr: '',
      exit_code: -1,
      error: risk.reason,
    }
  }

  // Determine working directory from session.
  let cwd = os.homedir()
  if (params.session_id && sessions.has(params.session_id)) {
    cwd = sessions.get(params.session_id)!.cwd
  }

  return new Promise((resolve) => {
    const isWin = process.platform === 'win32'
    const shell = isWin ? 'powershell.exe' : '/bin/bash'
    // PowerShell argv on Windows:
    //   -NoProfile         — skip user profile (avoids slow / broken
    //                        profiles silently failing the spawn).
    //   -NonInteractive    — never prompt for input; we have no way to
    //                        answer, and the prompt would hang the bridge
    //                        forever.
    //   -ExecutionPolicy RemoteSigned — Microsoft's recommended default
    //                        and the policy that's already in effect on
    //                        the vast majority of Windows installs. We
    //                        used to pass "Bypass" here, which is the
    //                        literal signature Defender / CrowdStrike /
    //                        SentinelOne flag as Cobalt-Strike-/RAT-like
    //                        ("Behavior:Win32/PowerShell.PSPolicy"), and
    //                        which made the app trip false-positive AV
    //                        scans on first run. RemoteSigned is
    //                        functionally identical for our use case
    //                        because execution policy gates SCRIPT FILES
    //                        (.ps1) — every command the agent emits goes
    //                        via `-Command "..."`, which is an inline
    //                        string and not subject to the policy.
    //   -Command           — run the inline string and exit.
    //
    // If a user has overridden their policy to AllSigned via group
    // policy and the agent emits a command that loads a local .ps1
    // (rare — most agent commands are inline), the spawn will fail with
    // a clear PowerShell error. That's the right behaviour for a locked-
    // down corporate environment; silently bypassing was always wrong.
    const args = isWin
      ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-Command', command]
      : ['-c', command]

    let resolved = false
    const finish = (result: any) => {
      if (resolved) return
      resolved = true
      resolve(result)
    }

    let child: ReturnType<typeof execFile> | null = null
    try {
      child = execFile(shell, args, {
        cwd,
        timeout: timeout * 1000,
        // 10 MB — raised from 1 MB on 2026-05-17 after three
        // ERR_CHILD_PROCESS_STDIO_MAXBUFFER events from update-script
        // output. See MAX_OUTPUT_BUFFER_BYTES docstring above for the
        // sizing rationale.
        maxBuffer: MAX_OUTPUT_BUFFER_BYTES,
        env: sanitizeChildEnv(),
      }, (error, stdout, stderr) => {
        const out = stdout || ''
        const err = stderr || ''
        const combined = err ? `${out}${out && '\n'}${err}` : out

        // Distinguish three cases:
        //   1. spawn-level failure (ENOENT, EACCES) → error.code is a string
        //   2. process exited non-zero → error.code is a number
        //   3. clean exit 0 → error is null
        let exitCode = 0
        let errorMsg: string | undefined
        if (error) {
          if (typeof error.code === 'number') {
            exitCode = error.code
            errorMsg = `Exit code ${exitCode}` + (err ? `: ${err.trim().slice(0, 500)}` : '')
          } else if (typeof error.code === 'string') {
            // ENOENT / EACCES — the shell binary itself couldn't be launched.
            exitCode = -1
            errorMsg = `Failed to launch ${shell} (${error.code}): ${error.message}`
          } else if ((error as any).killed) {
            exitCode = -1
            errorMsg = `Command timed out after ${timeout}s and was killed`
          } else {
            exitCode = -1
            errorMsg = error.message || String(error)
          }
        }

        finish({
          success: !error,
          output: combined.slice(0, 5000),
          stdout: out.slice(0, 5000),
          stderr: err.slice(0, 5000),
          exit_code: exitCode,
          error: errorMsg,
        })
      })

      // Defensive: if execFile somehow doesn't fire its callback within
      // (timeout + 2)s, force-resolve with a clear message rather than
      // hanging the bridge's serial queue forever. The native `timeout`
      // option above SHOULD already kill the child, but native behavior
      // varies by platform.
      const watchdog = setTimeout(() => {
        try { child?.kill('SIGKILL') } catch { /* ignore */ }
        finish({
          success: false,
          output: '',
          stdout: '',
          stderr: '',
          exit_code: -1,
          error: `Command exceeded ${timeout}s + 2s watchdog and was force-killed`,
        })
      }, (timeout + 2) * 1000)

      // Once the child is done (callback fires), clear the watchdog so
      // we don't keep a stale timer in the event loop.
      child.on('exit', () => clearTimeout(watchdog))
      child.on('error', () => clearTimeout(watchdog))
    } catch (spawnErr: any) {
      // execFile can throw synchronously for invalid args / encoding issues.
      finish({
        success: false,
        output: '',
        stdout: '',
        stderr: '',
        exit_code: -1,
        error: `Failed to spawn ${shell}: ${spawnErr?.message || spawnErr}`,
      })
    }
  })
}

export async function readTerminal(_params: { session_id?: string } = {}): Promise<any> {
  return {
    success: true,
    output: '',
    message: 'No pending output',
  }
}

export async function typeTerminal(params: { text: string }): Promise<any> {
  return {
    success: true,
    message: `Text "${params.text.slice(0, 50)}" ready to send (use terminal_execute to run)`,
  }
}

export async function clearTerminal(_params: {} = {}): Promise<any> {
  return { success: true, message: 'Terminal cleared' }
}

export async function closeTerminal(params: { session_id?: string } = {}): Promise<any> {
  if (params.session_id) {
    sessions.delete(params.session_id)
  }
  return {
    success: true,
    message: `Terminal session ${params.session_id || 'default'} closed`,
  }
}
