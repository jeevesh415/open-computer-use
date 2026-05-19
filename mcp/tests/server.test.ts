/**
 * End-to-end MCP server tests via the SDK's in-process transports.
 *
 * Spins up the real McpServer + a real Client connected by an in-memory pair
 * of duplex streams, then exercises tools/list, prompts/list, and a few
 * representative tools/call requests. fetch() is mocked so no real HTTP
 * traffic happens.
 *
 * What this catches that unit tests don't:
 *   * Tool registration vs naming drift (e.g. handler signature mismatches)
 *   * Schema validation issues at the SDK boundary
 *   * Annotation propagation
 *   * Missing tools (the test asserts every expected tool is present)
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

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

async function setup() {
  const { server } = buildServer(CFG);
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client(
    { name: "test-client", version: "0.0.0" },
    { capabilities: {} },
  );
  await client.connect(clientTransport);

  return { server, client };
}

describe("MCP server", () => {
  it("lists every expected tool", async () => {
    const { client } = await setup();
    const res = await client.listTools();
    const names = new Set(res.tools.map((t) => t.name));
    const expected = [
      // Predict
      "coasty_predict",
      "coasty_ground",
      "coasty_ocr",
      "coasty_parse",
      // Machines
      "coasty_list_machines",
      "coasty_get_machine",
      "coasty_take_machine_screenshot",
      "coasty_provision_machine",
      "coasty_terminate_machine",
      "coasty_start_machine",
      "coasty_stop_machine",
      "coasty_execute_machine_action",
      "coasty_run_terminal_command",
      // Schedules
      "coasty_list_schedules",
      "coasty_get_schedule",
      "coasty_list_schedule_runs",
      "coasty_create_schedule",
      "coasty_update_schedule",
      "coasty_delete_schedule",
      "coasty_run_schedule_now",
      "coasty_pause_schedule",
      "coasty_resume_schedule",
      "coasty_add_trigger",
      "coasty_remove_trigger",
      // Account
      "coasty_get_credits",
      // Discovery
      "coasty_get_pricing",
      "coasty_get_capabilities",
    ];
    for (const name of expected) {
      expect(names.has(name), `missing tool: ${name}`).toBe(true);
    }
  });

  it("lists prompts", async () => {
    const { client } = await setup();
    const res = await client.listPrompts();
    const names = new Set(res.prompts.map((p) => p.name));
    expect(names.has("start_automation_session")).toBe(true);
    expect(names.has("debug_failed_run")).toBe(true);
  });

  it("every tool has a self-contained JSON schema (no external $ref)", async () => {
    const { client } = await setup();
    const res = await client.listTools();
    for (const tool of res.tools) {
      const schemaJson = JSON.stringify(tool.inputSchema);
      // Internal $defs/$ref are fine; absolute or relative URL-shaped refs aren't.
      const matches = schemaJson.match(/"\$ref":"([^"]+)"/g) ?? [];
      for (const m of matches) {
        const ref = m.match(/"\$ref":"([^"]+)"/)![1]!;
        expect(ref.startsWith("#"), `tool ${tool.name} has external $ref ${ref}`).toBe(true);
      }
    }
  });

  it("read-only tools advertise readOnlyHint=true", async () => {
    const { client } = await setup();
    const res = await client.listTools();
    const readOnlyTools = [
      "coasty_predict",
      "coasty_ground",
      "coasty_ocr",
      "coasty_parse",
      "coasty_list_machines",
      "coasty_get_machine",
      "coasty_take_machine_screenshot",
      "coasty_list_schedules",
      "coasty_get_schedule",
      "coasty_list_schedule_runs",
      "coasty_get_credits",
      "coasty_get_pricing",
      "coasty_get_capabilities",
    ];
    for (const name of readOnlyTools) {
      const t = res.tools.find((x) => x.name === name);
      expect(t, `missing tool ${name}`).toBeDefined();
      expect(t!.annotations?.readOnlyHint, `${name} should be readOnly`).toBe(true);
    }
  });

  it("destructive tools advertise destructiveHint=true", async () => {
    const { client } = await setup();
    const res = await client.listTools();
    const destructive = ["coasty_terminate_machine", "coasty_delete_schedule", "coasty_remove_trigger"];
    for (const name of destructive) {
      const t = res.tools.find((x) => x.name === name);
      expect(t!.annotations?.destructiveHint, `${name} should be destructive`).toBe(true);
    }
  });

  it("calls coasty_list_machines and forwards to GET /v1/machines", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: "mch_test_aaaa", display_name: "x" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const { client } = await setup();
    const res = await client.callTool({
      name: "coasty_list_machines",
      arguments: { limit: 10 },
    });
    expect(res.isError).toBeFalsy();
    const url = String(fetchSpy.mock.calls[0]![0]);
    expect(url).toContain("/v1/machines");
    expect(url).toContain("limit=10");
  });

  it("returns isError:true with helpful hint on 402", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "INSUFFICIENT_CREDITS",
            message: "Need 20 credits",
            type: "billing_error",
            request_id: "req_abc",
          },
        }),
        { status: 402, headers: { "content-type": "application/json" } },
      ),
    );
    const { client } = await setup();
    const res = await client.callTool({
      name: "coasty_provision_machine",
      arguments: { display_name: "x" },
    });
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("INSUFFICIENT_CREDITS");
    expect(text).toContain("req_abc");
    expect(text).toContain("Hint:");
  });

  it("returns isError:true with self-correction hint on 422 (validation)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "VALIDATION_ERROR",
            message: "Unknown field 'foo'",
            type: "validation_error",
          },
        }),
        { status: 422, headers: { "content-type": "application/json" } },
      ),
    );
    const { client } = await setup();
    const res = await client.callTool({
      name: "coasty_create_schedule",
      arguments: {
        name: "x",
        machine_id: "550e8400-e29b-41d4-a716-446655440000",
        task_prompt: "go",
        frequency: "daily",
      },
    });
    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text: string }>)[0].text).toContain("Coasty rejects unknown fields");
  });

  it("rejects malformed args at the schema layer (no API call)", async () => {
    const { client } = await setup();
    // Missing required `command` field. The SDK's input-validation layer
    // returns isError:true with a Zod validation message — the spec
    // discourages throwing for tool failures so the LLM can self-correct.
    const res = await client.callTool({
      name: "coasty_execute_machine_action",
      arguments: {
        machine_id: "mch_test_aaaa",
        // missing required `command` field
      },
    });
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ text: string }>)[0].text;
    expect(text).toMatch(/validation|invalid|required/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("validates the cron field-count guard on the create_schedule tool", async () => {
    const { client } = await setup();
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ id: "x" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    // valid: 5-field cron with frequency='custom'
    await client.callTool({
      name: "coasty_create_schedule",
      arguments: {
        name: "n",
        machine_id: "550e8400-e29b-41d4-a716-446655440000",
        task_prompt: "go",
        frequency: "custom",
        cron: "0 9 * * *",
      },
    });
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("forwards Idempotency-Key header for run_schedule_now", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ schedule_id: "x", run_id: "r", status: "queued" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const { client } = await setup();
    await client.callTool({
      name: "coasty_run_schedule_now",
      arguments: {
        schedule_id: "550e8400-e29b-41d4-a716-446655440000",
        idempotency_key: "run-twice-safely",
      },
    });
    const headers = (fetchSpy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("run-twice-safely");
  });
});
