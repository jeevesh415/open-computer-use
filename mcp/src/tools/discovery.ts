/**
 * Discovery tools — `get_pricing` and `get_capabilities`.
 *
 * Both are public, zero-credit, read-only. Designed to onboard agents in a
 * single round-trip without making them read external docs or scrape
 * marketing pages:
 *
 *   coasty_get_pricing       — fetches https://coasty.ai/api/pricing
 *   coasty_get_capabilities  — one-shot service description: tools, scopes,
 *                              limits, links to OpenAPI / status / pricing.
 *
 * Why a separate file:
 *   - keeps credits.ts focused on the user's account/billing surface
 *   - both tools are "pre-flight" — agents should call these BEFORE the
 *     first real predict / provision call
 *   - documents the canonical capabilities catalog in one place
 *
 * Why we don't introspect McpServer's private `_registeredTools` map:
 *   - it's intentionally private (`#registeredTools`) on the SDK
 *   - relying on it would silently break on any SDK upgrade
 *   - the catalog below is verified against the actual server in
 *     tests/server.test.ts ("lists every expected tool")
 *
 * Cost: 0 credits for both — `get_pricing` hits a public CDN-cached endpoint;
 * `get_capabilities` is fully local. Surface this in the descriptions so
 * agents know they can call these freely.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { CoastyClient } from "../client.js";
import { runTool } from "./_helpers.js";

// ─── Static capabilities catalog ───────────────────────────────────────────
//
// Mirrors the tools registered by registerAllTools(). Anything added or
// removed there must be reflected here — `tests/server.test.ts` enforces the
// "lists every expected tool" invariant, and `tests/discovery.test.ts`
// asserts this catalog and the registered tool list stay in sync.

type ToolKind = "predict" | "machines" | "schedules" | "account" | "discovery";

interface ToolCatalogEntry {
  name: string;
  type: "mcp";
  kind: ToolKind;
  description: string;
  cost_credits: number;
  scopes: string[];
}

const TOOL_CATALOG: ReadonlyArray<ToolCatalogEntry> = [
  // Predict
  {
    name: "coasty_predict",
    type: "mcp",
    kind: "predict",
    description: "Screenshot + goal → list of agent actions (click/type/scroll).",
    cost_credits: 5,
    scopes: ["predict"],
  },
  {
    name: "coasty_ground",
    type: "mcp",
    kind: "predict",
    description: "Plain-language element description → (x, y) coordinates.",
    cost_credits: 2,
    scopes: ["ground"],
  },
  {
    name: "coasty_ocr",
    type: "mcp",
    kind: "predict",
    description: "Extract text from a screenshot with bounding boxes.",
    cost_credits: 1,
    scopes: ["ocr"],
  },
  {
    name: "coasty_parse",
    type: "mcp",
    kind: "predict",
    description: "Parse pyautogui code into structured action records (no LLM call).",
    cost_credits: 0,
    scopes: ["parse"],
  },

  // Machines
  {
    name: "coasty_list_machines",
    type: "mcp",
    kind: "machines",
    description: "List the user's Coasty VMs.",
    cost_credits: 0,
    scopes: ["machines:read"],
  },
  {
    name: "coasty_get_machine",
    type: "mcp",
    kind: "machines",
    description: "Fetch one VM by id.",
    cost_credits: 0,
    scopes: ["machines:read"],
  },
  {
    name: "coasty_take_machine_screenshot",
    type: "mcp",
    kind: "machines",
    description: "Capture a screenshot of a running VM's desktop.",
    cost_credits: 0,
    scopes: ["machines:read"],
  },
  {
    name: "coasty_provision_machine",
    type: "mcp",
    kind: "machines",
    description: "Provision a fresh VM (Linux or Windows; cloud or sandbox). Min 20 credits to start.",
    cost_credits: 20,
    scopes: ["machines:write"],
  },
  {
    name: "coasty_terminate_machine",
    type: "mcp",
    kind: "machines",
    description: "Terminate a VM (irreversible — uncommitted state is lost).",
    cost_credits: 0,
    scopes: ["machines:write"],
  },
  {
    name: "coasty_start_machine",
    type: "mcp",
    kind: "machines",
    description: "Resume a stopped VM.",
    cost_credits: 0,
    scopes: ["machines:write"],
  },
  {
    name: "coasty_stop_machine",
    type: "mcp",
    kind: "machines",
    description: "Stop a running VM (preserves state, cheaper idle billing).",
    cost_credits: 0,
    scopes: ["machines:write"],
  },
  {
    name: "coasty_execute_machine_action",
    type: "mcp",
    kind: "machines",
    description: "Dispatch any of 40+ allowlisted actions: click, type, scroll, key combos, browser navigate/click/type, file read/write, terminal exec, etc.",
    cost_credits: 0,
    scopes: ["actions:exec"],
  },
  {
    name: "coasty_run_terminal_command",
    type: "mcp",
    kind: "machines",
    description: "Execute a shell command on a VM (PowerShell on Windows, bash on Linux).",
    cost_credits: 0,
    scopes: ["terminal:exec"],
  },

  // Schedules
  {
    name: "coasty_list_schedules",
    type: "mcp",
    kind: "schedules",
    description: "List your Coasty schedules.",
    cost_credits: 0,
    scopes: ["schedules:read"],
  },
  {
    name: "coasty_get_schedule",
    type: "mcp",
    kind: "schedules",
    description: "Fetch one schedule by id.",
    cost_credits: 0,
    scopes: ["schedules:read"],
  },
  {
    name: "coasty_list_schedule_runs",
    type: "mcp",
    kind: "schedules",
    description: "Cursor-paginated execution history for a schedule.",
    cost_credits: 0,
    scopes: ["schedules:read"],
  },
  {
    name: "coasty_create_schedule",
    type: "mcp",
    kind: "schedules",
    description: "Create a cron / one-shot schedule. Appears in the user's /schedules dashboard automatically.",
    cost_credits: 0,
    scopes: ["schedules:write"],
  },
  {
    name: "coasty_update_schedule",
    type: "mcp",
    kind: "schedules",
    description: "Update a schedule (PATCH any field).",
    cost_credits: 0,
    scopes: ["schedules:write"],
  },
  {
    name: "coasty_delete_schedule",
    type: "mcp",
    kind: "schedules",
    description: "Soft-delete a schedule.",
    cost_credits: 0,
    scopes: ["schedules:write"],
  },
  {
    name: "coasty_run_schedule_now",
    type: "mcp",
    kind: "schedules",
    description: "Manually fire a schedule (idempotent with key). Bills at 10 credits/min for the resulting agent run.",
    cost_credits: 0,
    scopes: ["schedules:write"],
  },
  {
    name: "coasty_pause_schedule",
    type: "mcp",
    kind: "schedules",
    description: "Disable future fires.",
    cost_credits: 0,
    scopes: ["schedules:write"],
  },
  {
    name: "coasty_resume_schedule",
    type: "mcp",
    kind: "schedules",
    description: "Re-enable future fires.",
    cost_credits: 0,
    scopes: ["schedules:write"],
  },
  {
    name: "coasty_add_trigger",
    type: "mcp",
    kind: "schedules",
    description: "Attach a webhook / email / chain trigger. Webhook secrets returned ONCE.",
    cost_credits: 0,
    scopes: ["triggers:write"],
  },
  {
    name: "coasty_remove_trigger",
    type: "mcp",
    kind: "schedules",
    description: "Remove a trigger.",
    cost_credits: 0,
    scopes: ["triggers:write"],
  },

  // Account
  {
    name: "coasty_get_credits",
    type: "mcp",
    kind: "account",
    description: "Read current credit balance, tier, and period usage.",
    cost_credits: 0,
    scopes: ["usage"],
  },

  // Discovery (these tools)
  {
    name: "coasty_get_pricing",
    type: "mcp",
    kind: "discovery",
    description: "Public pricing snapshot (subscriptions, boosts, per-call rates). No auth, no credits.",
    cost_credits: 0,
    scopes: [],
  },
  {
    name: "coasty_get_capabilities",
    type: "mcp",
    kind: "discovery",
    description: "One-shot service description with tool catalog, scopes, limits, discovery links.",
    cost_credits: 0,
    scopes: [],
  },
];

// All scopes the API key model recognises — mirrors backend
// api_key_service.ALL_SCOPES. Kept here verbatim because the MCP server
// needs to advertise this list without making a backend call.
const ALL_SCOPES: ReadonlyArray<string> = [
  "predict",
  "session",
  "ground",
  "ocr",
  "parse",
  "keys",
  "usage",
  "machines:read",
  "machines:write",
  "actions:exec",
  "terminal:exec",
  "files:read",
  "files:write",
  "browser:execute",
  "snapshots:write",
  "connection:read",
  "schedules:read",
  "schedules:write",
  "triggers:write",
];

const PRICING_DESC =
  "Returns Coasty's full pricing snapshot: subscription tiers, boost packages, " +
  "per-call rates for /v1/* endpoints, and per-minute agent rates. Use to budget " +
  "calls before invoking predict/session/machine tools. Output is stable and " +
  "versioned via schemaVersion. No authentication required — pricing is public. " +
  "Cost: 0 credits.";

const CAPABILITIES_DESC =
  "One-shot service description: lists all MCP tools, all /v1/* endpoints, " +
  "supported scopes, request limits, sandbox-vs-live behavior, and links to " +
  "OpenAPI spec + pricing + status page. Designed to onboard agents in a " +
  "single round-trip without reading docs. Cost: 0 credits.";

export function registerDiscoveryTools(server: McpServer, api: CoastyClient): void {
  server.registerTool(
    "coasty_get_pricing",
    {
      title: "Public pricing snapshot",
      description: PRICING_DESC,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        // True because we hit a remote endpoint (api/pricing) — same as every
        // other tool — even though the response is essentially static.
        openWorldHint: true,
      },
    },
    async () => runTool(() => api.get("/api/pricing")),
  );

  server.registerTool(
    "coasty_get_capabilities",
    {
      title: "Capability + onboarding card",
      description: CAPABILITIES_DESC,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        // Local — no network call.
        openWorldHint: false,
      },
    },
    async () => runTool(() => buildCapabilities()),
  );
}

/** Build the capabilities snapshot. Fully local — no API call. */
export function buildCapabilities(): Record<string, unknown> {
  return {
    service: {
      name: "Coasty",
      tagline: "Computer-use AI agents you control via API or MCP",
      homepage: "https://coasty.ai",
      status_page: "https://status.coasty.ai",
      support_email: "founders@coasty.ai",
    },
    discovery: {
      openapi: "https://coasty.ai/.well-known/openapi.json",
      pricing: "https://coasty.ai/api/pricing",
      llms_txt: "https://coasty.ai/llms.txt",
      llms_full: "https://coasty.ai/llms-full.txt",
      mcp_server_card: "https://coasty.ai/.well-known/mcp/server-card.json",
      discovery_manifest: "https://coasty.ai/api/discovery",
    },
    auth: {
      method: "Bearer + X-API-Key",
      key_format: "sk-coasty-{live|test}-<hex>",
      sandbox_keys: "sk-coasty-test-* (free, in-memory mocks)",
      scopes: ALL_SCOPES,
    },
    tools: TOOL_CATALOG,
    limits: {
      max_screenshot_size_bytes: 8_388_608,
      max_task_prompt_chars: 8000,
      rate_limit_per_minute: "see pricing.subscriptions[].apiTier",
      max_agent_session_hours: 6,
    },
  };
}

/** Exposed so tests can assert the catalog mirrors the registered tool set. */
export const DISCOVERY_TOOL_CATALOG = TOOL_CATALOG;
