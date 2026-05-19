/**
 * Machines tools — provision, control, and drive Coasty managed VMs.
 *
 * Tool list (kept under the "Six-Tool Pattern" sweet spot of well-designed
 * verbs over many thin wrappers):
 *
 *   list_machines         — read-only, idempotent
 *   get_machine           — read-only, idempotent
 *   provision_machine     — destructive (creates real EC2/Azure infra)
 *   terminate_machine     — destructive (kills infra)
 *   start_machine         — reversible
 *   stop_machine          — reversible
 *   take_machine_screenshot — read-only
 *   execute_machine_action — kitchen-sink dispatch (covers click/type/scroll
 *                           and the entire ACTION_ALLOWLIST). The model
 *                           passes a `command` + `parameters` object;
 *                           we forward to /v1/machines/{id}/actions.
 *   run_terminal_command  — gated by terminal:exec scope
 *
 * We INTENTIONALLY skip per-command tools (one for click, one for type, ...)
 * because that bloats the tool list and the LLM gets confused. Instead the
 * one `execute_machine_action` tool lists the allowlist in its description
 * so the LLM knows what's possible.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { CoastyClient } from "../client.js";
import { runTool } from "./_helpers.js";

const ACTION_VOCAB = [
  // Desktop
  "screenshot",
  "click",
  "double_click",
  "click_with_modifiers",
  "type",
  "key_press",
  "key_combo",
  "scroll",
  "drag",
  // Window mgmt
  "list_windows",
  "switch_to_window",
  "close_window",
  "minimize_window",
  "maximize_window",
  "restore_window",
  // Terminal (require terminal:exec scope on the API key)
  "terminal_connect",
  "terminal_execute",
  "terminal_read",
  "terminal_clear",
  "terminal_close",
  // Files (read)
  "file_read",
  "file_exists",
  "directory_list",
  // Files (write — requires files:write scope)
  "file_write",
  "file_edit",
  "file_append",
  "file_delete",
  "directory_delete",
  // Browser (default actions:exec scope)
  "browser_open",
  "browser_navigate",
  "browser_click",
  "browser_type",
  "browser_get_dom",
  "browser_get_clickables",
  "browser_state",
  "browser_scroll",
  "browser_close",
  "browser_screenshot",
  "browser_wait",
  "browser_list_tabs",
  "browser_open_tab",
  "browser_close_tab",
  "browser_switch_tab",
  // Browser (browser:execute scope — ARBITRARY JS, sensitive)
  "browser_execute",
] as const;

const EXECUTE_DESC =
  "Run a single action on a Coasty managed VM. The `command` must be one " +
  "of the allowlist (see below); `parameters` is the per-command argument " +
  "object. Common shapes:\n" +
  "  click             { x, y, button? }\n" +
  "  type              { text }\n" +
  "  key_press         { key }                — 'enter','tab','escape','f5',...\n" +
  "  key_combo         { keys: ['ctrl','c'] }\n" +
  "  scroll            { x, y, direction, clicks }\n" +
  "  screenshot        { }                    — returns base64 in result\n" +
  "  browser_navigate  { url }\n" +
  "  browser_click     { selector | x,y | text }\n" +
  "  file_read         { path }               — requires files:read scope\n" +
  "  file_write        { path, content }      — requires files:write scope\n" +
  "  terminal_execute  { command, timeout? }  — requires terminal:exec scope\n" +
  "  browser_execute   { code }               — requires browser:execute scope\n" +
  "Allowlist: " +
  ACTION_VOCAB.join(", ") +
  ".";

export function registerMachineTools(server: McpServer, api: CoastyClient): void {
  // ── Read tools ──

  server.registerTool(
    "coasty_list_machines",
    {
      title: "List your Coasty VMs",
      description:
        "Returns the user's VMs (sandbox or live) with id, name, status, IP, OS, " +
        "and provider. Test-mode keys see only mock VMs (mch_test_*); live keys see real ones.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().describe("Page size, 1-200. Default 50."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => runTool(() => api.get("/v1/machines", { query: { limit: args.limit } })),
  );

  server.registerTool(
    "coasty_get_machine",
    {
      title: "Get a single Coasty VM",
      description: "Fetch one VM by id. Returns 404 if not found OR not owned by your key.",
      inputSchema: {
        machine_id: z.string().min(8).max(64).describe("VM id (UUID or mch_test_<hex>)"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => runTool(() => api.get(`/v1/machines/${args.machine_id}`)),
  );

  server.registerTool(
    "coasty_take_machine_screenshot",
    {
      title: "Capture a screenshot of a running VM",
      description:
        "Returns a base64-encoded JPEG screenshot of the VM's current desktop. " +
        "VM must be in status='running'. Use this before predict/ground/ocr.",
      inputSchema: {
        machine_id: z.string().min(8).max(64),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) =>
      runTool(() => api.get(`/v1/machines/${args.machine_id}/screenshot`)),
  );

  // ── Lifecycle (destructive) ──

  server.registerTool(
    "coasty_provision_machine",
    {
      title: "Provision a new Coasty VM",
      description:
        "Creates a fresh VM (Linux or Windows, optional desktop). Live keys spin " +
        "up real EC2/Azure infrastructure (charged 20 cr min); test keys return a " +
        "mock instantly with no AWS billing. Pass an Idempotency-Key to safely retry.",
      inputSchema: {
        display_name: z.string().min(1).max(64),
        os_type: z.enum(["linux", "windows"]).optional().describe("Default linux."),
        desktop_enabled: z.boolean().optional().describe("Install XFCE+VNC. Default false."),
        provider: z.enum(["aws", "azure", "auto"]).optional().describe("Default auto."),
        cpu_cores: z.number().int().min(1).max(16).optional(),
        memory_gb: z.number().int().min(1).max(64).optional(),
        storage_gb: z.number().int().min(8).max(500).optional(),
        idempotency_key: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[A-Za-z0-9_\-:]+$/)
          .optional()
          .describe("Set once; repeated POSTs with same body are deduplicated for 24h."),
      },
      annotations: {
        readOnlyHint: false,
        // Provisioning real infra is mildly destructive (incurs cost) but
        // not destructive of EXISTING data. We mark non-destructive — the
        // destructive flag is for "deletes user data" semantics.
        destructiveHint: false,
        idempotentHint: false, // without an idempotency key, retries duplicate
        openWorldHint: true,
      },
    },
    async (args) =>
      runTool(() =>
        api.post(
          "/v1/machines",
          {
            display_name: args.display_name,
            os_type: args.os_type,
            desktop_enabled: args.desktop_enabled,
            provider: args.provider,
            cpu_cores: args.cpu_cores,
            memory_gb: args.memory_gb,
            storage_gb: args.storage_gb,
          },
          { idempotencyKey: args.idempotency_key },
        ),
      ),
  );

  server.registerTool(
    "coasty_terminate_machine",
    {
      title: "Terminate a Coasty VM (irreversible)",
      description:
        "Stops the VM and tears down its infra. The VM and any uncommitted state " +
        "are permanently removed. Snapshots persist. Live keys release the EC2/Azure " +
        "resource; test keys delete the in-memory mock.",
      inputSchema: { machine_id: z.string().min(8).max(64) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true, // re-deleting an already-deleted machine 404s
        openWorldHint: true,
      },
    },
    async (args) => runTool(() => api.delete(`/v1/machines/${args.machine_id}`)),
  );

  server.registerTool(
    "coasty_start_machine",
    {
      title: "Start a stopped VM",
      description: "Resumes a stopped VM. Returns 409 if VM isn't in status='stopped'.",
      inputSchema: { machine_id: z.string().min(8).max(64) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => runTool(() => api.post(`/v1/machines/${args.machine_id}/start`, {})),
  );

  server.registerTool(
    "coasty_stop_machine",
    {
      title: "Stop a running VM (preserves state)",
      description:
        "Stops a running VM but keeps the EBS volume attached. Resume with " +
        "coasty_start_machine. Lower idle billing rate (~5 cr/hr) than running.",
      inputSchema: { machine_id: z.string().min(8).max(64) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => runTool(() => api.post(`/v1/machines/${args.machine_id}/stop`, {})),
  );

  // ── Action dispatch (the "do anything on the VM" tool) ──

  server.registerTool(
    "coasty_execute_machine_action",
    {
      title: "Execute an action on a running VM",
      description: EXECUTE_DESC,
      inputSchema: {
        machine_id: z.string().min(8).max(64),
        command: z
          .enum(ACTION_VOCAB)
          .describe("Canonical command name (allowlist enforced server-side)."),
        parameters: z
          .record(z.string(), z.any())
          .optional()
          .describe("Per-command parameters. See description for shapes."),
        timeout_ms: z
          .number()
          .int()
          .min(1000)
          .max(120_000)
          .optional()
          .describe("Override per-command timeout. Default 30s."),
        idempotency_key: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[A-Za-z0-9_\-:]+$/)
          .optional(),
      },
      annotations: {
        readOnlyHint: false, // some commands write (file_write, type, click)
        destructiveHint: false,
        idempotentHint: false, // most actions aren't idempotent (clicks)
        openWorldHint: true,
      },
    },
    async (args) =>
      runTool(() =>
        api.post(
          `/v1/machines/${args.machine_id}/actions`,
          {
            command: args.command,
            parameters: args.parameters ?? {},
            timeout_ms: args.timeout_ms,
          },
          { idempotencyKey: args.idempotency_key },
        ),
      ),
  );

  // ── Terminal convenience ──

  server.registerTool(
    "coasty_run_terminal_command",
    {
      title: "Run a shell command on a VM",
      description:
        "Executes a shell command inside the VM (PowerShell on Windows, bash on Linux). " +
        "Output is truncated to 5000 chars VM-side. Requires terminal:exec scope on the " +
        "API key. For long-running commands, pass a session_id to reuse a persistent shell.",
      inputSchema: {
        machine_id: z.string().min(8).max(64),
        command: z
          .string()
          .min(1)
          .max(8192)
          .describe("Shell command. Single-line or multi-line bash/pwsh."),
        timeout_ms: z.number().int().min(1000).max(120_000).optional().describe("Default 30000."),
        session_id: z.string().max(128).optional().describe("Reuse a persistent shell."),
        cwd: z.string().max(512).optional().describe("Initial working directory."),
        idempotency_key: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[A-Za-z0-9_\-:]+$/)
          .optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false, // could be — but we can't infer from the command
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) =>
      runTool(() =>
        api.post(
          `/v1/machines/${args.machine_id}/terminal`,
          {
            command: args.command,
            timeout_ms: args.timeout_ms ?? 30_000,
            session_id: args.session_id,
            cwd: args.cwd,
          },
          { idempotencyKey: args.idempotency_key },
        ),
      ),
  );
}
