/**
 * Per-tool routing tests.
 *
 * Each test fires a tool with the minimum-viable arguments and asserts the
 * resulting fetch() call matches the documented contract:
 *   - HTTP method
 *   - URL path
 *   - Body keys (where applicable)
 *   - Query params (where applicable)
 *
 * Catches drift between the tool definition and the public REST API. If
 * Coasty renames /v1/predict → /v1/predict-v2, this test fails.
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
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
  // Default: every API call returns 200 + empty object. Use mockImplementation
  // so each call gets a FRESH Response (a single Response object's body is
  // consumed on first .text() read; reusing one across calls returns "" the
  // second time and the client interprets that as a missing payload).
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

function lastCall() {
  expect(fetchSpy).toHaveBeenCalled();
  const [url, init] = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1]!;
  const u = new URL(String(url));
  return {
    method: (init as RequestInit | undefined)?.method ?? "GET",
    pathname: u.pathname,
    search: u.search,
    headers: ((init as RequestInit | undefined)?.headers ?? {}) as Record<string, string>,
    body: (init as RequestInit | undefined)?.body
      ? JSON.parse(String((init as RequestInit | undefined)!.body))
      : undefined,
  };
}

// ─── Predict ────────────────────────────────────────────────────────────────

describe("Predict tool routing", () => {
  it("coasty_predict → POST /v1/predict", async () => {
    const c = await setup();
    await c.callTool({
      name: "coasty_predict",
      arguments: { screenshot: TINY_PNG_B64, instruction: "click the button" },
    });
    const r = lastCall();
    expect(r.method).toBe("POST");
    expect(r.pathname).toBe("/v1/predict");
    expect(r.body.screenshot).toBe(TINY_PNG_B64);
    expect(r.body.instruction).toBe("click the button");
  });

  it("coasty_predict strips `data:` URI prefix from screenshot", async () => {
    const c = await setup();
    await c.callTool({
      name: "coasty_predict",
      arguments: { screenshot: `data:image/png;base64,${TINY_PNG_B64}`, instruction: "go" },
    });
    expect(lastCall().body.screenshot).toBe(TINY_PNG_B64);
  });

  it("coasty_ground → POST /v1/ground with description", async () => {
    const c = await setup();
    await c.callTool({
      name: "coasty_ground",
      arguments: { screenshot: TINY_PNG_B64, description: "the blue Submit button" },
    });
    const r = lastCall();
    expect(r.method).toBe("POST");
    expect(r.pathname).toBe("/v1/ground");
    expect(r.body.description).toBe("the blue Submit button");
  });

  it("coasty_ocr → POST /v1/ocr", async () => {
    const c = await setup();
    await c.callTool({ name: "coasty_ocr", arguments: { screenshot: TINY_PNG_B64 } });
    const r = lastCall();
    expect(r.method).toBe("POST");
    expect(r.pathname).toBe("/v1/ocr");
  });

  it("coasty_parse → POST /v1/parse with code", async () => {
    const c = await setup();
    await c.callTool({
      name: "coasty_parse",
      arguments: { code: "pyautogui.click(100, 200)" },
    });
    const r = lastCall();
    expect(r.pathname).toBe("/v1/parse");
    expect(r.body.code).toBe("pyautogui.click(100, 200)");
  });
});

// ─── Machines ───────────────────────────────────────────────────────────────

describe("Machine tool routing", () => {
  it("coasty_list_machines → GET /v1/machines?limit=", async () => {
    const c = await setup();
    await c.callTool({ name: "coasty_list_machines", arguments: { limit: 25 } });
    const r = lastCall();
    expect(r.method).toBe("GET");
    expect(r.pathname).toBe("/v1/machines");
    expect(r.search).toBe("?limit=25");
  });

  it("coasty_list_machines with no limit → no query string", async () => {
    const c = await setup();
    await c.callTool({ name: "coasty_list_machines", arguments: {} });
    expect(lastCall().search).toBe("");
  });

  it("coasty_get_machine → GET /v1/machines/{id}", async () => {
    const c = await setup();
    await c.callTool({ name: "coasty_get_machine", arguments: { machine_id: UUID } });
    const r = lastCall();
    expect(r.method).toBe("GET");
    expect(r.pathname).toBe(`/v1/machines/${UUID}`);
  });

  it("coasty_take_machine_screenshot → GET /v1/machines/{id}/screenshot", async () => {
    const c = await setup();
    await c.callTool({
      name: "coasty_take_machine_screenshot",
      arguments: { machine_id: UUID },
    });
    expect(lastCall().pathname).toBe(`/v1/machines/${UUID}/screenshot`);
  });

  it("coasty_provision_machine → POST /v1/machines + Idempotency-Key passthrough", async () => {
    const c = await setup();
    await c.callTool({
      name: "coasty_provision_machine",
      arguments: {
        display_name: "demo",
        os_type: "linux",
        desktop_enabled: true,
        idempotency_key: "prov-001",
      },
    });
    const r = lastCall();
    expect(r.method).toBe("POST");
    expect(r.pathname).toBe("/v1/machines");
    expect(r.body.display_name).toBe("demo");
    expect(r.body.os_type).toBe("linux");
    expect(r.body.desktop_enabled).toBe(true);
    expect(r.headers["Idempotency-Key"]).toBe("prov-001");
  });

  it("coasty_provision_machine omits Idempotency-Key header when not supplied", async () => {
    const c = await setup();
    await c.callTool({
      name: "coasty_provision_machine",
      arguments: { display_name: "demo" },
    });
    expect(lastCall().headers["Idempotency-Key"]).toBeUndefined();
  });

  it("coasty_terminate_machine → DELETE /v1/machines/{id}", async () => {
    const c = await setup();
    await c.callTool({ name: "coasty_terminate_machine", arguments: { machine_id: UUID } });
    const r = lastCall();
    expect(r.method).toBe("DELETE");
    expect(r.pathname).toBe(`/v1/machines/${UUID}`);
  });

  it("coasty_start_machine → POST /v1/machines/{id}/start", async () => {
    const c = await setup();
    await c.callTool({ name: "coasty_start_machine", arguments: { machine_id: UUID } });
    expect(lastCall().pathname).toBe(`/v1/machines/${UUID}/start`);
  });

  it("coasty_stop_machine → POST /v1/machines/{id}/stop", async () => {
    const c = await setup();
    await c.callTool({ name: "coasty_stop_machine", arguments: { machine_id: UUID } });
    expect(lastCall().pathname).toBe(`/v1/machines/${UUID}/stop`);
  });

  it("coasty_execute_machine_action → POST /v1/machines/{id}/actions", async () => {
    const c = await setup();
    await c.callTool({
      name: "coasty_execute_machine_action",
      arguments: {
        machine_id: UUID,
        command: "click",
        parameters: { x: 50, y: 60 },
      },
    });
    const r = lastCall();
    expect(r.method).toBe("POST");
    expect(r.pathname).toBe(`/v1/machines/${UUID}/actions`);
    expect(r.body.command).toBe("click");
    expect(r.body.parameters).toEqual({ x: 50, y: 60 });
  });

  it("coasty_execute_machine_action defaults parameters to {} when omitted", async () => {
    const c = await setup();
    await c.callTool({
      name: "coasty_execute_machine_action",
      arguments: { machine_id: UUID, command: "screenshot" },
    });
    expect(lastCall().body.parameters).toEqual({});
  });

  it("coasty_run_terminal_command → POST /v1/machines/{id}/terminal with timeout default", async () => {
    const c = await setup();
    await c.callTool({
      name: "coasty_run_terminal_command",
      arguments: { machine_id: UUID, command: "ls -la /tmp" },
    });
    const r = lastCall();
    expect(r.pathname).toBe(`/v1/machines/${UUID}/terminal`);
    expect(r.body.command).toBe("ls -la /tmp");
    expect(r.body.timeout_ms).toBe(30_000);
  });
});

// ─── Schedules ──────────────────────────────────────────────────────────────

describe("Schedule tool routing", () => {
  it("coasty_list_schedules → GET /v1/schedules", async () => {
    const c = await setup();
    await c.callTool({ name: "coasty_list_schedules", arguments: {} });
    expect(lastCall().pathname).toBe("/v1/schedules");
  });

  it("coasty_get_schedule → GET /v1/schedules/{id}", async () => {
    const c = await setup();
    await c.callTool({
      name: "coasty_get_schedule",
      arguments: { schedule_id: UUID },
    });
    expect(lastCall().pathname).toBe(`/v1/schedules/${UUID}`);
  });

  it("coasty_list_schedule_runs → GET /v1/schedules/{id}/runs with cursor + status + limit", async () => {
    const c = await setup();
    await c.callTool({
      name: "coasty_list_schedule_runs",
      arguments: {
        schedule_id: UUID,
        cursor: "eyJpZCI6IjEyMyJ9",
        status: "failed",
        limit: 50,
      },
    });
    const r = lastCall();
    expect(r.pathname).toBe(`/v1/schedules/${UUID}/runs`);
    const params = new URLSearchParams(r.search);
    expect(params.get("cursor")).toBe("eyJpZCI6IjEyMyJ9");
    expect(params.get("status")).toBe("failed");
    expect(params.get("limit")).toBe("50");
  });

  it("coasty_create_schedule → POST /v1/schedules without idempotency_key in body", async () => {
    const c = await setup();
    await c.callTool({
      name: "coasty_create_schedule",
      arguments: {
        name: "n",
        machine_id: UUID,
        task_prompt: "go",
        frequency: "daily",
        time: "09:00",
        idempotency_key: "create-001",
      },
    });
    const r = lastCall();
    expect(r.method).toBe("POST");
    expect(r.pathname).toBe("/v1/schedules");
    expect(r.body.name).toBe("n");
    expect(r.body.frequency).toBe("daily");
    // The idempotency key is a HEADER, not a body field — would fail
    // server-side strict validation if we sent it in body.
    expect(r.body.idempotency_key).toBeUndefined();
    expect(r.headers["Idempotency-Key"]).toBe("create-001");
  });

  it("coasty_update_schedule → PATCH /v1/schedules/{id} with only the supplied fields", async () => {
    const c = await setup();
    await c.callTool({
      name: "coasty_update_schedule",
      arguments: {
        schedule_id: UUID,
        name: "renamed",
        enabled: false,
      },
    });
    const r = lastCall();
    expect(r.method).toBe("PATCH");
    expect(r.pathname).toBe(`/v1/schedules/${UUID}`);
    expect(r.body).toEqual({ name: "renamed", enabled: false });
    // Make sure schedule_id isn't accidentally in the body too.
    expect(r.body.schedule_id).toBeUndefined();
  });

  it("coasty_delete_schedule → DELETE /v1/schedules/{id}", async () => {
    const c = await setup();
    await c.callTool({ name: "coasty_delete_schedule", arguments: { schedule_id: UUID } });
    const r = lastCall();
    expect(r.method).toBe("DELETE");
    expect(r.pathname).toBe(`/v1/schedules/${UUID}`);
  });

  it("coasty_run_schedule_now → POST /v1/schedules/{id}/run + Idempotency-Key", async () => {
    const c = await setup();
    await c.callTool({
      name: "coasty_run_schedule_now",
      arguments: {
        schedule_id: UUID,
        task_prompt_override: "different prompt",
        idempotency_key: "run-1",
      },
    });
    const r = lastCall();
    expect(r.pathname).toBe(`/v1/schedules/${UUID}/run`);
    expect(r.body.task_prompt_override).toBe("different prompt");
    expect(r.headers["Idempotency-Key"]).toBe("run-1");
  });

  it("coasty_pause_schedule → POST /v1/schedules/{id}/pause", async () => {
    const c = await setup();
    await c.callTool({ name: "coasty_pause_schedule", arguments: { schedule_id: UUID } });
    expect(lastCall().pathname).toBe(`/v1/schedules/${UUID}/pause`);
  });

  it("coasty_resume_schedule → POST /v1/schedules/{id}/resume", async () => {
    const c = await setup();
    await c.callTool({ name: "coasty_resume_schedule", arguments: { schedule_id: UUID } });
    expect(lastCall().pathname).toBe(`/v1/schedules/${UUID}/resume`);
  });

  it("coasty_add_trigger (webhook) → POST /v1/schedules/{id}/triggers", async () => {
    const c = await setup();
    await c.callTool({
      name: "coasty_add_trigger",
      arguments: { schedule_id: UUID, kind: "webhook", rate_limit_per_minute: 100 },
    });
    const r = lastCall();
    expect(r.pathname).toBe(`/v1/schedules/${UUID}/triggers`);
    expect(r.body.kind).toBe("webhook");
    expect(r.body.rate_limit_per_minute).toBe(100);
    expect(r.body.schedule_id).toBeUndefined();
  });

  it("coasty_add_trigger (chain) forwards source_schedule_id", async () => {
    const c = await setup();
    await c.callTool({
      name: "coasty_add_trigger",
      arguments: {
        schedule_id: UUID,
        kind: "chain",
        source_schedule_id: "sch_test_aabbccdd",
        event: "on_failure",
      },
    });
    const r = lastCall();
    expect(r.body.kind).toBe("chain");
    expect(r.body.source_schedule_id).toBe("sch_test_aabbccdd");
    expect(r.body.event).toBe("on_failure");
  });

  it("coasty_remove_trigger → DELETE /v1/schedules/{id}/triggers/{tid}", async () => {
    const c = await setup();
    await c.callTool({
      name: "coasty_remove_trigger",
      arguments: { schedule_id: UUID, trigger_id: "trg_aabbccdd" },
    });
    const r = lastCall();
    expect(r.method).toBe("DELETE");
    expect(r.pathname).toBe(`/v1/schedules/${UUID}/triggers/trg_aabbccdd`);
  });
});

// ─── Account ────────────────────────────────────────────────────────────────

describe("Account tool routing", () => {
  it("coasty_get_credits → GET /v1/usage", async () => {
    const c = await setup();
    await c.callTool({ name: "coasty_get_credits", arguments: {} });
    expect(lastCall().pathname).toBe("/v1/usage");
  });

  it("coasty_get_credits forwards period query param", async () => {
    const c = await setup();
    await c.callTool({ name: "coasty_get_credits", arguments: { period: "2026-04" } });
    expect(lastCall().search).toBe("?period=2026-04");
  });
});

// ─── Discovery ──────────────────────────────────────────────────────────────

describe("Discovery tool routing", () => {
  it("coasty_get_pricing → GET /api/pricing (public, unauthenticated CDN endpoint)", async () => {
    const c = await setup();
    await c.callTool({ name: "coasty_get_pricing", arguments: {} });
    const r = lastCall();
    expect(r.method).toBe("GET");
    expect(r.pathname).toBe("/api/pricing");
  });

  it("coasty_get_capabilities does NOT make an API call (fully local)", async () => {
    const c = await setup();
    const fetchCallsBefore = fetchSpy.mock.calls.length;
    const res = await c.callTool({ name: "coasty_get_capabilities", arguments: {} });
    expect(fetchSpy.mock.calls.length).toBe(fetchCallsBefore);
    expect(res.isError).toBeFalsy();
    // Sanity check the structured payload exposes the documented shape.
    const sc = (res as { structuredContent?: Record<string, unknown> }).structuredContent;
    expect(sc).toBeDefined();
    expect(sc!.service).toBeDefined();
    expect(sc!.discovery).toBeDefined();
    expect(sc!.auth).toBeDefined();
    expect(Array.isArray(sc!.tools)).toBe(true);
    expect(sc!.limits).toBeDefined();
  });

  it("get_capabilities tool catalog includes every registered tool", async () => {
    const c = await setup();
    const list = await c.listTools();
    const registeredNames = new Set(list.tools.map((t) => t.name));

    const res = await c.callTool({ name: "coasty_get_capabilities", arguments: {} });
    const sc = (res as { structuredContent?: Record<string, unknown> }).structuredContent!;
    const cataloged = (sc.tools as Array<{ name: string }>).map((t) => t.name);

    // Every tool the server advertises must appear in the capabilities catalog —
    // otherwise the agent would discover a tool it can't read documentation for.
    for (const name of registeredNames) {
      expect(cataloged.includes(name), `catalog missing registered tool: ${name}`).toBe(true);
    }
    // And vice versa — no stale entries.
    for (const name of cataloged) {
      expect(registeredNames.has(name), `catalog has unknown tool: ${name}`).toBe(true);
    }
  });
});
