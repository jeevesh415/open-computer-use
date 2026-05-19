/**
 * auto-secrets.test.ts — Phase 8 OSS-mode auto-generation of CSRF_SECRET
 * and ENCRYPTION_KEY into `.env.local`.
 *
 * Surfaces under test:
 *
 *   1. Generates both secrets when neither is in `process.env` nor in
 *      `.env.local`.
 *   2. Skips a secret already present in `process.env`.
 *   3. Skips a secret already present in `.env.local` content.
 *   4. Generated CSRF_SECRET is 64 hex chars (32 bytes hex-encoded).
 *   5. Generated ENCRYPTION_KEY base64-decodes to exactly 32 bytes — the
 *      contract `lib/encryption.ts` enforces.
 *   6. The marker comment ("# coasty-auto-generated") appears in the block
 *      we append, so users (and we ourselves) can find it later.
 *   7. Idempotent — a second call after the file is populated is a no-op.
 *   8. No-op when `isOssMode()` returns false (the production case).
 *   9. Defense-in-depth: when NODE_ENV=production AND VERCEL is set, even
 *      if `isOssMode()` returns true, we refuse to write the file. Values
 *      still go into process.env so the current boot survives, but we never
 *      persist on a managed prod deploy.
 *
 * Hermeticity strategy:
 *
 *   - Each test creates an isolated tmp directory and `chdir`s into it so
 *     `path.join(process.cwd(), ".env.local")` is per-test.
 *   - `vi.stubEnv` toggles the env vars the module reads.
 *   - `@/lib/oss-mode` is mocked so we control `isOssMode()` directly.
 *   - `vi.resetModules()` between dynamic imports so each test gets a fresh
 *     copy of the module.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

// ---------------------------------------------------------------------------
// Mock `@/lib/oss-mode` — every test sets `mockIsOssMode` to control the
// gate. We use a `let`-bound flag the mock factory closes over so tests can
// flip it per-case without re-mocking.
// ---------------------------------------------------------------------------
let mockIsOssMode = true
vi.mock("@/lib/oss-mode", () => ({
  isOssMode: () => mockIsOssMode,
}))

// Helper: import the module fresh so any internal state is reset (the
// module itself doesn't memoize, but we still want a clean slate so a future
// refactor that adds memoization doesn't quietly break these tests).
async function importFresh() {
  vi.resetModules()
  return await import("@/lib/auto-secrets")
}

// Per-test scratch directory — points to a real fs path we can chdir into.
let tmpDir: string
let originalCwd: string

beforeEach(() => {
  // Reset OSS-mode flag to the most common test branch.
  mockIsOssMode = true

  // Per-test isolated cwd so .env.local writes don't bleed between tests.
  originalCwd = process.cwd()
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coasty-auto-secrets-"))
  process.chdir(tmpDir)

  // Strip the keys we plan to test from the process env. tests/setup.ts seeds
  // both at the top of the run, so without this the "missing" branch never
  // fires.
  vi.stubEnv("CSRF_SECRET", "")
  vi.stubEnv("ENCRYPTION_KEY", "")
  // Production safety check guards on (NODE_ENV === "production" && VERCEL).
  // Vitest defaults NODE_ENV to "test", but we explicitly clear VERCEL so the
  // gate stays open in OSS-mode tests.
  vi.stubEnv("VERCEL", "")
})

afterEach(() => {
  vi.unstubAllEnvs()
  process.chdir(originalCwd)
  // Best-effort cleanup of the scratch dir. If we can't remove it (Windows
  // file locks, etc.), the OS tmp reaper will do it eventually.
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("auto-secrets (OSS-mode .env.local bootstrap)", () => {
  it("generates both secrets when neither is set in env or file", async () => {
    const { ensureLocalSecrets } = await importFresh()
    ensureLocalSecrets()

    // process.env should now contain both freshly-generated values.
    expect(process.env.CSRF_SECRET).toBeTruthy()
    expect(process.env.ENCRYPTION_KEY).toBeTruthy()

    // .env.local should now exist with both keys.
    const envPath = path.join(tmpDir, ".env.local")
    expect(fs.existsSync(envPath)).toBe(true)
    const content = fs.readFileSync(envPath, "utf8")
    expect(content).toMatch(/^CSRF_SECRET=/m)
    expect(content).toMatch(/^ENCRYPTION_KEY=/m)
  })

  it("skips when CSRF_SECRET already in process.env", async () => {
    vi.stubEnv("CSRF_SECRET", "preexisting-csrf-value")
    // ENCRYPTION_KEY still missing — we want to confirm only ENCRYPTION_KEY
    // gets generated, not CSRF_SECRET.

    const { ensureLocalSecrets } = await importFresh()
    ensureLocalSecrets()

    // CSRF_SECRET must remain the preexisting value (not overwritten).
    expect(process.env.CSRF_SECRET).toBe("preexisting-csrf-value")
    // ENCRYPTION_KEY should have been generated (it was missing).
    expect(process.env.ENCRYPTION_KEY).toBeTruthy()

    const envPath = path.join(tmpDir, ".env.local")
    const content = fs.readFileSync(envPath, "utf8")
    // The file must NOT contain a CSRF_SECRET= line (we skipped it).
    expect(content).not.toMatch(/^CSRF_SECRET=/m)
    // It must contain ENCRYPTION_KEY=.
    expect(content).toMatch(/^ENCRYPTION_KEY=/m)
  })

  it("skips when ENCRYPTION_KEY already in .env.local file content", async () => {
    // Pre-seed .env.local with an ENCRYPTION_KEY line. process.env stays
    // empty for ENCRYPTION_KEY — the gate is the file contents.
    const envPath = path.join(tmpDir, ".env.local")
    fs.writeFileSync(
      envPath,
      "ENCRYPTION_KEY=already-on-disk-do-not-touch\n",
      "utf8",
    )

    const { ensureLocalSecrets } = await importFresh()
    ensureLocalSecrets()

    // The pre-existing line must survive untouched.
    const content = fs.readFileSync(envPath, "utf8")
    expect(content).toContain("ENCRYPTION_KEY=already-on-disk-do-not-touch")
    // We must not have written a second ENCRYPTION_KEY= line.
    const occurrences = content.match(/^ENCRYPTION_KEY=/gm) ?? []
    expect(occurrences.length).toBe(1)
    // process.env.ENCRYPTION_KEY was not set by us (we don't load .env.local
    // ourselves — Next.js does that). It should still be empty.
    expect(process.env.ENCRYPTION_KEY).toBe("")
    // CSRF_SECRET was missing from both env and file, so it must have been
    // generated.
    expect(process.env.CSRF_SECRET).toBeTruthy()
    expect(content).toMatch(/^CSRF_SECRET=/m)
  })

  it("generated CSRF_SECRET is 64 hex chars", async () => {
    const { ensureLocalSecrets } = await importFresh()
    ensureLocalSecrets()
    const value = process.env.CSRF_SECRET ?? ""
    expect(value).toMatch(/^[0-9a-f]{64}$/)
  })

  it("generated ENCRYPTION_KEY base64-decodes to exactly 32 bytes", async () => {
    const { ensureLocalSecrets } = await importFresh()
    ensureLocalSecrets()
    const value = process.env.ENCRYPTION_KEY ?? ""
    // Buffer.from is lenient with non-base64 chars; we want a strict length
    // check, since lib/encryption.ts rejects anything other than 32 bytes.
    const decoded = Buffer.from(value, "base64")
    expect(decoded.length).toBe(32)
  })

  it("includes the marker comment in the appended block", async () => {
    const { ensureLocalSecrets } = await importFresh()
    ensureLocalSecrets()
    const envPath = path.join(tmpDir, ".env.local")
    const content = fs.readFileSync(envPath, "utf8")
    expect(content).toContain("# coasty-auto-generated")
    // Marker line carries an ISO timestamp — sanity check.
    expect(content).toMatch(/# coasty-auto-generated: \d{4}-\d{2}-\d{2}T/)
    // Marker also tells the user they can delete the block.
    expect(content).toContain("you can delete and we will regenerate")
  })

  it("idempotent — running twice does not double-add", async () => {
    const { ensureLocalSecrets } = await importFresh()

    ensureLocalSecrets()
    const envPath = path.join(tmpDir, ".env.local")
    const firstContent = fs.readFileSync(envPath, "utf8")
    const firstCsrf = process.env.CSRF_SECRET
    const firstEnc = process.env.ENCRYPTION_KEY

    // Second call. process.env now has both keys (set by the first call), so
    // the function should fast-path and write nothing.
    ensureLocalSecrets()
    const secondContent = fs.readFileSync(envPath, "utf8")

    // File contents are byte-identical to the first run.
    expect(secondContent).toBe(firstContent)
    // process.env values are unchanged.
    expect(process.env.CSRF_SECRET).toBe(firstCsrf)
    expect(process.env.ENCRYPTION_KEY).toBe(firstEnc)
    // Exactly one occurrence of each key in the file.
    expect((secondContent.match(/^CSRF_SECRET=/gm) ?? []).length).toBe(1)
    expect((secondContent.match(/^ENCRYPTION_KEY=/gm) ?? []).length).toBe(1)
  })

  it("no-op when isOssMode() returns false", async () => {
    mockIsOssMode = false

    const { ensureLocalSecrets } = await importFresh()
    ensureLocalSecrets()

    // No file written.
    const envPath = path.join(tmpDir, ".env.local")
    expect(fs.existsSync(envPath)).toBe(false)
    // process.env untouched.
    expect(process.env.CSRF_SECRET).toBe("")
    expect(process.env.ENCRYPTION_KEY).toBe("")
  })

  it("refuses to write file in production mode on Vercel even if OSS mode is on", async () => {
    // Defense-in-depth: if a misconfig flips OSS mode on inside a managed
    // prod deploy, we must not silently rotate secrets across deploys. The
    // values still land in process.env for the current process so the boot
    // doesn't crash, but the persistent file write is skipped.
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("VERCEL", "1")

    const { ensureLocalSecrets } = await importFresh()
    ensureLocalSecrets()

    // No file was written.
    const envPath = path.join(tmpDir, ".env.local")
    expect(fs.existsSync(envPath)).toBe(false)
    // Values were still injected into process.env so the current boot can
    // proceed. Operators should notice the warning and set them explicitly.
    expect(process.env.CSRF_SECRET).toBeTruthy()
    expect(process.env.ENCRYPTION_KEY).toBeTruthy()
  })
})
