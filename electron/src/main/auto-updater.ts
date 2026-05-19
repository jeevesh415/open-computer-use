import { autoUpdater, UpdateInfo } from 'electron-updater'
import { BrowserWindow } from 'electron'
// Static import: error-reporter is also statically imported by index.ts and
// ws-bridge.ts, so any dynamic `import()` here would land in the same main
// chunk anyway — Vite warned about exactly that on the win:signed build.
// Keep the static path so we don't synthesise a useless dynamic-import
// boundary that the bundler can't honour.
import { reportError } from './error-reporter'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'        // downloaded, will install on restart
  | 'error'

let currentStatus: UpdateStatus = 'idle'
let updateInfo: UpdateInfo | null = null
let lastErrorMessage: string | null = null

// ─── Retry-with-backoff (Bug #3, 2026-05-14) ─────────────────────────────
//
// Production CloudWatch logs from 2026-05-14 19:51:32Z showed the
// auto-updater firing a single fatal `Update check failed. Try again
// later.` event when the client's DNS hiccuped on `coasty.ai`. The
// regular 4-hour interval continued, but a transient 1-2 minute network
// blip meant the user waited 4 full hours before another check —
// effectively losing a workday of update lag from a sub-minute outage.
//
// The retry schedule is intentionally sparse to keep update traffic
// polite under genuine outages: 5min, 30min, 2h. After three failed
// retries we let the regular 4-hour cadence take over rather than
// hammering the update server further.
const RETRY_SCHEDULE_MS: readonly number[] = [
  5 * 60 * 1000,        // 5 minutes
  30 * 60 * 1000,       // 30 minutes
  2 * 60 * 60 * 1000,   // 2 hours
]
let retryAttempt = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null

/**
 * A "retryable" error is one that's likely to clear on its own — primarily
 * DNS / network transient failures. Things like signature-verification
 * failure, disk-full, or 404 responses won't be helped by waiting 5 minutes
 * and trying again, and retrying them just adds noise to logs.
 *
 * The pattern set MUST stay in sync with `sanitizeUpdateError()` above —
 * those are the exact codes Node emits for transient network conditions.
 */
export function isRetryableUpdateError(err: Error | null | undefined): boolean {
  const msg = (err && typeof err.message === 'string') ? err.message : ''
  if (!msg) return false
  return /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH/i.test(msg)
}

function clearRetryTimer(): void {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
}

/**
 * Schedule the next retry attempt. Increments the attempt counter
 * BEFORE arming the timer so a fresh error event (synchronously
 * emitted by checkForUpdates() or any other source) schedules at the
 * NEXT step in the backoff schedule, not the same one again.
 *
 * If the scheduled retry completes successfully, the success-path
 * event handlers below call resetRetryState() — so the next genuine
 * failure starts fresh at the 5-minute step.
 */
function scheduleRetry(): void {
  if (retryAttempt >= RETRY_SCHEDULE_MS.length) {
    // Exhausted the backoff schedule. Don't keep retrying; the regular
    // 4-hour periodic check will pick the next attempt up naturally.
    clearRetryTimer()
    return
  }
  clearRetryTimer()
  const delayMs = RETRY_SCHEDULE_MS[retryAttempt]
  const attemptLabel = `${retryAttempt + 1}/${RETRY_SCHEDULE_MS.length}`
  retryAttempt++
  console.log(`[Updater] Network retry ${attemptLabel} scheduled in ${Math.round(delayMs / 1000)}s`)
  retryTimer = setTimeout(() => {
    retryTimer = null
    autoUpdater.checkForUpdates().catch(() => {})
  }, delayMs)
}

/**
 * Clear retry state. Called from success-path event handlers
 * (update-available / update-not-available / update-downloaded) so the
 * next genuine failure starts fresh, and from `initAutoUpdater()` so
 * test runs that call init multiple times start clean.
 */
export function resetRetryState(): void {
  retryAttempt = 0
  clearRetryTimer()
}

/**
 * Test-only escape hatch. Tests need to assert internal retry state
 * (attempt counter, whether a timer is armed) without forcing the test
 * harness to wait real wall-clock time. Production code MUST NOT read
 * from this; it's namespaced with a `_` prefix as the convention for
 * "test-only".
 */
export function _getRetryState(): { attempt: number; hasTimer: boolean } {
  return { attempt: retryAttempt, hasTimer: retryTimer !== null }
}

/**
 * Sanitise an auto-updater error message so it never leaks internal paths,
 * server URLs, certificate details, or stack traces to the renderer or logs.
 */
export function sanitizeUpdateError(err: Error): string {
  const msg = err.message || 'Unknown update error'

  // Map known error classes to safe, user-facing messages
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EAI_AGAIN/i.test(msg)) {
    return 'Update server is unreachable. Check your network connection.'
  }
  if (/certificate|ssl|tls|self.signed/i.test(msg)) {
    return 'Update server certificate error. Try again later.'
  }
  if (/404|not found/i.test(msg)) {
    return 'Update not found on server.'
  }
  if (/checksum|sha512|hash|verify|signature/i.test(msg)) {
    return 'Update integrity check failed. The download may be corrupt.'
  }
  if (/ENOSPC|disk.?full|no space/i.test(msg)) {
    return 'Not enough disk space to download update.'
  }
  if (/EPERM|EACCES|permission/i.test(msg)) {
    return 'Permission denied while applying update.'
  }

  // Generic fallback — strip anything that looks like a file path or URL
  return 'Update check failed. Try again later.'
}

function setStatus(status: UpdateStatus): void {
  currentStatus = status
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('update-status-changed', status)
  })
}

export function getUpdateStatus(): UpdateStatus {
  return currentStatus
}

export function getUpdateVersion(): string | null {
  return updateInfo?.version || null
}

export function getUpdateErrorMessage(): string | null {
  return lastErrorMessage
}

export function initAutoUpdater(): void {
  // Reset retry state before re-arming handlers. This is mostly defensive
  // for tests that call initAutoUpdater() multiple times — in production
  // init is called exactly once per process lifetime.
  resetRetryState()

  // Don't auto-install on download — let the user restart when ready
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    setStatus('checking')
  })

  autoUpdater.on('update-available', (info) => {
    updateInfo = info
    setStatus('available')
    // Successful contact with the update server — clear any pending
    // backoff so a fresh failure later starts at the 5-minute step.
    resetRetryState()
  })

  autoUpdater.on('download-progress', () => {
    setStatus('downloading')
  })

  autoUpdater.on('update-downloaded', (info) => {
    updateInfo = info
    setStatus('ready')
    console.log(`[Updater] Update ${info.version} downloaded, will install on restart`)
    resetRetryState()
  })

  autoUpdater.on('update-not-available', () => {
    setStatus('idle')
    resetRetryState()
  })

  autoUpdater.on('error', (err) => {
    const safeMessage = sanitizeUpdateError(err)
    lastErrorMessage = safeMessage
    console.error('[Updater] Error:', safeMessage)
    setStatus('error')
    // Pass the SANITIZED message — the original `err` may contain signing-cert
    // paths or update-server URLs that the reporter's PII scrubber wouldn't
    // otherwise know to redact. The reporter still applies its own scrub
    // pass, but giving it pre-sanitised input is defence in depth.
    reportError('auto_updater', {
      message: `Auto-update failed: ${safeMessage}`,
      context: { sanitized: safeMessage },
    })

    // Retry-with-backoff for transient network errors (DNS / connection
    // reset / etc.). Non-network errors (signature, disk-full, 404) get
    // logged once and wait for the regular 4-hour interval — retrying
    // those just adds log noise. See isRetryableUpdateError() docstring.
    if (isRetryableUpdateError(err)) {
      scheduleRetry()
    }
  })

  // Check after a short delay so the app starts up fast
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 5000)

  // Then check every 4 hours
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 4 * 60 * 60 * 1000)
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdates().catch(() => {})
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall()
}
