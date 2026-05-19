/**
 * Schedules tools — cron jobs, manual fires, triggers (webhook/email/chain).
 *
 * Schedules created via these tools appear in the user's /schedules dashboard
 * automatically because the backend writes to the same chats.room_settings.schedule
 * structure under the same user_id.
 *
 * Tool list (kept lean on purpose — see "Six-Tool Pattern" research):
 *
 *   list_schedules        — read-only
 *   get_schedule          — read-only
 *   create_schedule       — destructive (creates infra; charges 20 cr min)
 *   update_schedule       — non-destructive (PATCH)
 *   delete_schedule       — destructive (soft-delete)
 *   run_schedule_now      — destructive (charges 10 cr/min)
 *   pause_schedule, resume_schedule
 *   list_schedule_runs    — read-only, paginated
 *   add_trigger           — destructive (returns webhook secret ONCE for kind=webhook)
 *   remove_trigger        — destructive
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { CoastyClient } from "../client.js";
import { runTool } from "./_helpers.js";

const FREQUENCY_PRESETS = [
  "every_15_minutes",
  "every_30_minutes",
  "hourly",
  "every_6_hours",
  "every_12_hours",
  "daily",
  "weekly",
  "monthly",
  "custom",
] as const;

export function registerScheduleTools(server: McpServer, api: CoastyClient): void {
  // ── Read tools ──

  server.registerTool(
    "coasty_list_schedules",
    {
      title: "List your schedules",
      description:
        "Returns user's active schedules (id, name, machine_id, cron, next_run_at, " +
        "last_run_at, run_count, paused_reason). Soft-deleted schedules are excluded.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => runTool(() => api.get("/v1/schedules", { query: { limit: args.limit } })),
  );

  server.registerTool(
    "coasty_get_schedule",
    {
      title: "Get a single schedule",
      description: "Fetch one schedule by id. 404 if not found OR not owned by your key.",
      inputSchema: {
        schedule_id: z
          .string()
          .min(8)
          .max(64)
          .describe("Schedule id (UUID or sch_test_<hex>)"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => runTool(() => api.get(`/v1/schedules/${args.schedule_id}`)),
  );

  server.registerTool(
    "coasty_list_schedule_runs",
    {
      title: "List execution history for a schedule",
      description:
        "Cursor-paginated history of fires for a schedule. Each entry has " +
        "{id, status, trigger, duration_seconds, credits_charged, executed_at, error?}. " +
        "Up to 100 entries retained per schedule.",
      inputSchema: {
        schedule_id: z.string().min(8).max(64),
        cursor: z.string().optional().describe("Opaque cursor from a prior page."),
        status: z
          .enum([
            "completed",
            "failed",
            "skipped",
            "cancelled",
            "running",
            "insufficient_credits",
          ])
          .optional()
          .describe("Filter by run status."),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) =>
      runTool(() =>
        api.get(`/v1/schedules/${args.schedule_id}/runs`, {
          query: { cursor: args.cursor, status: args.status, limit: args.limit },
        }),
      ),
  );

  // ── Lifecycle ──

  server.registerTool(
    "coasty_create_schedule",
    {
      title: "Create a new schedule",
      description:
        "Creates a cron-fired or one-shot schedule that runs an agent on the named " +
        "machine. Either `frequency` (preset cron) OR `run_at` (one-shot ISO 8601 UTC) " +
        "must be set, not both. Charges 20 cr minimum on create. Schedule appears " +
        "in the user's /schedules dashboard automatically.\n\n" +
        "Frequency presets: every_15_minutes, every_30_minutes, hourly, every_6_hours, " +
        "every_12_hours, daily, weekly, monthly, custom.\n" +
        "For 'custom', supply a 5- or 6-field cron expression in `cron`.\n" +
        "For 'daily/weekly/monthly', supply HH:MM in `time` and (weekly) `day_of_week` " +
        "0=Mon..6=Sun, or (monthly) `day_of_month` 1-28.",
      inputSchema: {
        name: z.string().min(1).max(128),
        machine_id: z
          .string()
          .min(8)
          .max(64)
          .describe("Target VM. Must be owned by your API key."),
        task_prompt: z
          .string()
          .min(1)
          .max(8000)
          .describe("Instructions for the agent each time the schedule fires."),
        frequency: z.enum(FREQUENCY_PRESETS).optional(),
        cron: z
          .string()
          .max(128)
          .optional()
          .describe("Required when frequency='custom'. 5 or 6 fields."),
        timezone: z
          .string()
          .max(64)
          .optional()
          .describe("IANA timezone, e.g. 'America/New_York'. Default UTC."),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
        day_of_week: z.number().int().min(0).max(6).optional(),
        day_of_month: z.number().int().min(1).max(28).optional(),
        run_at: z
          .string()
          .optional()
          .describe(
            "ISO 8601 UTC for a ONE-SHOT schedule. Mutually exclusive with frequency.",
          ),
        max_consecutive_failures: z.number().int().min(1).max(50).optional(),
        idempotency_key: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[A-Za-z0-9_\-:]+$/)
          .optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const { idempotency_key, ...body } = args;
      return runTool(() =>
        api.post("/v1/schedules", body, { idempotencyKey: idempotency_key }),
      );
    },
  );

  server.registerTool(
    "coasty_update_schedule",
    {
      title: "Update a schedule (partial)",
      description:
        "PATCH a schedule — change name, task_prompt, frequency/cron, timezone, " +
        "or pause state. At least one field must be provided.",
      inputSchema: {
        schedule_id: z.string().min(8).max(64),
        name: z.string().min(1).max(128).optional(),
        task_prompt: z.string().min(1).max(8000).optional(),
        frequency: z.enum(FREQUENCY_PRESETS).optional(),
        cron: z.string().max(128).optional(),
        timezone: z.string().max(64).optional(),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
        day_of_week: z.number().int().min(0).max(6).optional(),
        day_of_month: z.number().int().min(1).max(28).optional(),
        max_consecutive_failures: z.number().int().min(1).max(50).optional(),
        enabled: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const { schedule_id, ...patch } = args;
      return runTool(() => api.patch(`/v1/schedules/${schedule_id}`, patch));
    },
  );

  server.registerTool(
    "coasty_delete_schedule",
    {
      title: "Soft-delete a schedule",
      description:
        "Marks the schedule as deleted (paused_reason='deleted'). The scheduler " +
        "will never fire it again. Recovery requires a manual update — treat as " +
        "destructive.",
      inputSchema: { schedule_id: z.string().min(8).max(64) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => runTool(() => api.delete(`/v1/schedules/${args.schedule_id}`)),
  );

  server.registerTool(
    "coasty_run_schedule_now",
    {
      title: "Manually fire a schedule immediately",
      description:
        "Queues an out-of-band run for the schedule. The agent fires with the " +
        "schedule's current task_prompt (overridable via task_prompt_override). " +
        "Charges 10 cr/min while running, 20 cr min to start. Use idempotency_key " +
        "to safely retry on network errors.",
      inputSchema: {
        schedule_id: z.string().min(8).max(64),
        task_prompt_override: z
          .string()
          .max(8000)
          .optional()
          .describe("Override task_prompt for this one fire only."),
        idempotency_key: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[A-Za-z0-9_\-:]+$/)
          .optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) =>
      runTool(() =>
        api.post(
          `/v1/schedules/${args.schedule_id}/run`,
          { task_prompt_override: args.task_prompt_override },
          { idempotencyKey: args.idempotency_key },
        ),
      ),
  );

  server.registerTool(
    "coasty_pause_schedule",
    {
      title: "Pause a schedule",
      description:
        "Sets paused_reason='user_paused' and disables future firings. " +
        "Resume via coasty_resume_schedule. Existing runs are unaffected.",
      inputSchema: { schedule_id: z.string().min(8).max(64) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => runTool(() => api.post(`/v1/schedules/${args.schedule_id}/pause`, {})),
  );

  server.registerTool(
    "coasty_resume_schedule",
    {
      title: "Resume a paused schedule",
      description: "Clears paused_reason and re-enables future firings.",
      inputSchema: { schedule_id: z.string().min(8).max(64) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => runTool(() => api.post(`/v1/schedules/${args.schedule_id}/resume`, {})),
  );

  // ── Triggers ──

  server.registerTool(
    "coasty_add_trigger",
    {
      title: "Add a trigger to a schedule (webhook | email | chain)",
      description:
        "Creates a trigger that fires the schedule on an external event.\n\n" +
        "  webhook  Returns a public URL + signing secret (whsec_<64 hex>). External\n" +
        "           systems POST to the URL with a Coasty-Signature header (HMAC-SHA256\n" +
        "           over '<unix_ts>.<body>'). Replay window 5 min, 1 MB body cap.\n" +
        "           THE SECRET IS RETURNED ONCE — store it.\n" +
        "  email    Provisions an inbound mailbox (sched.<rand>@agents.coasty.ai).\n" +
        "           Inbound emails will fire the schedule (mail-poll wiring TBD).\n" +
        "  chain    Fires this schedule when a SOURCE schedule completes.\n" +
        "           Requires source_schedule_id. Max chain depth: 5.",
      inputSchema: {
        schedule_id: z.string().min(8).max(64),
        kind: z.enum(["webhook", "email", "chain"]),
        // chain
        source_schedule_id: z
          .string()
          .min(8)
          .max(64)
          .optional()
          .describe("Required for kind='chain'."),
        event: z.enum(["on_complete", "on_failure", "on_any"]).optional(),
        pass_output: z
          .boolean()
          .optional()
          .describe("Chain only: pass source's last_output_summary into this run's prompt."),
        // webhook
        rate_limit_per_minute: z.number().int().min(1).max(600).optional(),
        // email
        email_label: z
          .string()
          .regex(/^[a-z0-9][a-z0-9._-]{0,32}[a-z0-9]$/)
          .optional()
          .describe("2-34 chars [a-z0-9._-]; must start+end alphanumeric."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const { schedule_id, ...body } = args;
      return runTool(() => api.post(`/v1/schedules/${schedule_id}/triggers`, body));
    },
  );

  server.registerTool(
    "coasty_remove_trigger",
    {
      title: "Remove a trigger from a schedule",
      description: "Deletes a trigger by id. Webhook triggers also drop their public URL.",
      inputSchema: {
        schedule_id: z.string().min(8).max(64),
        trigger_id: z.string().regex(/^trg_[0-9a-f]{8,32}$/),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) =>
      runTool(() =>
        api.delete(`/v1/schedules/${args.schedule_id}/triggers/${args.trigger_id}`),
      ),
  );
}
