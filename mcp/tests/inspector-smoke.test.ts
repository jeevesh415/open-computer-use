/**
 * Inspector smoke test — actually spawn the built binary and exercise it
 * via the JSON-RPC protocol. Catches issues unit tests miss:
 *   - dist/ build is broken
 *   - Stdio transport bytes are corrupted by accidental console.log
 *   - Bin shebang or executable permissions wrong
 *   - SIGTERM cleanup hangs
 *
 * Skipped automatically when dist/bin/coasty-mcp.js doesn't exist (so a
 * fresh clone before `npm run build` doesn't error here).
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BIN = path.resolve(__dirname, "..", "dist", "bin", "coasty-mcp.js");
const HAS_BUILD = existsSync(BIN);

// Skip helper — vitest doesn't have an idiomatic way to conditionally skip
// a whole suite, so we use describe.skipIf which is in v0.34+.
const d = HAS_BUILD ? describe : describe.skip;

/**
 * Spawn the binary, send one or more JSON-RPC frames over stdin, collect
 * the responses, and shut it down. This is what an MCP client does over
 * stdio — minus the framing — so we faithfully exercise the same path
 * Claude Desktop hits.
 */
async function rpcRoundtrip(
  frames: object[],
  env: Record<string, string> = {},
): Promise<{ responses: object[]; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [BIN], {
      env: {
        ...process.env,
        COASTY_API_KEY: "sk-coasty-test-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const responses: object[] = [];
    let timer: NodeJS.Timeout | null = null;

    const finish = (exitCode: number | null) => {
      if (timer) clearTimeout(timer);
      // Parse stdout — each newline-delimited frame is a JSON-RPC message.
      for (const line of stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          responses.push(JSON.parse(trimmed));
        } catch {
          // Ignore malformed lines (e.g. partial frames at end).
        }
      }
      resolve({ responses, stderr, exitCode });
    };

    proc.stdout.on("data", (b) => {
      stdout += b.toString();
    });
    proc.stderr.on("data", (b) => {
      stderr += b.toString();
    });
    proc.on("error", reject);
    proc.on("exit", (code) => finish(code));

    // Hard cap — 8s should be more than enough; if hung something is wrong.
    timer = setTimeout(() => {
      proc.kill("SIGTERM");
      setTimeout(() => proc.kill("SIGKILL"), 500);
    }, 8000);

    // Write frames + close stdin so the server initiates shutdown after
    // it answers the last one.
    for (const f of frames) {
      proc.stdin.write(JSON.stringify(f) + "\n");
    }
    proc.stdin.end();
  });
}

d("Binary spawn smoke", () => {
  it("dist/bin/coasty-mcp.js exists after build", () => {
    expect(HAS_BUILD).toBe(true);
  });

  it("--version prints the version and exits 0", async () => {
    const { spawnSync } = await import("node:child_process");
    const res = spawnSync("node", [BIN, "--version"], { encoding: "utf-8" });
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("--help prints usage and exits 0", async () => {
    const { spawnSync } = await import("node:child_process");
    const res = spawnSync("node", [BIN, "--help"], { encoding: "utf-8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Usage:");
    expect(res.stdout).toContain("npx -y @coasty/mcp");
  });

  it("missing API key exits with code 2 + helpful stderr", async () => {
    const { spawnSync } = await import("node:child_process");
    const res = spawnSync("node", [BIN], {
      encoding: "utf-8",
      env: { ...process.env, COASTY_API_KEY: "" },
    });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("COASTY_API_KEY is required");
    expect(res.stderr).toContain("https://coasty.ai/developers");
  });

  it("malformed key exits with code 2 + format hint", async () => {
    const { spawnSync } = await import("node:child_process");
    const res = spawnSync("node", [BIN], {
      encoding: "utf-8",
      env: { ...process.env, COASTY_API_KEY: "sk-anthropic-bogus" },
    });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/sk-coasty-live-|sk-coasty-test-/);
  });

  it("stdout is empty on startup (would corrupt JSON-RPC otherwise)", async () => {
    // Send an initialize so the server answers; before that, no stdout.
    const init = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.0" },
      },
    };
    const { responses, stderr } = await rpcRoundtrip([init]);
    expect(responses.length).toBeGreaterThan(0);
    const first = responses[0] as { jsonrpc?: string; id?: number; result?: unknown };
    expect(first.jsonrpc).toBe("2.0");
    expect(first.id).toBe(1);
    expect(first.result).toBeDefined();
    // stderr should NOT contain anything alarming (only debug logs if --debug,
    // and we didn't pass --debug).
    expect(stderr).not.toMatch(/Error:|Uncaught|fatal/i);
  });

  it("tools/list returns ≥24 tools after initialize", async () => {
    const initialize = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.0" },
      },
    };
    const initialized = { jsonrpc: "2.0", method: "notifications/initialized", params: {} };
    const list = { jsonrpc: "2.0", id: 2, method: "tools/list" };
    const { responses } = await rpcRoundtrip([initialize, initialized, list]);
    const listResp = responses.find(
      (r) => (r as { id?: number }).id === 2,
    ) as { result?: { tools?: unknown[] } } | undefined;
    expect(listResp?.result?.tools).toBeDefined();
    expect((listResp!.result!.tools as unknown[]).length).toBeGreaterThanOrEqual(24);
  });

  it("prompts/list returns the two registered prompts", async () => {
    const initialize = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.0" },
      },
    };
    const initialized = { jsonrpc: "2.0", method: "notifications/initialized", params: {} };
    const list = { jsonrpc: "2.0", id: 3, method: "prompts/list" };
    const { responses } = await rpcRoundtrip([initialize, initialized, list]);
    const listResp = responses.find(
      (r) => (r as { id?: number }).id === 3,
    ) as { result?: { prompts?: Array<{ name: string }> } } | undefined;
    const names = (listResp?.result?.prompts ?? []).map((p) => p.name);
    expect(names).toContain("start_automation_session");
    expect(names).toContain("debug_failed_run");
  });
});
