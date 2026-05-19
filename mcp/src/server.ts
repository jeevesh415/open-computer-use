/**
 * Builds the McpServer instance, registers all tools/prompts, returns it ready to connect.
 *
 * The server is transport-agnostic — bin/coasty-mcp.js wires the stdio
 * transport. A future hosted endpoint can reuse this same builder and bolt on
 * Streamable HTTP without touching the tool code.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { CoastyClient } from "./client.js";
import type { Config } from "./config.js";
import { registerPrompts } from "./prompts/index.js";
import { registerAllTools } from "./tools/index.js";

const SERVER_NAME = "coasty";
const SERVER_VERSION = "1.1.0";

export function buildServer(cfg: Config): { server: McpServer; api: CoastyClient } {
  const api = new CoastyClient(cfg);

  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: { listChanged: false },
        prompts: { listChanged: false },
        // No resources in v1 — see research notes.
        logging: {},
      },
      instructions:
        "Coasty exposes its public API as MCP tools: predict actions from " +
        "screenshots, provision and drive managed VMs, create and trigger " +
        "schedules. Authenticate by setting COASTY_API_KEY (sk-coasty-live-* " +
        "for production, sk-coasty-test-* for free sandbox runs). Always check " +
        "credit balance with coasty_get_credits before destructive operations.",
    },
  );

  registerAllTools(server, api);
  registerPrompts(server);

  return { server, api };
}
