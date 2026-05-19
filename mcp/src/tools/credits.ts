/**
 * Credit balance + usage summary.
 *
 * The agent will hit this BEFORE any expensive call when token-usage prompts
 * say "check credits first". Cheap, idempotent, read-only.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { CoastyClient } from "../client.js";
import { runTool } from "./_helpers.js";

export function registerCreditsTools(server: McpServer, api: CoastyClient): void {
  server.registerTool(
    "coasty_get_credits",
    {
      title: "Get current credit balance + tier",
      description:
        "Returns the user's credit balance, subscription tier, and per-period " +
        "usage summary. Use this BEFORE expensive operations (provision_machine, " +
        "create_schedule, run_schedule_now) to confirm the user has enough budget.",
      inputSchema: {
        period: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .optional()
          .describe("YYYY-MM. Default current month."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => runTool(() => api.get("/v1/usage", { query: { period: args.period } })),
  );
}
