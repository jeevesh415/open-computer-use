/**
 * Cross-tool annotation invariants.
 *
 * MCP annotations (readOnlyHint / destructiveHint / idempotentHint /
 * openWorldHint) are *hints*, but well-behaved hosts (Claude Desktop,
 * VS Code Copilot in Agent mode) use them to decide whether to auto-approve
 * a call or prompt the user. Inconsistent flags = bad UX. These tests
 * enforce the invariants that no tool should violate.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { buildServer } from "../src/server.js";

const CFG = {
  apiKey: "sk-coasty-test-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  baseUrl: "https://coasty.ai",
  timeoutMs: 10_000,
  userAgent: "coasty-mcp-test/0.0.0",
  debug: false,
};

async function getTools() {
  const { server } = buildServer(CFG);
  const [s, c] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  const client = new Client({ name: "t", version: "0.0.0" }, { capabilities: {} });
  await client.connect(c);
  const res = await client.listTools();
  return res.tools;
}

describe("Tool annotation invariants", () => {
  it("every tool has annotations object", async () => {
    const tools = await getTools();
    for (const t of tools) {
      expect(t.annotations, `${t.name} has no annotations`).toBeDefined();
    }
  });

  it("every tool has openWorldHint=true (we always talk to a remote API), except local-only discovery", async () => {
    const tools = await getTools();
    // The capabilities tool is intentionally local — the snapshot is hardcoded
    // in src/tools/discovery.ts and never hits the network. Every other tool
    // talks to the Coasty REST API and is therefore open-world.
    const LOCAL_ONLY = new Set(["coasty_get_capabilities"]);
    for (const t of tools) {
      if (LOCAL_ONLY.has(t.name)) {
        expect(t.annotations?.openWorldHint, `${t.name} should be local-only`).toBe(false);
      } else {
        expect(t.annotations?.openWorldHint, `${t.name} should have openWorldHint`).toBe(true);
      }
    }
  });

  it("read tools (list/get/take) have readOnlyHint=true and destructiveHint=false-ish", async () => {
    const tools = await getTools();
    const readPrefixes = ["coasty_list_", "coasty_get_", "coasty_take_"];
    const expectedReadOnly = tools.filter((t) =>
      readPrefixes.some((p) => t.name.startsWith(p)),
    );
    // 7 read tools today: list_machines, get_machine, take_machine_screenshot,
    // list_schedules, get_schedule, list_schedule_runs, get_credits.
    expect(expectedReadOnly.length).toBeGreaterThanOrEqual(7);
    for (const t of expectedReadOnly) {
      expect(t.annotations?.readOnlyHint, `${t.name} should be readOnly`).toBe(true);
      // Read tools must NOT be marked destructive.
      expect(t.annotations?.destructiveHint, `${t.name} should NOT be destructive`).not.toBe(true);
    }
  });

  it("read tools advertise idempotentHint=true (same call same answer)", async () => {
    const tools = await getTools();
    const readPrefixes = ["coasty_list_", "coasty_get_", "coasty_take_"];
    const reads = tools.filter((t) => readPrefixes.some((p) => t.name.startsWith(p)));
    for (const t of reads) {
      expect(t.annotations?.idempotentHint, `${t.name} should be idempotent`).toBe(true);
    }
  });

  it("destructive tools (terminate, delete, remove) have destructiveHint=true", async () => {
    const tools = await getTools();
    const destructiveTools = [
      "coasty_terminate_machine",
      "coasty_delete_schedule",
      "coasty_remove_trigger",
    ];
    for (const name of destructiveTools) {
      const t = tools.find((x) => x.name === name);
      expect(t, `missing destructive tool: ${name}`).toBeDefined();
      expect(t!.annotations?.destructiveHint, `${name} must be destructive`).toBe(true);
      expect(t!.annotations?.readOnlyHint, `${name} must NOT be readOnly`).not.toBe(true);
    }
  });

  it("destructive tools don't ALSO have readOnlyHint=true (mutually exclusive)", async () => {
    const tools = await getTools();
    for (const t of tools) {
      if (t.annotations?.destructiveHint === true) {
        expect(
          t.annotations?.readOnlyHint,
          `${t.name} cannot be both destructive AND readOnly`,
        ).not.toBe(true);
      }
    }
  });

  it("provision/create tools are NOT marked destructive (they create, not delete)", async () => {
    const tools = await getTools();
    const createTools = ["coasty_provision_machine", "coasty_create_schedule"];
    for (const name of createTools) {
      const t = tools.find((x) => x.name === name);
      expect(t!.annotations?.destructiveHint, `${name} should not be destructive`).not.toBe(true);
    }
  });

  it("idempotent-by-design tools advertise idempotentHint=true", async () => {
    const tools = await getTools();
    // start/stop/pause/resume/terminate are inherently idempotent: re-applying
    // the same state is a no-op. Same for delete (already-deleted = 404).
    const idempotent = [
      "coasty_start_machine",
      "coasty_stop_machine",
      "coasty_pause_schedule",
      "coasty_resume_schedule",
      "coasty_terminate_machine",
      "coasty_delete_schedule",
      "coasty_remove_trigger",
    ];
    for (const name of idempotent) {
      const t = tools.find((x) => x.name === name);
      expect(t, `missing tool: ${name}`).toBeDefined();
      expect(t!.annotations?.idempotentHint, `${name} should be idempotent`).toBe(true);
    }
  });

  it("non-idempotent tools (provision/create/run/add) advertise idempotentHint=false-ish", async () => {
    const tools = await getTools();
    // These produce side effects; without an Idempotency-Key, retries duplicate.
    const nonIdempotent = [
      "coasty_provision_machine",
      "coasty_create_schedule",
      "coasty_update_schedule",
      "coasty_run_schedule_now",
      "coasty_add_trigger",
      "coasty_execute_machine_action",
      "coasty_run_terminal_command",
    ];
    for (const name of nonIdempotent) {
      const t = tools.find((x) => x.name === name);
      expect(t, `missing tool: ${name}`).toBeDefined();
      expect(t!.annotations?.idempotentHint, `${name} should not be idempotent`).not.toBe(true);
    }
  });

  it("every tool has a non-empty title and description", async () => {
    const tools = await getTools();
    for (const t of tools) {
      expect(t.title?.length ?? 0, `${t.name} has no title`).toBeGreaterThan(0);
      expect(t.description?.length ?? 0, `${t.name} has no description`).toBeGreaterThan(20);
    }
  });

  it("descriptions stay under 4 KB (some clients truncate at 1KB; we allow extras for the kitchen-sink tools)", async () => {
    const tools = await getTools();
    for (const t of tools) {
      expect(
        (t.description?.length ?? 0) <= 4096,
        `${t.name} description is ${t.description?.length} chars (>4096)`,
      ).toBe(true);
    }
  });
});
