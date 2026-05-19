/**
 * Edge-case + adversarial-input tests.
 *
 * The MCP host can pass anything the LLM cooks up — including unicode,
 * null bytes, very long strings, and surprising types. This file exercises
 * those boundaries so we know the server fails gracefully (clean error,
 * never a crash).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CoastyClient } from "../src/client.js";
import { buildServer } from "../src/server.js";
import type { Config } from "../src/config.js";

const CFG: Config = {
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
  // Fresh Response per call — see tools-routing.test.ts for the rationale.
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

function lastBody(): Record<string, unknown> {
  const init = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1]![1] as RequestInit;
  return JSON.parse(String(init.body));
}

describe("Unicode and special characters", () => {
  it("forwards multi-byte unicode in instructions", async () => {
    const c = await setup();
    const phrase = "点击搜索栏 🔍 αβγ";
    await c.callTool({
      name: "coasty_predict",
      arguments: { screenshot: TINY_PNG_B64, instruction: phrase },
    });
    expect(lastBody().instruction).toBe(phrase);
  });

  it("forwards emojis in schedule names", async () => {
    const c = await setup();
    await c.callTool({
      name: "coasty_create_schedule",
      arguments: {
        name: "🌅 morning briefing 🚀",
        machine_id: UUID,
        task_prompt: "go",
        frequency: "daily",
      },
    });
    expect(lastBody().name).toBe("🌅 morning briefing 🚀");
  });

  it("preserves quotes/backslashes/newlines in task_prompt", async () => {
    const c = await setup();
    const tricky = `Use "double quotes" and 'single quotes'.\nAlso \\backslashes\\.`;
    await c.callTool({
      name: "coasty_create_schedule",
      arguments: {
        name: "n",
        machine_id: UUID,
        task_prompt: tricky,
        frequency: "daily",
      },
    });
    expect(lastBody().task_prompt).toBe(tricky);
  });

  it("handles RTL text in name", async () => {
    const c = await setup();
    await c.callTool({
      name: "coasty_create_schedule",
      arguments: {
        name: "العربية مهمة يومية",
        machine_id: UUID,
        task_prompt: "go",
        frequency: "daily",
      },
    });
    expect(lastBody().name).toBe("العربية مهمة يومية");
  });
});

describe("Boundary values", () => {
  it("max-length task_prompt (8000 chars) accepted", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_create_schedule",
      arguments: {
        name: "n",
        machine_id: UUID,
        task_prompt: "x".repeat(8000),
        frequency: "daily",
      },
    });
    expect(res.isError).toBeFalsy();
  });

  it("max-length terminal command (8192 chars) accepted", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_run_terminal_command",
      arguments: { machine_id: UUID, command: "echo " + "a".repeat(8186) },
    });
    expect(res.isError).toBeFalsy();
  });

  it("min-length name (1 char) accepted", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_create_schedule",
      arguments: { name: "x", machine_id: UUID, task_prompt: "go", frequency: "daily" },
    });
    expect(res.isError).toBeFalsy();
  });

  it("limit=1 (lowest valid) accepted on list endpoints", async () => {
    const c = await setup();
    await c.callTool({ name: "coasty_list_machines", arguments: { limit: 1 } });
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("limit=200 (highest valid) accepted on list endpoints", async () => {
    const c = await setup();
    await c.callTool({ name: "coasty_list_machines", arguments: { limit: 200 } });
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("timeout_ms=1000 (lowest valid) accepted", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_execute_machine_action",
      arguments: { machine_id: UUID, command: "click", timeout_ms: 1000 },
    });
    expect(res.isError).toBeFalsy();
  });

  it("timeout_ms=120000 (highest valid) accepted", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_execute_machine_action",
      arguments: { machine_id: UUID, command: "click", timeout_ms: 120_000 },
    });
    expect(res.isError).toBeFalsy();
  });
});

describe("Network failure modes", () => {
  it("non-2xx with non-JSON body still produces a clean error", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("<html>500 Internal Server Error</html>", {
        status: 500,
        headers: { "content-type": "text/html" },
      }),
    );
    const c = await setup();
    const res = await c.callTool({ name: "coasty_list_machines", arguments: {} });
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("500");
    // Falls back to HTTP_500 code when no error envelope in the body.
    expect(text).toContain("HTTP_500");
  });

  it("DNS failure produces TransportError → isError=true", async () => {
    fetchSpy.mockRejectedValueOnce(
      Object.assign(new Error("getaddrinfo ENOTFOUND coasty.ai"), { code: "ENOTFOUND" }),
    );
    const c = await setup();
    const res = await c.callTool({ name: "coasty_list_machines", arguments: {} });
    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text: string }>)[0].text).toMatch(/failed|ENOTFOUND/i);
  });

  it("aborted/timeout fetch produces clean text, no stack trace", async () => {
    fetchSpy.mockImplementationOnce((_url, init) => {
      const sig = (init as RequestInit).signal as AbortSignal;
      return new Promise((_, reject) => {
        sig.addEventListener("abort", () => {
          const err = new Error("aborted") as Error & { name: string };
          err.name = "AbortError";
          reject(err);
        });
        // Simulate hang.
        setTimeout(() => undefined, 60_000);
      });
    });
    const cfg: Config = { ...CFG, timeoutMs: 50 };
    const { server } = buildServer(cfg);
    const [s, cc] = InMemoryTransport.createLinkedPair();
    await server.connect(s);
    const c = new Client({ name: "t", version: "0.0.0" }, { capabilities: {} });
    await c.connect(cc);
    const res = await c.callTool({ name: "coasty_list_machines", arguments: {} });
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ text: string }>)[0].text;
    expect(text).toMatch(/timed out/i);
    expect(text).not.toContain("Error:"); // not a raw stack trace
  });

  it("malformed JSON in 2xx response is still parsed gracefully", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("not-json{", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const c = await setup();
    const res = await c.callTool({ name: "coasty_list_machines", arguments: {} });
    // We don't error on bad JSON in 2xx — we just pass through { raw: ... }
    // (matches the client's code path). What matters is no crash.
    expect(res).toBeDefined();
  });
});

describe("Header sanitization", () => {
  it("never leaks the API key in debug logs", async () => {
    const cfg: Config = { ...CFG, debug: true };
    // The client uses console.error (which writes to stderr); spy on the
    // method, not the underlying stream.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = new CoastyClient(cfg);
    fetchSpy.mockResolvedValueOnce(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    await client.get("/v1/machines");
    const allLogs = errSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(allLogs).not.toContain(cfg.apiKey);
    expect(allLogs).toContain("[redacted]");
    errSpy.mockRestore();
  });

  it("X-Coasty-Source header is set to 'mcp' for telemetry attribution", async () => {
    const c = await setup();
    await c.callTool({ name: "coasty_list_machines", arguments: {} });
    const headers = (fetchSpy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers["X-Coasty-Source"]).toBe("mcp");
  });
});

describe("Coasty error → hint roundtrip", () => {
  it("402 INSUFFICIENT_CREDITS surfaces the sandbox tip in the error text", async () => {
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
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_provision_machine",
      arguments: { display_name: "x" },
    });
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ text: string }>)[0].text;
    expect(text).toMatch(/sk-coasty-test-/);
  });

  it("404 NOT_FOUND on cross-tenant access surfaces the policy explanation", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "NOT_FOUND",
            message: "Machine not found.",
            type: "not_found_error",
            request_id: "req_idor",
          },
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      ),
    );
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_get_machine",
      arguments: { machine_id: UUID },
    });
    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text: string }>)[0].text).toMatch(/404 \(not 403\)/);
  });

  it("422 with hint nudges the LLM to drop typos", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "VALIDATION_ERROR",
            message: "Unknown field 'foo'",
            type: "validation_error",
            request_id: "req_typo",
          },
        }),
        { status: 422, headers: { "content-type": "application/json" } },
      ),
    );
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_create_schedule",
      arguments: {
        name: "x",
        machine_id: UUID,
        task_prompt: "go",
        frequency: "daily",
      },
    });
    expect((res.content as Array<{ text: string }>)[0].text).toMatch(/unknown fields/i);
  });
});

describe("Idempotency-Key formatting", () => {
  it("uppercase hex keys accepted", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_provision_machine",
      arguments: { display_name: "x", idempotency_key: "ABCDEF1234567890" },
    });
    expect(res.isError).toBeFalsy();
  });

  it("UUID-shaped keys accepted", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_provision_machine",
      arguments: {
        display_name: "x",
        idempotency_key: "550e8400-e29b-41d4-a716-446655440000",
      },
    });
    expect(res.isError).toBeFalsy();
  });

  it("colon-separated keys accepted", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_create_schedule",
      arguments: {
        name: "x",
        machine_id: UUID,
        task_prompt: "go",
        frequency: "daily",
        idempotency_key: "schedule:2026-04:001",
      },
    });
    expect(res.isError).toBeFalsy();
  });

  it("keys with slashes rejected", async () => {
    const c = await setup();
    const res = await c.callTool({
      name: "coasty_provision_machine",
      arguments: { display_name: "x", idempotency_key: "with/slash" },
    });
    expect(res.isError).toBe(true);
  });
});
