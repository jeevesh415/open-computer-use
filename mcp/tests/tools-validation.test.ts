/**
 * Per-tool validation tests.
 *
 * Each test exercises a Zod constraint on a tool's input schema. When a
 * client sends a bad value, the SDK's input-validation layer produces a
 * tool result with isError:true and a Zod-formatted message — we DON'T
 * touch the API. These tests assert that contract.
 *
 * What this catches:
 *   - Min/max bounds on numbers
 *   - Min/max length on strings
 *   - Regex constraints on hex IDs / time / cron
 *   - Enum constraints
 *   - Required field detection
 *   - Mutual exclusion (run_at vs frequency — TODO server-side)
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildServer } from "../src/server.js";

const CFG = {
  apiKey: "sk-coasty-test-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  baseUrl: "https://coasty.ai",
  timeoutMs: 10_000,
  userAgent: "coasty-mcp-test/0.0.0",
  debug: false,
};

const UUID = "550e8400-e29b-41d4-a716-446655440000";
const TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAAAA=";

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
  // IMPORTANT: return a FRESH Response per call. A single Response object's
  // body is consumed on first read; reusing it across iterations causes
  // the second call to silently see an empty body. Use mockImplementation
  // (not mockResolvedValue with a literal) to get a new Response per fetch.
  fetchSpy.mockImplementation(async () =>
    new Response(JSON.stringify({}), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
});

afterEach(() => {
  fetchSpy.mockRestore();
});

async function setup() {
  const { server } = buildServer(CFG);
  const [s, c] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  const client = new Client({ name: "t", version: "0.0.0" }, { capabilities: {} });
  await client.connect(c);
  return client;
}

function isValidationError(res: Awaited<ReturnType<Client["callTool"]>>): boolean {
  if (!res.isError) return false;
  const text = (res.content as Array<{ text: string }>)[0]?.text ?? "";
  return /validation|invalid|required|expected|too|must/i.test(text);
}

// ─── Predict tool validation ────────────────────────────────────────────────

describe("Predict input validation", () => {
  it("coasty_predict requires screenshot ≥20 chars", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_predict",
      arguments: { screenshot: "tiny", instruction: "go" },
    });
    expect(isValidationError(res)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("coasty_predict requires instruction (1..8000)", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_predict",
      arguments: { screenshot: TINY_PNG_B64, instruction: "" },
    });
    expect(isValidationError(res)).toBe(true);
  });

  it("coasty_predict instruction max 8000 chars", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_predict",
      arguments: { screenshot: TINY_PNG_B64, instruction: "x".repeat(8001) },
    });
    expect(isValidationError(res)).toBe(true);
  });

  it("coasty_predict cua_version restricted to v3|v1", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_predict",
      arguments: {
        screenshot: TINY_PNG_B64,
        instruction: "go",
        cua_version: "v99",
      },
    });
    expect(isValidationError(res)).toBe(true);
  });

  it("coasty_predict accepts cua_version=v1", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_predict",
      arguments: { screenshot: TINY_PNG_B64, instruction: "go", cua_version: "v1" },
    });
    expect(res.isError).toBeFalsy();
  });

  it("coasty_predict max_actions bounded 1..10", async () => {
    const c = await setup();
    const tooLow = await c.callTool({
      name: "coasty_predict",
      arguments: { screenshot: TINY_PNG_B64, instruction: "go", max_actions: 0 },
    });
    expect(isValidationError(tooLow)).toBe(true);
    const tooHigh = await c.callTool({
      name: "coasty_predict",
      arguments: { screenshot: TINY_PNG_B64, instruction: "go", max_actions: 11 },
    });
    expect(isValidationError(tooHigh)).toBe(true);
  });

  it("coasty_ground description max 2000 chars", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_ground",
      arguments: { screenshot: TINY_PNG_B64, description: "x".repeat(2001) },
    });
    expect(isValidationError(res)).toBe(true);
  });
});

// ─── Machine tool validation ────────────────────────────────────────────────

describe("Machine input validation", () => {
  it("coasty_provision_machine requires display_name 1..64", async () => {
    const c = await setup();
    const empty = await c.callTool({
      name: "coasty_provision_machine",
      arguments: { display_name: "" },
    });
    expect(isValidationError(empty)).toBe(true);
    const tooLong = await c.callTool({
      name: "coasty_provision_machine",
      arguments: { display_name: "x".repeat(65) },
    });
    expect(isValidationError(tooLong)).toBe(true);
  });

  it("coasty_provision_machine os_type enum", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_provision_machine",
      arguments: { display_name: "x", os_type: "macos" },
    });
    expect(isValidationError(res)).toBe(true);
  });

  it("coasty_provision_machine cpu_cores bounded 1..16", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_provision_machine",
      arguments: { display_name: "x", cpu_cores: 32 },
    });
    expect(isValidationError(res)).toBe(true);
  });

  it("coasty_provision_machine storage_gb bounded 8..500", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_provision_machine",
      arguments: { display_name: "x", storage_gb: 4 },
    });
    expect(isValidationError(res)).toBe(true);
  });

  it("idempotency_key must match [A-Za-z0-9_-:] regex", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_provision_machine",
      arguments: { display_name: "x", idempotency_key: "has space" },
    });
    expect(isValidationError(res)).toBe(true);
  });

  it("idempotency_key max length 128", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_provision_machine",
      arguments: { display_name: "x", idempotency_key: "a".repeat(129) },
    });
    expect(isValidationError(res)).toBe(true);
  });

  it("coasty_execute_machine_action command must be in allowlist", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_execute_machine_action",
      arguments: { machine_id: UUID, command: "rm_rf_root" },
    });
    expect(isValidationError(res)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("coasty_execute_machine_action accepts every allowlist command", async () => {
    const c = await setup();
    const allowList = [
      "screenshot",
      "click",
      "type",
      "key_press",
      "key_combo",
      "scroll",
      "drag",
      "browser_navigate",
      "browser_execute",
      "file_read",
      "file_write",
      "terminal_execute",
    ];
    for (const cmd of allowList) {
      const res = await c.callTool({
        name: "coasty_execute_machine_action",
        arguments: { machine_id: UUID, command: cmd, parameters: {} },
      });
      expect(res.isError, `command=${cmd} failed validation`).toBeFalsy();
    }
  });

  it("coasty_execute_machine_action timeout_ms bounded 1000..120000", async () => {
    const c = await setup();
    const res1 = await c.callTool({
      name: "coasty_execute_machine_action",
      arguments: { machine_id: UUID, command: "click", timeout_ms: 999 },
    });
    expect(isValidationError(res1)).toBe(true);
    const res2 = await c.callTool({
      name: "coasty_execute_machine_action",
      arguments: { machine_id: UUID, command: "click", timeout_ms: 200_000 },
    });
    expect(isValidationError(res2)).toBe(true);
  });

  it("coasty_run_terminal_command requires command 1..8192", async () => {
    const c = await setup();
    const empty = await c.callTool({
      name: "coasty_run_terminal_command",
      arguments: { machine_id: UUID, command: "" },
    });
    expect(isValidationError(empty)).toBe(true);
    const huge = await c.callTool({
      name: "coasty_run_terminal_command",
      arguments: { machine_id: UUID, command: "x".repeat(8193) },
    });
    expect(isValidationError(huge)).toBe(true);
  });
});

// ─── Schedule tool validation ───────────────────────────────────────────────

describe("Schedule input validation", () => {
  const baseArgs = {
    name: "n",
    machine_id: UUID,
    task_prompt: "go",
    frequency: "daily",
  };

  it("coasty_create_schedule requires name 1..128", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_create_schedule",
      arguments: { ...baseArgs, name: "" },
    });
    expect(isValidationError(res)).toBe(true);
  });

  it("coasty_create_schedule task_prompt 1..8000", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_create_schedule",
      arguments: { ...baseArgs, task_prompt: "x".repeat(8001) },
    });
    expect(isValidationError(res)).toBe(true);
  });

  it("coasty_create_schedule rejects unknown frequency", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_create_schedule",
      arguments: { ...baseArgs, frequency: "every_century" },
    });
    expect(isValidationError(res)).toBe(true);
  });

  it("coasty_create_schedule accepts every frequency preset", async () => {
    const c = await setup();
    const presets = [
      "every_15_minutes",
      "every_30_minutes",
      "hourly",
      "every_6_hours",
      "every_12_hours",
      "daily",
      "weekly",
      "monthly",
    ];
    for (const f of presets) {
      const res = await c.callTool({
        name: "coasty_create_schedule",
        arguments: { ...baseArgs, frequency: f },
      });
      expect(res.isError, `freq=${f} failed`).toBeFalsy();
    }
  });

  it("coasty_create_schedule accepts custom + cron", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_create_schedule",
      arguments: { ...baseArgs, frequency: "custom", cron: "*/5 9-17 * * 1-5" },
    });
    expect(res.isError).toBeFalsy();
  });

  it("coasty_create_schedule time must be HH:MM", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_create_schedule",
      arguments: { ...baseArgs, time: "9pm" },
    });
    expect(isValidationError(res)).toBe(true);
    const ok = await c.callTool({
      name: "coasty_create_schedule",
      arguments: { ...baseArgs, time: "09:30" },
    });
    expect(ok.isError).toBeFalsy();
  });

  it("coasty_create_schedule day_of_week 0..6", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_create_schedule",
      arguments: { ...baseArgs, frequency: "weekly", day_of_week: 7 },
    });
    expect(isValidationError(res)).toBe(true);
  });

  it("coasty_create_schedule day_of_month 1..28", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_create_schedule",
      arguments: { ...baseArgs, frequency: "monthly", day_of_month: 31 },
    });
    expect(isValidationError(res)).toBe(true);
  });

  it("coasty_create_schedule max_consecutive_failures 1..50", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_create_schedule",
      arguments: { ...baseArgs, max_consecutive_failures: 0 },
    });
    expect(isValidationError(res)).toBe(true);
  });

  it("coasty_add_trigger kind enum {webhook, email, chain}", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_add_trigger",
      arguments: { schedule_id: UUID, kind: "sms" },
    });
    expect(isValidationError(res)).toBe(true);
  });

  it("coasty_add_trigger event enum {on_complete, on_failure, on_any}", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_add_trigger",
      arguments: {
        schedule_id: UUID,
        kind: "chain",
        source_schedule_id: UUID,
        event: "on_when_i_feel_like_it",
      },
    });
    expect(isValidationError(res)).toBe(true);
  });

  it("coasty_add_trigger email_label regex enforced", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_add_trigger",
      arguments: { schedule_id: UUID, kind: "email", email_label: "BAD LABEL!" },
    });
    expect(isValidationError(res)).toBe(true);
  });

  it("coasty_add_trigger rate_limit_per_minute bounded 1..600", async () => {
    const c = await setup();
    const tooHigh = await c.callTool({
      name: "coasty_add_trigger",
      arguments: { schedule_id: UUID, kind: "webhook", rate_limit_per_minute: 1000 },
    });
    expect(isValidationError(tooHigh)).toBe(true);
  });

  it("coasty_remove_trigger trigger_id must match trg_<hex>", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_remove_trigger",
      arguments: { schedule_id: UUID, trigger_id: "not-a-trigger" },
    });
    expect(isValidationError(res)).toBe(true);
  });

  it("coasty_list_schedule_runs status enum", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_list_schedule_runs",
      arguments: { schedule_id: UUID, status: "queued" },
    });
    expect(isValidationError(res)).toBe(true);
  });
});

// ─── Account tool validation ────────────────────────────────────────────────

describe("Account input validation", () => {
  it("coasty_get_credits period must match YYYY-MM", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_get_credits",
      arguments: { period: "2026/04" },
    });
    expect(isValidationError(res)).toBe(true);
  });

  it("coasty_get_credits accepts no args", async () => {
    const c = await setup();
    const res = await c.callTool({ name: "coasty_get_credits", arguments: {} });
    expect(res.isError).toBeFalsy();
  });
});
