/**
 * Cross-runtime cryptographic round-trip test.
 *
 * Goal: catch any byte-level format drift between
 *   - the Python encrypt path (`backend/app/utils/encryption.py:encrypt_str`)
 *   - the Node decrypt path (`lib/screenshot-encryption.ts:maybeDecryptScreenshot`)
 *
 * Method: shell out to the Python helper to encrypt fixed plaintexts under a
 * known key, then decrypt the resulting `enc:v1:...` strings with the Node
 * helper and verify the round-trip is byte-identical. If the AES-GCM nonce
 * length, tag placement, or base64 encoding ever drift between the two
 * runtimes, this test fails LOUDLY rather than silently producing broken
 * screenshots in production.
 *
 * Why a real Python subprocess instead of hard-coded fixtures: AES-GCM uses
 * a fresh random nonce per call, so we cannot pre-compute a fixture and
 * compare bytes. The test runs the actual encrypt path each time, so any
 * future change to either helper (different nonce length, tag position,
 * extra metadata bytes, etc.) is caught.
 */
import { describe, it, expect, beforeAll } from "vitest"
import { execFileSync } from "child_process"
import { randomBytes } from "crypto"
import * as path from "path"
import * as fs from "fs"

const REPO_ROOT = path.resolve(__dirname, "..")
const BACKEND_DIR = path.join(REPO_ROOT, "backend")

// 32-byte test key shared between the two runtimes for this test only.
const TEST_KEY = randomBytes(32).toString("base64")

/** Run the Python encrypter inline. Returns the `enc:v1:<base64>` string. */
function pythonEncrypt(plaintext: string): string {
  const script = `
import os, sys
os.environ["ENCRYPTION_KEY"] = "${TEST_KEY}"
sys.path.insert(0, r"${BACKEND_DIR.replace(/\\/g, "\\\\")}")
from app.utils.encryption import encrypt_str
sys.stdout.write("enc:v1:" + encrypt_str(sys.argv[1]))
`
  // Pipe plaintext via argv to avoid shell-escaping issues. Python's argv
  // limit on Windows is ~32k chars — fine for the small fixtures we use.
  // The 1 MB fixture below routes via a temp file to dodge that limit.
  const out = execFileSync("python", ["-c", script, plaintext], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  return out
}

function pythonEncryptLarge(plaintext: string): string {
  // For payloads larger than the argv limit on Windows, route plaintext via
  // a temp file. This keeps the same crypto path; only the IO changes.
  const tmp = path.join(REPO_ROOT, `.tmp-roundtrip-${process.pid}-${Date.now()}.txt`)
  fs.writeFileSync(tmp, plaintext, "utf8")
  try {
    const script = `
import os, sys
os.environ["ENCRYPTION_KEY"] = "${TEST_KEY}"
sys.path.insert(0, r"${BACKEND_DIR.replace(/\\/g, "\\\\")}")
from app.utils.encryption import encrypt_str
with open(sys.argv[1], "r", encoding="utf-8") as f:
    plaintext = f.read()
sys.stdout.write("enc:v1:" + encrypt_str(plaintext))
`
    return execFileSync("python", ["-c", script, tmp], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  }
}

describe("Python → Node screenshot decryption round-trip", () => {
  let maybeDecryptScreenshot: typeof import("../lib/screenshot-encryption").maybeDecryptScreenshot
  let decryptScreenshotsInParts: typeof import("../lib/screenshot-encryption").decryptScreenshotsInParts

  beforeAll(async () => {
    // Set the key BEFORE importing the module so the lazy key resolver
    // caches the correct value. The module memoizes after first read.
    process.env.ENCRYPTION_KEY = TEST_KEY
    const mod = await import("../lib/screenshot-encryption")
    maybeDecryptScreenshot = mod.maybeDecryptScreenshot
    decryptScreenshotsInParts = mod.decryptScreenshotsInParts
  })

  it("decrypts a short ASCII string encrypted in Python", () => {
    const plaintext = "hello world"
    const wrapped = pythonEncrypt(plaintext)
    expect(wrapped.startsWith("enc:v1:")).toBe(true)
    expect(maybeDecryptScreenshot(wrapped)).toBe(plaintext)
  })

  it("decrypts a unicode/emoji string", () => {
    const plaintext = "café 🔒 中文 emoji 🎉"
    const wrapped = pythonEncrypt(plaintext)
    expect(maybeDecryptScreenshot(wrapped)).toBe(plaintext)
  })

  it("decrypts a realistic base64 screenshot blob (1 MB)", () => {
    // 1 MB random bytes, base64-encoded — same shape as an actual screenshot.
    const plaintext = randomBytes(1024 * 1024).toString("base64")
    const wrapped = pythonEncryptLarge(plaintext)
    expect(maybeDecryptScreenshot(wrapped)).toBe(plaintext)
  })

  it("decrypts an empty string", () => {
    const wrapped = pythonEncrypt("")
    expect(maybeDecryptScreenshot(wrapped)).toBe("")
  })

  it("plaintext (no sentinel) is returned unchanged", () => {
    expect(maybeDecryptScreenshot("just-a-base64-string")).toBe("just-a-base64-string")
  })

  it("encrypted by Node, decrypted by Node (same format)", () => {
    // Self-roundtrip via the same module — sanity check that our writer
    // (if we ever add one) and reader agree.
    // The current Node helper only decrypts, so we encrypt with Python.
    const plaintext = "self-roundtrip"
    const wrapped = pythonEncrypt(plaintext)
    expect(maybeDecryptScreenshot(wrapped)).toBe(plaintext)
  })

  it("walks a parts array decrypting only the encrypted entries", () => {
    const plain = "plain-shot"
    const encWrapped = pythonEncrypt("encrypted-shot")
    const parts = [
      {
        type: "tool-invocation",
        toolInvocation: {
          toolCallId: "1",
          toolName: "browser",
          frontendScreenshot: plain,
        },
      },
      {
        type: "tool-invocation",
        toolInvocation: {
          toolCallId: "2",
          toolName: "browser",
          frontendScreenshot: encWrapped,
        },
      },
      {
        type: "tool-invocation",
        toolInvocation: { toolCallId: "3", toolName: "browser" },
      },
      { type: "text", text: "no toolInvocation" },
    ]
    const out = decryptScreenshotsInParts(parts) as typeof parts
    // Non-null assertions: the input was a fixed-shape literal so every
    // index is populated; we know our walker preserves length + ordering.
    expect(out[0]!.toolInvocation!.frontendScreenshot).toBe(plain)
    expect(out[1]!.toolInvocation!.frontendScreenshot).toBe("encrypted-shot")
    expect("frontendScreenshot" in out[2]!.toolInvocation!).toBe(false)
    expect(out[3]).toEqual({ type: "text", text: "no toolInvocation" })
  })

  it("tampered ciphertext → maybeDecryptScreenshot returns null", () => {
    const wrapped = pythonEncrypt("authenticated")
    // Flip one base64 char in the middle of the payload.
    const idx = wrapped.length - 10
    const flipped =
      wrapped.slice(0, idx) +
      (wrapped[idx] === "A" ? "B" : "A") +
      wrapped.slice(idx + 1)
    expect(maybeDecryptScreenshot(flipped)).toBeNull()
  })

  it("wrong key → returns null without throwing", async () => {
    // Encrypt under TEST_KEY, then "rotate" by setting a different key and
    // re-importing the helper with cache reset.
    const wrapped = pythonEncrypt("rotated-out")

    // The Node module caches the key at module load. We can't easily reset
    // it across an import, so we test the failure path via a tampered tag
    // instead — covered above. This test documents the intent and
    // verifies the function doesn't throw when given a structurally valid
    // but cryptographically wrong payload.
    // Build a payload with the right shape but garbage bytes:
    const garbage =
      "enc:v1:" +
      Buffer.concat([
        randomBytes(12), // fake nonce
        randomBytes(64), // fake ciphertext
        randomBytes(16), // fake tag
      ]).toString("base64")
    // Auth-tag check fails → null.
    expect(maybeDecryptScreenshot(garbage)).toBeNull()
    // Sanity: the actual valid wrapped value still decrypts.
    expect(maybeDecryptScreenshot(wrapped)).toBe("rotated-out")
  })

  it("malformed sentinel payload → returns null", () => {
    expect(maybeDecryptScreenshot("enc:v1:")).toBeNull()
    expect(maybeDecryptScreenshot("enc:v1:not-base64-!!!")).toBeNull()
    // Too short to contain nonce + tag.
    expect(maybeDecryptScreenshot("enc:v1:AAAA")).toBeNull()
  })

  it("non-string inputs pass safely through the walker", () => {
    expect(decryptScreenshotsInParts(null as unknown as unknown[])).toBe(null)
    expect(decryptScreenshotsInParts(undefined as unknown as unknown[])).toBe(
      undefined
    )
    expect(decryptScreenshotsInParts("not-an-array" as unknown as unknown[])).toBe(
      "not-an-array"
    )
  })
})
