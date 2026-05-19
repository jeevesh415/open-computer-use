/**
 * Runtime configuration for the Coasty MCP server.
 *
 * Resolution order (highest priority first):
 *   1. Process env vars (COASTY_API_KEY, COASTY_API_BASE_URL, COASTY_TIMEOUT_MS)
 *   2. CLI flags (--api-key, --base-url, --timeout)  ← parsed in bin/coasty-mcp.js
 *   3. Hardcoded defaults
 *
 * COASTY_API_KEY is the only REQUIRED setting. We refuse to start without one
 * because every tool needs it; failing fast at boot is better than the LLM
 * hitting a 401 on its first call and getting confused.
 */

export type Config = {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  /** Optional hint shown in error envelopes / X-Coasty-Source header so we
   *  can tell support requests "this came from MCP" without log spelunking. */
  userAgent: string;
  /** Set by the bin script when --debug or COASTY_MCP_DEBUG is set. */
  debug: boolean;
};

const DEFAULT_BASE_URL = "https://coasty.ai";
const DEFAULT_TIMEOUT_MS = 90_000; // matches the Cloudflare proxy ceiling

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function loadConfig(args?: {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  debug?: boolean;
}): Config {
  const apiKey = args?.apiKey ?? process.env.COASTY_API_KEY ?? "";
  if (!apiKey) {
    throw new ConfigError(
      "COASTY_API_KEY is required. Set it as an environment variable in your " +
        "MCP client config (Claude Desktop, Cursor, etc.) or pass --api-key on " +
        "the command line. Get a key at https://coasty.ai/developers.",
    );
  }
  const lookKey = apiKey.trim();
  if (
    !lookKey.startsWith("sk-coasty-live-") &&
    !lookKey.startsWith("sk-coasty-test-") &&
    !lookKey.startsWith("cua_sk_") // legacy alias
  ) {
    throw new ConfigError(
      "COASTY_API_KEY does not look like a Coasty key. Expected a value " +
        "starting with 'sk-coasty-live-' or 'sk-coasty-test-'.",
    );
  }

  const baseUrl = (args?.baseUrl ?? process.env.COASTY_API_BASE_URL ?? DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const timeoutMs = clampTimeout(
    args?.timeoutMs ??
      (process.env.COASTY_TIMEOUT_MS ? Number(process.env.COASTY_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS),
  );
  const debug =
    args?.debug ??
    /^(1|true|yes)$/i.test(process.env.COASTY_MCP_DEBUG ?? "");

  return {
    apiKey: lookKey,
    baseUrl,
    timeoutMs,
    userAgent: `coasty-mcp/${getPackageVersion()} node/${process.versions.node}`,
    debug,
  };
}

function clampTimeout(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return DEFAULT_TIMEOUT_MS;
  // Hard floor 1s, hard ceiling 5min — protects against typos like
  // COASTY_TIMEOUT_MS=10 (which would make every call fail) or =1000000000
  // (which would tie up MCP clients forever).
  return Math.min(Math.max(Math.floor(v), 1_000), 5 * 60_000);
}

/** Read package.json version at runtime. Tolerates missing file (dev tree). */
function getPackageVersion(): string {
  try {
    // We can't statically import package.json because of NodeNext + isolatedModules,
    // and we want this to work both in dist/ and in test contexts.
    // Hardcode the version — bumped by the publish workflow.
    return "1.1.0";
  } catch {
    return "0.0.0";
  }
}
