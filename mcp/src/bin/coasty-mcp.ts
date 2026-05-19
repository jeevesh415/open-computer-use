#!/usr/bin/env node
/**
 * Stdio entrypoint for the Coasty MCP server.
 *
 * Run via:
 *   npx -y @coasty/mcp                    # production
 *   COASTY_API_KEY=sk-coasty-test-... node dist/bin/coasty-mcp.js
 *
 * CLI flags (override env):
 *   --api-key=<key>     Override COASTY_API_KEY
 *   --base-url=<url>    Override COASTY_API_BASE_URL (default https://coasty.ai)
 *   --timeout=<ms>      Override per-request timeout
 *   --debug             Enable debug logging to stderr
 *   --version           Print version and exit
 *   --help              Print usage and exit
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { ConfigError, loadConfig } from "../config.js";
import { buildServer } from "../server.js";

function parseArgs(argv: string[]): {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  debug?: boolean;
  showVersion?: boolean;
  showHelp?: boolean;
} {
  const out: ReturnType<typeof parseArgs> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (a === "--debug") out.debug = true;
    else if (a === "--version" || a === "-v") out.showVersion = true;
    else if (a === "--help" || a === "-h") out.showHelp = true;
    else if (a.startsWith("--api-key=")) out.apiKey = a.slice("--api-key=".length);
    else if (a === "--api-key") out.apiKey = argv[++i];
    else if (a.startsWith("--base-url=")) out.baseUrl = a.slice("--base-url=".length);
    else if (a === "--base-url") out.baseUrl = argv[++i];
    else if (a.startsWith("--timeout=")) out.timeoutMs = Number(a.slice("--timeout=".length));
    else if (a === "--timeout") out.timeoutMs = Number(argv[++i]);
  }
  return out;
}

const HELP = `
coasty-mcp — Model Context Protocol server for Coasty.

Usage:
  npx -y @coasty/mcp [options]

Options:
  --api-key=<key>      Coasty API key (or set COASTY_API_KEY env var)
  --base-url=<url>     API base URL (default https://coasty.ai)
  --timeout=<ms>       Per-request timeout in milliseconds (default 90000)
  --debug              Log requests to stderr
  --version            Print version and exit
  --help               Print this help and exit

Environment variables:
  COASTY_API_KEY       Required. Get one at https://coasty.ai/developers
  COASTY_API_BASE_URL  Optional. Override the API host (e.g. for self-hosted).
  COASTY_TIMEOUT_MS    Optional. Per-request timeout.
  COASTY_MCP_DEBUG     Optional. Set to '1' to enable debug logging.

Install in Claude Desktop, Cursor, Windsurf, Claude Code:
  See https://coasty.ai/api-docs#mcp for client-specific configs.
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flags = parseArgs(argv);

  if (flags.showHelp) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  if (flags.showVersion) {
    process.stdout.write("1.1.0\n");
    process.exit(0);
  }

  let cfg;
  try {
    cfg = loadConfig({
      apiKey: flags.apiKey,
      baseUrl: flags.baseUrl,
      timeoutMs: flags.timeoutMs,
      debug: flags.debug,
    });
  } catch (e) {
    if (e instanceof ConfigError) {
      process.stderr.write(`coasty-mcp: ${e.message}\n`);
      process.exit(2);
    }
    throw e;
  }

  // CRITICAL: with stdio transport, ANY accidental write to stdout corrupts
  // the JSON-RPC stream and the client (Claude Desktop, Cursor, etc.) drops
  // the connection. We log everything to stderr instead.
  if (cfg.debug) {
    process.stderr.write(
      `coasty-mcp: starting v1.0.0 (base=${cfg.baseUrl} timeout=${cfg.timeoutMs}ms)\n`,
    );
  }

  const { server } = buildServer(cfg);
  const transport = new StdioServerTransport();

  // Graceful shutdown so the npm process exits cleanly when the host
  // disconnects (otherwise Claude Desktop occasionally leaves zombies).
  const shutdown = (sig: string) => {
    if (cfg.debug) process.stderr.write(`coasty-mcp: ${sig} — shutting down\n`);
    transport.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await server.connect(transport);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `coasty-mcp: fatal error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
