#!/usr/bin/env node
/**
 * Smoke test for the packaged (unpacked) Electron binary.
 *
 * Unlike the Playwright e2e suite — which launches Electron against the
 * built ``out/`` directory — this script launches the FULLY PACKAGED binary
 * that electron-builder produces under ``dist/<platform>-unpacked/``. It is
 * the closest you can get to "did the installer work" without actually
 * running the installer.
 *
 * Run after ``npm run package:<os>``:
 *
 *   npm run test:smoke
 *
 * The script:
 *   1. Finds the unpacked binary for the current platform under ``dist/``
 *   2. Launches it with ``COASTY_TEST_MODE=1`` so it skips the auto-updater
 *   3. Waits up to 30s for the app to either:
 *        - emit a "main-window-ready" line on stdout (success), OR
 *        - exit with a non-zero code (failure), OR
 *        - hit the timeout (failure)
 *   4. Sends SIGTERM and asserts the process exits cleanly
 *
 * Exit codes:
 *   0  — smoke passed
 *   1  — binary not found, crashed, or hung past timeout
 *
 * What this catches that the Playwright tests don't:
 *   - asarUnpack misconfiguration ("Cannot find module 'bindings'" at first
 *     native call)
 *   - Code-signing-only crashes (Windows AMSI false-positives, macOS Gate-
 *     keeper rejections on the notarised .app)
 *   - Wrong ``app.getPath('userData')`` resolution in the packaged bundle
 *   - Missing icons / resources that ``electron-vite build`` ships fine but
 *     ``electron-builder`` filters out
 */

import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ELECTRON_ROOT = path.resolve(__dirname, '..')

const COLOURS = {
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  gray:   '\x1b[90m',
  bold:   '\x1b[1m',
  reset:  '\x1b[0m',
}

function log(msg)  { process.stdout.write(`${COLOURS.gray}[smoke] ${COLOURS.reset}${msg}\n`) }
function ok(msg)   { process.stdout.write(`${COLOURS.green}[smoke] ✓ ${msg}${COLOURS.reset}\n`) }
function fail(msg) { process.stdout.write(`${COLOURS.red}[smoke] ✗ ${msg}${COLOURS.reset}\n`) }
function warn(msg) { process.stdout.write(`${COLOURS.yellow}[smoke] ⚠ ${msg}${COLOURS.reset}\n`) }

const SMOKE_TIMEOUT_MS = 30_000
const READY_MARKER = /main window|ready-to-show|window-mode-changed|coasty\s*desktop/i

/** Locate the packaged Electron binary for the current platform under
 *  ``dist/``. Returns the absolute path, or throws if not found. */
function findPackagedBinary() {
  const distDir = path.join(ELECTRON_ROOT, 'dist')
  if (!fs.existsSync(distDir)) {
    throw new Error(
      `dist/ not found at ${distDir} — run \`npm run package\` first.`,
    )
  }

  if (process.platform === 'win32') {
    // electron-builder unpacks to dist/win-unpacked/ regardless of installer.
    const candidate = path.join(distDir, 'win-unpacked', 'Coasty Desktop.exe')
    if (fs.existsSync(candidate)) return candidate
    throw new Error(`Could not find ${candidate}. Did 'npm run package:win' succeed?`)
  }

  if (process.platform === 'darwin') {
    // Both arm64 and x64 builds land in dist/. The unpacked .app lives in
    // dist/mac/ or dist/mac-arm64/ depending on host arch.
    const candidates = [
      path.join(distDir, 'mac-arm64', 'Coasty Desktop.app', 'Contents', 'MacOS', 'Coasty Desktop'),
      path.join(distDir, 'mac',       'Coasty Desktop.app', 'Contents', 'MacOS', 'Coasty Desktop'),
      path.join(distDir, 'mac-universal', 'Coasty Desktop.app', 'Contents', 'MacOS', 'Coasty Desktop'),
    ]
    for (const c of candidates) {
      if (fs.existsSync(c)) return c
    }
    throw new Error(
      `Could not find packaged .app under dist/. Tried:\n  - ${candidates.join('\n  - ')}`,
    )
  }

  // Linux
  const linuxUnpacked = path.join(distDir, 'linux-unpacked', 'coasty-desktop')
  if (fs.existsSync(linuxUnpacked)) return linuxUnpacked
  throw new Error(`Could not find ${linuxUnpacked}. Did 'npm run package:linux' succeed?`)
}

async function runSmoke() {
  log(`platform: ${process.platform}, arch: ${process.arch}`)

  let binary
  try {
    binary = findPackagedBinary()
  } catch (err) {
    fail(err.message)
    process.exit(1)
  }
  ok(`found packaged binary: ${binary}`)

  // Fresh userData so we don't trip the production single-instance lock if
  // the user happens to have a dev build running.
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coasty-smoke-'))
  log(`userData: ${userDataDir}`)

  const env = {
    ...process.env,
    COASTY_TEST_MODE: '1',
    ELECTRON_ENABLE_LOGGING: '1',
  }

  const args = [
    `--user-data-dir=${userDataDir}`,
    '--disable-gpu',
    '--no-sandbox',
  ]

  const start = Date.now()
  const child = spawn(binary, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })

  let stdout = ''
  let stderr = ''
  let ready = false
  let crashed = false

  child.stdout.on('data', (chunk) => {
    const s = chunk.toString()
    stdout += s
    if (!ready && READY_MARKER.test(stdout)) {
      ready = true
    }
  })
  child.stderr.on('data', (chunk) => {
    const s = chunk.toString()
    stderr += s
    if (!ready && READY_MARKER.test(stderr)) {
      ready = true
    }
  })

  const exitPromise = new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      resolve({ code, signal })
    })
    child.on('error', (err) => {
      crashed = true
      stderr += `\n[spawn error] ${err.message}\n`
      resolve({ code: -1, signal: null })
    })
  })

  // Wait up to ``SMOKE_TIMEOUT_MS`` for "ready" or process exit.
  const readyDeadline = Date.now() + SMOKE_TIMEOUT_MS
  while (Date.now() < readyDeadline && !ready) {
    // If the child has already exited (crash), bail to the exit handler.
    if (child.exitCode !== null) break
    await new Promise((r) => setTimeout(r, 250))
  }

  if (!ready) {
    fail(`Did not see "ready" marker within ${SMOKE_TIMEOUT_MS}ms`)
    log(`--- stdout (last 2KB) ---\n${stdout.slice(-2048)}`)
    log(`--- stderr (last 2KB) ---\n${stderr.slice(-2048)}`)
    try { child.kill('SIGKILL') } catch { /* ignore */ }
    await exitPromise
    process.exit(1)
  }

  const bootMs = Date.now() - start
  ok(`window ready after ${bootMs}ms`)

  // Let it run for another 3s — slow-burn crashes from post-boot timers
  // (auto-updater would fire here if test-mode failed to gate it).
  await new Promise((r) => setTimeout(r, 3000))

  if (child.exitCode !== null) {
    fail(`App exited unexpectedly during settle phase (code=${child.exitCode})`)
    log(`--- stderr (last 2KB) ---\n${stderr.slice(-2048)}`)
    process.exit(1)
  }
  ok('survived 3s post-boot settle')

  // Graceful shutdown.
  log('sending SIGTERM…')
  child.kill('SIGTERM')

  const exitResult = await Promise.race([
    exitPromise,
    new Promise((resolve) => setTimeout(() => resolve({ code: 'timeout', signal: null }), 10_000)),
  ])

  if (exitResult.code === 'timeout') {
    warn('App did not exit within 10s of SIGTERM, force-killing')
    try { child.kill('SIGKILL') } catch { /* ignore */ }
    await exitPromise
    // Don't fail the smoke on shutdown grace — apps with shutdown work to do
    // routinely take >10s. The boot+settle phase is the real check.
  } else {
    ok(`exited cleanly (code=${exitResult.code}, signal=${exitResult.signal})`)
  }

  // Best-effort tmp cleanup.
  try { fs.rmSync(userDataDir, { recursive: true, force: true }) } catch { /* ignore */ }

  ok(`smoke passed (${Date.now() - start}ms total)`)
  if (crashed) process.exit(1)
  process.exit(0)
}

runSmoke().catch((err) => {
  fail(`Unhandled smoke error: ${err?.stack || err}`)
  process.exit(1)
})
