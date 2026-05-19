/**
 * Prompts — templated workflows surfaced in the host's slash menu.
 *
 * Two starter prompts. Keep this set small — most users won't see prompts
 * unless they're on Claude Desktop, and shipping a long list dilutes
 * discoverability.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "start_automation_session",
    {
      title: "Start a Coasty automation session",
      description:
        "Pre-fills a chat that picks a Coasty VM, takes a screenshot, and " +
        "drives it toward a goal you specify. Useful first prompt for " +
        "exploring the platform.",
      argsSchema: {
        goal: z
          .string()
          .describe("What you want the agent to do (plain language)."),
        machine_id: z
          .string()
          .optional()
          .describe(
            "Optional: a specific VM id. If omitted, the agent picks the first running VM via coasty_list_machines.",
          ),
      },
    },
    ({ goal, machine_id }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `I want to use Coasty to: ${goal}`,
              machine_id
                ? `Use VM ${machine_id} for this session.`
                : `Use coasty_list_machines first; pick the first running VM. If none are running, provision a new one with coasty_provision_machine (display_name='${goal.slice(0, 40)}', desktop_enabled=true).`,
              "Then take a screenshot with coasty_take_machine_screenshot, run coasty_predict against it with the goal above, and execute the recommended actions one by one with coasty_execute_machine_action — taking a fresh screenshot between each step. Stop when the goal is complete or after 10 actions, whichever comes first.",
            ].join("\n\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "debug_failed_run",
    {
      title: "Investigate why a Coasty schedule run failed",
      description:
        "Loads recent run history for a schedule, surfaces the failure mode, " +
        "and proposes fixes (credit top-up, machine restart, prompt rewrite, etc.).",
      argsSchema: {
        schedule_id: z.string().describe("UUID or sch_test_<hex>"),
      },
    },
    ({ schedule_id }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Investigate why schedule ${schedule_id} has been failing.`,
              "Steps:",
              "1. coasty_get_schedule(schedule_id) — check enabled, paused_reason, consecutive_failures, max_failures.",
              "2. coasty_list_schedule_runs(schedule_id, status='failed', limit=10) — read the most recent failure errors.",
              "3. coasty_get_machine(schedule.machine_id) — confirm the VM is reachable and in status='running'.",
              "4. coasty_get_credits — confirm balance is sufficient for the next fire (need ≥20 cr).",
              "Then propose a concrete fix:",
              "  * If consecutive_failures ≥ max_failures and paused_reason='too_many_failures': suggest fixing the underlying issue and calling coasty_resume_schedule.",
              "  * If paused_reason='insufficient_credits': suggest topping up at https://coasty.ai/credits.",
              "  * If the machine is offline: suggest coasty_start_machine(machine_id).",
              "  * If errors mention timeouts or network failures: suggest a simpler task_prompt or a longer timeout.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}
