#!/usr/bin/env node
/**
 * Cross-platform smoke test for the built MCP binary.
 *
 * Replaces the shell-redirect smoke check (`node bin --help > /dev/null`),
 * which broke on Windows because `/dev/null` doesn't exist there. Using a
 * Node script keeps the gate identical on Mac/Linux/Windows.
 *
 * What it verifies:
 *   1. `dist/bin/coasty-mcp.js` exists (catches incomplete builds).
 *   2. `--version` exits 0 and prints a semver-shaped string to stdout.
 *   3. `--help`    exits 0 and prints something containing "Usage:".
 *   4. Running with NO API key exits 2 with a helpful stderr message.
 *
 * No JSON-RPC handshake here — that's covered by the inspector-smoke test
 * suite. This script is the LAST gate before publish, so we keep it tiny
 * and fast (under 200ms total).
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BIN = path.resolve(__dirname, "..", "dist", "bin", "coasty-mcp.js");

let failures = 0;
const log = (msg) => process.stderr.write(`[smoke] ${msg}\n`);
const fail = (msg) => {
  failures++;
  process.stderr.write(`[smoke] ✗ ${msg}\n`);
};
const pass = (msg) => log(`✓ ${msg}`);

// ── 1. dist/bin/coasty-mcp.js exists ────────────────────────────────────────

if (!existsSync(BIN)) {
  fail(`built binary missing at ${BIN}. Run \`npm run build\` first.`);
  process.exit(1);
}
pass("built binary present");

// ── 2. --version exits 0 + prints semver ───────────────────────────────────

{
  const r = spawnSync(process.execPath, [BIN, "--version"], { encoding: "utf-8" });
  if (r.status !== 0) {
    fail(`--version exit=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
  } else if (!/^\d+\.\d+\.\d+/.test(r.stdout.trim())) {
    fail(`--version printed unexpected output: ${JSON.stringify(r.stdout)}`);
  } else {
    pass(`--version → ${r.stdout.trim()}`);
  }
}

// ── 3. --help exits 0 + contains "Usage:" ──────────────────────────────────

{
  const r = spawnSync(process.execPath, [BIN, "--help"], { encoding: "utf-8" });
  if (r.status !== 0) {
    fail(`--help exit=${r.status}`);
  } else if (!r.stdout.includes("Usage:")) {
    fail(`--help missing "Usage:" header. stdout starts with: ${JSON.stringify(r.stdout.slice(0, 80))}`);
  } else {
    pass(`--help printed ${r.stdout.length} chars including Usage:`);
  }
}

// ── 4. missing API key fails fast with code 2 ──────────────────────────────

{
  const r = spawnSync(process.execPath, [BIN], {
    encoding: "utf-8",
    env: { ...process.env, COASTY_API_KEY: "" },
  });
  if (r.status !== 2) {
    fail(
      `expected exit 2 on missing key, got ${r.status}. stderr=${r.stderr.slice(0, 200)}`,
    );
  } else if (!r.stderr.includes("COASTY_API_KEY")) {
    fail(`missing-key error didn't mention COASTY_API_KEY. stderr=${r.stderr.slice(0, 200)}`);
  } else {
    pass("missing API key → exit 2 + helpful stderr");
  }
}

// ── Result ─────────────────────────────────────────────────────────────────

if (failures > 0) {
  process.stderr.write(`[smoke] ${failures} check(s) failed\n`);
  process.exit(1);
}
log("all smoke checks passed");
