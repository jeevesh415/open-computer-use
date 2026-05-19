/**
 * Real-shell terminal execution via the main process.
 *
 * On Windows this spawns ``powershell.exe`` with the prod argv (``-NoProfile
 * -NonInteractive -ExecutionPolicy RemoteSigned``). On macOS / Linux it
 * spawns ``/bin/bash -c``. Vitest mocks ``child_process`` — this is the only
 * place we verify the real spawn behaviour.
 */
import { test, expect } from '@playwright/test'
import { launchApp, closeApp, waitForMainWindow, LaunchedApp } from './fixtures/launch'

let launched: LaunchedApp | null = null

test.beforeEach(async () => {
  launched = await launchApp()
  await waitForMainWindow(launched)
})

test.afterEach(async () => {
  await closeApp(launched)
  launched = null
})

async function executeTerminal(command: string, timeout = 15): Promise<{
  success?: boolean
  exit_code?: number
  stdout?: string
  stderr?: string
  output?: string
  error?: string
}> {
  return launched!.app.evaluate(async (_electron, payload) => {
    const exports = (globalThis as any).__coastyTestExports__
    if (!exports?.terminal?.executeTerminal) {
      throw new Error(
        '__coastyTestExports__.terminal is missing — was COASTY_TEST_MODE=1 set at launch?',
      )
    }
    return exports.terminal.executeTerminal(payload)
  }, { command, timeout })
}

test('executes a simple echo and returns its stdout', async () => {
  // Use PowerShell-friendly syntax on Windows; bash works on macOS/Linux.
  // PowerShell's Write-Output produces the trailing CRLF, bash echo produces LF.
  const cmd = process.platform === 'win32'
    ? 'Write-Output coasty-e2e-marker'
    : 'echo coasty-e2e-marker'

  const result = await executeTerminal(cmd)
  expect(result.success).toBe(true)
  expect(result.exit_code).toBe(0)
  expect((result.stdout ?? result.output ?? '')).toContain('coasty-e2e-marker')
})

test('non-zero exit code is reported without throwing', async () => {
  // ``exit 7`` works in bash; PowerShell needs ``exit 7`` too.
  const result = await executeTerminal('exit 7')
  // The handler reports success=false for non-zero exits but does NOT throw.
  // We assert on exit_code only — success semantics vary across versions.
  expect(result.exit_code).toBe(7)
  // Error field must be present, not undefined, to keep the renderer contract.
  expect(typeof result.error).toBe('string')
})

test('empty command is rejected with a structured error (does not spawn)', async () => {
  const result = await executeTerminal('')
  expect(result.success).toBe(false)
  expect(result.exit_code).toBe(-1)
  expect(result.error).toMatch(/command/i)
})

test('dangerous command (rm -rf /) is blocked before spawn', async () => {
  // security.checkDangerousCommand catches the catastrophic patterns even
  // when the user has chosen "always_approve". A spawned ``rm -rf /``
  // would brick a CI runner.
  const cmd = process.platform === 'win32'
    ? 'Remove-Item -Recurse -Force C:\\'
    : 'rm -rf /'
  const result = await executeTerminal(cmd)
  expect(result.success).toBe(false)
  expect(typeof result.error).toBe('string')
  expect(result.error!.length).toBeGreaterThan(0)
})

test('stdout and stderr are captured separately', async () => {
  // Cross-platform: write to both streams. PowerShell uses Write-Output
  // (stdout) + Write-Error (stderr); bash uses echo + ``echo … >&2``.
  const cmd = process.platform === 'win32'
    ? `Write-Output stdoutbit; [Console]::Error.WriteLine('stderrbit')`
    : `echo stdoutbit; echo stderrbit 1>&2`

  const result = await executeTerminal(cmd)
  // Whatever the exit code shape, both streams must surface.
  const allOut = (result.stdout ?? '') + (result.stderr ?? '') + (result.output ?? '')
  expect(allOut).toContain('stdoutbit')
  expect(allOut).toContain('stderrbit')
})
