/**
 * Single registration entrypoint — keeps server.ts tidy.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { CoastyClient } from "../client.js";
import { registerCreditsTools } from "./credits.js";
import { registerDiscoveryTools } from "./discovery.js";
import { registerMachineTools } from "./machines.js";
import { registerPredictTools } from "./predict.js";
import { registerScheduleTools } from "./schedules.js";

export function registerAllTools(server: McpServer, api: CoastyClient): void {
  registerPredictTools(server, api);
  registerMachineTools(server, api);
  registerScheduleTools(server, api);
  registerCreditsTools(server, api);
  registerDiscoveryTools(server, api);
}
