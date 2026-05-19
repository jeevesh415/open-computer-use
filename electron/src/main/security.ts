/**
 * Security validation layer for local command execution.
 *
 * Defence-in-depth that sits BELOW the approval system: even if a command is
 * auto-approved (e.g. full_control mode), these checks block catastrophic
 * operations like deleting system files, exfiltrating credentials, or running
 * fork bombs.
 *
 * Design principles:
 *  - Minimal false positives — only block truly dangerous operations.
 *  - Clear error messages — explain what was blocked and why.
 *  - Invisible for normal use — legitimate workflows are never disrupted.
 *  - Protect app credentials — agent cannot read its own session tokens.
 *  - Platform-hardened — handles Windows 8.3 names, device names, UNC paths,
 *    macOS Keychains, and platform-specific system directories.
 */

import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'
import { app } from 'electron'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PathValidationResult {
  allowed: boolean
  reason?: string
}

export interface CommandRiskResult {
  blocked: boolean
  reason?: string
}

// ─── Pattern Definitions (exported for testing) ───────────────────────────────

export interface LabelledPattern {
  pattern: RegExp
  label: string
}

export interface DangerousPattern {
  pattern: RegExp
  reason: string
}

/**
 * Credential file patterns relative to the user's home directory.
 * Blocked for ALL operations (read/write/delete).
 */
export const CREDENTIAL_PATTERNS: LabelledPattern[] = [
  // SSH
  { pattern: /^\/\.ssh\/(?:id_|.*\.pem$|authorized_keys$|config$)/i, label: 'SSH key/config' },
  // GPG
  { pattern: /^\/\.gnupg\//i, label: 'GPG keyring' },
  // Cloud providers
  { pattern: /^\/\.aws\/credentials$/i, label: 'AWS credentials' },
  { pattern: /^\/\.aws\/sso\/cache\//i, label: 'AWS SSO cache' },
  { pattern: /^\/\.azure\/accessTokens\.json$/i, label: 'Azure access tokens' },
  { pattern: /^\/\.azure\/msal_token_cache/i, label: 'Azure MSAL token cache' },
  { pattern: /^\/\.config\/gcloud\/credentials\.db$/i, label: 'GCP credentials' },
  { pattern: /^\/\.config\/gcloud\/application_default_credentials\.json$/i, label: 'GCP default credentials' },
  // Container / orchestration
  { pattern: /^\/\.docker\/config\.json$/i, label: 'Docker credentials' },
  { pattern: /^\/\.kube\/config$/i, label: 'Kubernetes config (contains cluster tokens)' },
  // Package managers / registries
  { pattern: /^\/\.netrc$/i, label: 'netrc credentials' },
  { pattern: /^\/\.npmrc$/i, label: 'npm credentials' },
  { pattern: /^\/\.pypirc$/i, label: 'PyPI credentials' },
  { pattern: /^\/\.gem\/credentials$/i, label: 'RubyGems credentials' },
  { pattern: /^\/\.nuget\/NuGet\.Config$/i, label: 'NuGet credentials' },
  // Git
  { pattern: /^\/\.git-credentials$/i, label: 'Git stored credentials' },
  // macOS Keychain
  { pattern: /^\/Library\/Keychains\//i, label: 'macOS Keychain' },
  // macOS cookies
  { pattern: /^\/Library\/Cookies\//i, label: 'macOS browser cookies' },
  // Browser password databases — Chrome/Edge/Brave
  { pattern: /\/(?:Google\/Chrome|Microsoft\\?\/Edge|BraveSoftware\/Brave-Browser)\/.*\/Login Data$/i, label: 'browser password database' },
  { pattern: /\/(?:Google\/Chrome|Microsoft\\?\/Edge|BraveSoftware\/Brave-Browser)\/.*\/Cookies$/i, label: 'browser cookie database' },
  // Firefox
  { pattern: /\/\.mozilla\/firefox\/.*\/(?:logins\.json|key[34]\.db|cookies\.sqlite)$/i, label: 'Firefox credential/cookie store' },
  // Windows credential store
  { pattern: /\/AppData\/(?:Roaming|Local)\/Microsoft\/Credentials\//i, label: 'Windows Credential Store' },
  { pattern: /\/AppData\/Local\/Microsoft\/Vault\//i, label: 'Windows Credential Vault' },
]

/** Windows system directory patterns — blocked for write/delete. */
export const SYSTEM_DIR_PATTERNS_WIN32: LabelledPattern[] = [
  { pattern: /^[A-Z]:\/Windows\//i, label: 'Windows system directory' },
  { pattern: /^[A-Z]:\/Program Files/i, label: 'Program Files directory' },
  { pattern: /^[A-Z]:\/ProgramData\//i, label: 'ProgramData directory' },
  { pattern: /^[A-Z]:\/\$Recycle\.Bin\//i, label: 'Recycle Bin' },
  { pattern: /^[A-Z]:\/boot\//i, label: 'boot directory' },
  { pattern: /^[A-Z]:\/Recovery\//i, label: 'Recovery directory' },
  { pattern: /^[A-Z]:\/System Volume Information\//i, label: 'System Volume Information' },
  { pattern: /^[A-Z]:\/\$WinREAgent\//i, label: 'Windows Recovery Agent' },
  // 8.3 short names for Program Files — common bypass vector
  { pattern: /^[A-Z]:\/PROGRA~[1-4]\//i, label: 'Program Files (8.3 short name)' },
]

/** Unix/macOS system directory patterns — blocked for write/delete. */
export const SYSTEM_DIR_PATTERNS_UNIX: LabelledPattern[] = [
  { pattern: /^\/boot\//i, label: 'boot directory' },
  { pattern: /^\/sbin\//i, label: 'system binary directory' },
  { pattern: /^\/usr\/sbin\//i, label: 'system admin binary directory' },
  { pattern: /^\/usr\/lib\//i, label: 'system library directory' },
  { pattern: /^\/etc\/(?:shadow|sudoers|pam\.d|master\.passwd)/, label: 'system auth config' },
  { pattern: /^\/System\//, label: 'macOS System directory' },
  { pattern: /^\/Library\/SystemMigration/, label: 'macOS System Migration' },
  { pattern: /^\/private\/var\/db\/dslocal/, label: 'macOS Directory Services' },
  { pattern: /^\/dev\//, label: 'device node' },
  { pattern: /^\/proc\//, label: 'proc filesystem' },
  { pattern: /^\/sys\//, label: 'sys filesystem' },
]

/**
 * Windows reserved device names.
 * Writing to these can hang the process or cause data loss.
 * CON, PRN, AUX, NUL, COM0-9, LPT0-9 — with or without extension.
 */
const WINDOWS_DEVICE_NAME = /^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\..+)?$/i

/** Known app-internal env vars to strip from child processes. */
const STRIP_EXACT_ENV = new Set([
  'INTERNAL_API_KEY',
  'CSRF_SECRET',
  'ENCRYPTION_KEY',
  'SUPABASE_SERVICE_ROLE',
  'STRIPE_API_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_STARTER',
  'STRIPE_PRICE_PROFESSIONAL',
  'STRIPE_PRICE_ENTERPRISE',
  'STRIPE_PRICE_UNLIMITED',
  'POSTHOG_API_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'GOOGLE_SEARCH_KEY',
])

/** Pattern-based env var stripping — catches variants of known secrets. */
const STRIP_PATTERN_ENV: RegExp[] = [
  /^SUPABASE_.*(?:SERVICE_ROLE|SECRET)/i,
  /^STRIPE_.*(?:SECRET|WEBHOOK)/i,
  /^COASTY_.*(?:SECRET|KEY|TOKEN)/i,
]

/** Dangerous shell command patterns. */
export const DANGEROUS_COMMAND_PATTERNS: DangerousPattern[] = [
  // ── Recursive deletion of root / home / entire drive ────────────────────
  {
    // Case-insensitive: handles -rf, -Rf, -rF, -RF etc.
    pattern: /\brm\s+-[^\n;|&]*r[^\n;|&]*\s+\/(\s*$|\s*;|\s*&|\s*\|)/mi,
    reason: 'Recursive deletion of the root filesystem (rm -rf /).',
  },
  {
    pattern: /\brm\s+-[^\n;|&]*r[^\n;|&]*\s+\/\*/mi,
    reason: 'Recursive deletion of all root contents (rm -rf /*).',
  },
  {
    pattern: /\brm\s+-[^\n;|&]*r[^\n;|&]*\s+~\/?(\s|$|;|&|\|)/mi,
    reason: 'Recursive deletion of the entire home directory.',
  },

  // ── Windows cmd destruction ─────────────────────────────────────────────
  {
    pattern: /\brd\s+\/s\s+(?:\/q\s+)?[A-Z]:\\?\s*$/im,
    reason: 'Recursive deletion of an entire drive (rd /s /q C:\\).',
  },
  {
    pattern: /\brmdir\s+\/s\s+(?:\/q\s+)?[A-Z]:\\?\s*$/im,
    reason: 'Recursive deletion of an entire drive (rmdir /s /q C:\\).',
  },
  {
    pattern: /\bdel\s+.*\/[sS].*[A-Z]:\\/im,
    reason: 'Mass deletion from drive root (del /s C:\\).',
  },

  // ── PowerShell destruction ──────────────────────────────────────────────
  {
    // Remove-Item + -Recurse + drive root (any parameter order).
    // The (?=[^a-zA-Z0-9]) after C:\ ensures we only match the root — not C:\Users\... etc.
    pattern: /\bRemove-Item\b(?=[^;|&]*-Recurse)(?=[^;|&]*[\s'"][A-Z]:[\\\/](?=[^a-zA-Z0-9]|$))/im,
    reason: 'PowerShell recursive deletion of drive root (Remove-Item -Recurse C:\\).',
  },
  {
    // Remove-Item targeting / with -Recurse
    pattern: /\bRemove-Item\b(?=[^;|&]*-Recurse)(?=[^;|&]*[\s'"]\/{1,2}['"\s])/im,
    reason: 'PowerShell recursive deletion of filesystem root.',
  },
  {
    pattern: /\bFormat-Volume\b/im,
    reason: 'PowerShell disk format command (Format-Volume).',
  },
  {
    pattern: /\bClear-Disk\b/im,
    reason: 'PowerShell disk clearing command (Clear-Disk).',
  },
  {
    // Encoded PowerShell — hides arbitrary commands in base64, commonly used by malware.
    pattern: /\b(?:powershell|pwsh)(?:\.exe)?\b[^|]*-(?:enc|encodedcommand)\b/im,
    reason: 'Encoded PowerShell command — could be hiding dangerous operations.',
  },

  // ── Disk formatting ─────────────────────────────────────────────────────
  {
    pattern: /\bformat\s+[A-Z]:/im,
    reason: 'Disk format command (format C:).',
  },
  {
    pattern: /\bmkfs(?:\.\w+)?\s/,
    reason: 'Filesystem format command (mkfs).',
  },

  // ── Raw disk operations ─────────────────────────────────────────────────
  {
    pattern: /\bdd\s+[^;|&]*\bof=\/dev\/[hs]d/i,
    reason: 'Raw disk write (dd of=/dev/sdX) — could destroy partition table.',
  },
  {
    pattern: /\bdd\s+[^;|&]*\bof=\\\\\.\\PhysicalDrive/i,
    reason: 'Raw disk write to Windows physical drive.',
  },

  // ── Fork bombs ──────────────────────────────────────────────────────────
  {
    pattern: /:\(\)\s*\{[^}]*:\s*\|\s*:/,
    reason: 'Fork bomb detected — would crash the system.',
  },
  {
    // Windows fork bomb: %0|%0
    pattern: /%0\s*\|\s*%0/,
    reason: 'Windows fork bomb detected (%0|%0).',
  },

  // ── Recursive permission nuke ───────────────────────────────────────────
  {
    pattern: /\bchmod\s+(-\w+\s+)*\d{3,4}\s+\/(\s*$|\s*;)/m,
    reason: 'Recursive permission change on root filesystem.',
  },
  {
    pattern: /\bchown\s+(-\w+\s+)*\S+:\S*\s+\/(\s*$|\s*;)/m,
    reason: 'Recursive ownership change on root filesystem.',
  },

  // ── Windows registry destruction ────────────────────────────────────────
  {
    pattern: /\breg\s+delete\s+HKLM\\/i,
    reason: 'System registry deletion (HKLM) — could render Windows unbootable.',
  },
  {
    pattern: /\breg\s+delete\s+HKEY_LOCAL_MACHINE\\/i,
    reason: 'System registry deletion — could render Windows unbootable.',
  },

  // ── Boot record destruction ─────────────────────────────────────────────
  {
    pattern: /\bbootrec\s+\/fixmbr/i,
    reason: 'Boot record modification (bootrec).',
  },
  {
    pattern: /\bbcdboot\b.*\/[sf]\s/i,
    reason: 'Boot configuration modification.',
  },
]


// ─── Numeric Validation (shell-interpolation safety) ─────────────────────────

/**
 * Coerce a value to a number and reject anything that isn't finite.
 *
 * Desktop automation functions interpolate coordinates into shell command
 * strings (PowerShell, bash, Swift). Without this check an attacker could
 * supply `"100; rm -rf /"` as an x-coordinate and achieve code execution.
 *
 * Returns the coerced number on success; throws on failure.
 */
export function assertFiniteNumber(value: unknown, name: string): number {
  const n = Number(value)
  if (!Number.isFinite(n)) {
    throw new Error(
      `Invalid ${name}: expected a finite number, got ` +
      (typeof value === 'string' ? `"${value}"` : String(value)),
    )
  }
  return n
}


// ─── IPC Sender Validation ───────────────────────────────────────────────────

/**
 * Verify that an IPC message was sent by the main application window.
 *
 * Compares Electron WebContents IDs to reject calls from rogue webviews,
 * devtools, or compromised secondary renderer contexts. Both IDs are
 * plain numbers so the function has no dependency on Electron types and
 * can be easily unit-tested.
 *
 * @param senderWebContentsId  `event.sender.id` from the IPC handler
 * @param mainWindowWebContentsId  `mainWindow.webContents.id` (undefined if no window)
 * @param channel  IPC channel name — included in the error for diagnostics
 */
export function assertIpcSender(
  senderWebContentsId: number,
  mainWindowWebContentsId: number | undefined,
  channel: string,
): void {
  if (
    mainWindowWebContentsId === undefined ||
    senderWebContentsId !== mainWindowWebContentsId
  ) {
    throw new Error(
      `IPC "${channel}" rejected: sender (id=${senderWebContentsId}) ` +
      `is not the main window (id=${mainWindowWebContentsId ?? 'none'}).`,
    )
  }
}


// ─── Path Validation ──────────────────────────────────────────────────────────

/**
 * Normalise a file path and check it against blocklists.
 *
 * Hardened for:
 *  - Null byte injection
 *  - UNC network paths (\\server\share)
 *  - Windows 8.3 short names (PROGRA~1)
 *  - Windows reserved device names (CON, NUL, COM1…)
 *  - Credential/key files across all major platforms
 *  - OS system directories (write/delete)
 *  - Filesystem root (write/delete)
 */
export function validateFilePath(
  filePath: string,
  operation: 'read' | 'write' | 'delete',
): PathValidationResult {
  // ── Basic sanity ──────────────────────────────────────────────────────────
  if (!filePath || typeof filePath !== 'string') {
    return { allowed: false, reason: 'No file path provided.' }
  }

  if (filePath.includes('\0')) {
    return { allowed: false, reason: 'Path contains null bytes (possible injection attack).' }
  }

  // Resolve to absolute, normalising ../ traversal and relative paths.
  let resolved = path.resolve(filePath)

  // ── UNC network paths (Windows \\server\share) ────────────────────────────
  // After path.resolve, UNC paths start with \\ on Windows.
  if (resolved.startsWith('\\\\')) {
    return {
      allowed: false,
      reason: 'Network (UNC) paths are blocked. The agent can only access local files.',
    }
  }

  // ── Windows 8.3 short name expansion ──────────────────────────────────────
  // On Windows, paths like C:\PROGRA~1 bypass pattern checks for C:\Program Files.
  // Try to expand the short name to its canonical long form.
  if (process.platform === 'win32' && /~\d/.test(resolved)) {
    try {
      const expanded = fs.realpathSync.native(resolved)
      if (expanded !== resolved) {
        resolved = expanded
      }
    } catch {
      // Path doesn't exist yet — the static PROGRA~ patterns below will catch
      // the most common cases; for truly novel short names, the system dir
      // patterns on the expanded form would catch them if the path existed.
    }
  }

  // ── Symlink canonicalisation (P1-03) ──────────────────────────────────────
  // A symlink inside an allowed directory pointing to a credential file (e.g.
  // ~/Documents/foo -> ~/.ssh/id_rsa) would otherwise bypass the credential
  // pattern check below, because the literal `resolved` path lives in
  // ~/Documents and not in ~/.ssh. Resolve symlinks to the real target and
  // run the credential + system-dir checks against BOTH paths so a symlink
  // hop cannot launder a sensitive target into an allowed location.
  let canonical: string | null = null
  try {
    const real = fs.realpathSync(resolved)
    if (real !== resolved) {
      canonical = real
    }
  } catch {
    // File doesn't exist yet — no symlink to resolve. This is fine for write
    // operations to new paths; the literal `resolved` check still applies.
  }

  // Use forward-slash for consistent pattern matching across platforms.
  const normalised = resolved.replace(/\\/g, '/')
  const canonicalNormalised = canonical ? canonical.replace(/\\/g, '/') : null

  // ── Windows reserved device names ─────────────────────────────────────────
  // CON, PRN, AUX, NUL, COM0-9, LPT0-9 are special on Windows regardless of
  // directory or extension. Writing to them can hang the process.
  if (process.platform === 'win32' && (operation === 'write' || operation === 'delete')) {
    const basename = path.basename(resolved)
    if (WINDOWS_DEVICE_NAME.test(basename)) {
      return {
        allowed: false,
        reason: `Blocked: "${basename}" is a Windows reserved device name. ` +
          `Writing to device names can hang or crash the application.`,
      }
    }
  }

  // ── App-internal credential files (blocked for ALL operations) ────────────
  let userDataDir: string
  try {
    userDataDir = app.getPath('userData').replace(/\\/g, '/')
  } catch {
    userDataDir = '' // app not ready — skip this check
  }

  // Note: userData is the app's own directory and is never a symlink we need
  // to follow — it's an internal sentinel check using the literal path.
  if (userDataDir && normalised.startsWith(userDataDir + '/')) {
    const relative = normalised.slice(userDataDir.length + 1).toLowerCase()
    if (relative === '.session' || relative === 'approval-config.json') {
      return {
        allowed: false,
        reason: `Blocked: "${path.basename(resolved)}" is an internal app credential file and cannot be accessed by the agent.`,
      }
    }
  }
  // Also reject if the symlink target lands on the userData sentinel files.
  if (userDataDir && canonicalNormalised && canonicalNormalised.startsWith(userDataDir + '/')) {
    const relative = canonicalNormalised.slice(userDataDir.length + 1).toLowerCase()
    if (relative === '.session' || relative === 'approval-config.json') {
      return {
        allowed: false,
        reason: `Blocked: "${path.basename(resolved)}" resolves to an internal app credential file and cannot be accessed by the agent.`,
      }
    }
  }

  // ── Sensitive credential files (blocked for ALL operations) ───────────────
  // Check both the literal resolved path AND the symlink-canonicalised path.
  // A symlink in an allowed directory pointing to ~/.ssh/id_rsa must be
  // blocked even though its literal location isn't under ~/.ssh.
  const home = os.homedir().replace(/\\/g, '/')
  const credCheckPaths: string[] = [normalised]
  if (canonicalNormalised) credCheckPaths.push(canonicalNormalised)

  for (const p of credCheckPaths) {
    const relToHome = p.startsWith(home + '/') ? p.slice(home.length) : null
    if (!relToHome) continue
    for (const { pattern, label } of CREDENTIAL_PATTERNS) {
      if (pattern.test(relToHome)) {
        return {
          allowed: false,
          reason: `Blocked: "${path.basename(resolved)}" is a ${label} file. ` +
            `For security, the agent cannot directly access credential files. ` +
            `Use the terminal instead if you need to manage these.`,
        }
      }
    }
  }

  // ── OS system directories (blocked for write/delete only) ─────────────────
  if (operation === 'write' || operation === 'delete') {
    const patterns = process.platform === 'win32'
      ? SYSTEM_DIR_PATTERNS_WIN32
      : SYSTEM_DIR_PATTERNS_UNIX

    const sysCheckPaths: string[] = [normalised]
    if (canonicalNormalised) sysCheckPaths.push(canonicalNormalised)

    for (const p of sysCheckPaths) {
      for (const { pattern, label } of patterns) {
        if (pattern.test(p)) {
          return {
            allowed: false,
            reason: `Blocked: cannot ${operation} in ${label} (${path.dirname(resolved)}). ` +
              `Modifying system directories could destabilise the OS.`,
          }
        }
      }

      // Block writing/deleting the filesystem root itself
      if (/^[A-Z]:\/?$/i.test(p) || p === '/') {
        return {
          allowed: false,
          reason: `Blocked: cannot ${operation} the filesystem root.`,
        }
      }
    }
  }

  return { allowed: true }
}


// ─── Terminal Environment Sanitisation ────────────────────────────────────────

/**
 * Returns a copy of process.env with app-internal secrets removed.
 *
 * Two-layer stripping:
 *  1. Exact-match set — known Coasty secrets.
 *  2. Pattern-match — catches variants (e.g. SUPABASE_NEW_SECRET_KEY).
 *
 * The user's own env vars are left intact because the agent may legitimately
 * need them to run tools (e.g. AWS CLI, kubectl) on the user's behalf.
 */
export function sanitizeChildEnv(): Record<string, string | undefined> {
  const env = { ...process.env }

  for (const key of Object.keys(env)) {
    if (STRIP_EXACT_ENV.has(key)) {
      delete env[key]
      continue
    }
    for (const pattern of STRIP_PATTERN_ENV) {
      if (pattern.test(key)) {
        delete env[key]
        break
      }
    }
  }

  return env
}


// ─── Dangerous Command Detection ──────────────────────────────────────────────

/**
 * Check whether a shell command matches a known catastrophic pattern.
 *
 * Intentionally conservative — only blocks commands that are almost never
 * intentional and would cause irreversible damage. The approval system
 * handles everything else.
 *
 * Handles:
 *  - Unix: rm -rf /, chmod -R on /, mkfs, dd, fork bombs
 *  - Windows cmd: rd /s /q C:\, format C:, del /s C:\
 *  - PowerShell: Remove-Item -Recurse C:\, Format-Volume, Clear-Disk,
 *    encoded commands (-EncodedCommand / -enc)
 *  - Registry: reg delete HKLM\
 *  - Boot: bootrec, bcdboot
 */
export function checkDangerousCommand(command: string): CommandRiskResult {
  if (!command || typeof command !== 'string') {
    return { blocked: false }
  }

  const cmd = command.trim()

  for (const { pattern, reason } of DANGEROUS_COMMAND_PATTERNS) {
    if (pattern.test(cmd)) {
      return {
        blocked: true,
        reason: `Command blocked: ${reason}\n` +
          `If you genuinely need to run this, execute it manually in a terminal.`,
      }
    }
  }

  return { blocked: false }
}
