#!/usr/bin/env node
// =============================================================================
// Coasty — Pre-Deployment Test Suite (Cross-Platform Node.js)
//
// Works on Windows, macOS, and Linux without bash or PowerShell dependency.
//
// Usage:
//   node scripts/run-all-tests.mjs            # run all
//   node scripts/run-all-tests.mjs frontend   # run only frontend
//   node scripts/run-all-tests.mjs backend    # run only backend
//   node scripts/run-all-tests.mjs electron   # run only electron
//   node scripts/run-all-tests.mjs typecheck  # run only type check
// =============================================================================

import { execSync } from "child_process"
import { existsSync } from "fs"
import { resolve, join } from "path"
import { fileURLToPath } from "url"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const ROOT = resolve(__dirname, "..")
const isWin = process.platform === "win32"

const filter = process.argv[2] || "all"
const results = []
let failed = false

// ── Helpers ──────────────────────────────────────────────────────────────────

const CYAN = "\x1b[36m"
const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const YELLOW = "\x1b[33m"
const BOLD = "\x1b[1m"
const RESET = "\x1b[0m"

function banner(text) {
  console.log()
  console.log(`${CYAN}${BOLD}${"═".repeat(60)}${RESET}`)
  console.log(`${CYAN}${BOLD}  ${text}${RESET}`)
  console.log(`${CYAN}${BOLD}${"═".repeat(60)}${RESET}`)
  console.log()
}

function run(name, command, cwd) {
  console.log(`${YELLOW}▶ Running ${name}...${RESET}`)
  const start = Date.now()
  try {
    execSync(command, {
      cwd,
      stdio: "inherit",
      shell: true,
      env: { ...process.env, FORCE_COLOR: "1" },
    })
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`${GREEN}✓ ${name} passed (${elapsed}s)${RESET}\n`)
    results.push({ name, passed: true, elapsed })
  } catch {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`${RED}✗ ${name} FAILED (${elapsed}s)${RESET}\n`)
    results.push({ name, passed: false, elapsed })
    failed = true
  }
}

/** Resolve the python command — `python3` on Unix, `python` on Windows. */
function pythonCmd() {
  if (isWin) return "python"
  try {
    execSync("python3 --version", { stdio: "ignore" })
    return "python3"
  } catch {
    return "python"
  }
}

/** Activate venv inline (prepend venv bin dir to PATH). */
function withVenv(cmd) {
  const venvBin = isWin
    ? join(ROOT, "backend", "venv", "Scripts")
    : join(ROOT, "backend", "venv", "bin")
  if (existsSync(venvBin)) {
    const sep = isWin ? ";" : ":"
    process.env.PATH = venvBin + sep + process.env.PATH
  }
  return cmd
}

// ── Test Suites ──────────────────────────────────────────────────────────────

if (filter === "all" || filter === "frontend") {
  banner("FRONTEND TESTS (Vitest)")
  run("Frontend Unit Tests", "npx vitest run --reporter=verbose", ROOT)
}

if (filter === "all" || filter === "backend") {
  banner("BACKEND TESTS (pytest)")
  const py = pythonCmd()
  withVenv()
  run(
    "Backend Unit & Integration Tests",
    `${py} -m pytest tests/ -v --tb=short`,
    join(ROOT, "backend"),
  )
}

if (filter === "all" || filter === "electron") {
  banner("ELECTRON TESTS (Vitest)")
  run("Electron Unit Tests", "npx vitest run --reporter=verbose", join(ROOT, "electron"))
}

if (filter === "all" || filter === "typecheck") {
  banner("TYPE CHECKING")
  run("TypeScript Type Check", "npx tsc --noEmit", ROOT)
}

// ── Summary ──────────────────────────────────────────────────────────────────

banner("TEST RESULTS SUMMARY")
for (const r of results) {
  const icon = r.passed ? `${GREEN}✓` : `${RED}✗`
  const status = r.passed ? "passed" : "FAILED"
  console.log(`  ${icon} ${r.name} — ${status} (${r.elapsed}s)${RESET}`)
}
console.log()

if (failed) {
  console.log(`${RED}${BOLD}Some test suites failed. Fix issues before deploying.${RESET}`)
  process.exit(1)
} else {
  console.log(`${GREEN}${BOLD}All test suites passed! Ready for deployment.${RESET}`)
  process.exit(0)
}
