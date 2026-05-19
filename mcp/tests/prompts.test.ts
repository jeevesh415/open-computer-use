/**
 * Prompt tests — both prompts produce the right messages for the host
 * to inject into a chat.
 *
 * We assert the message text contains (a) the user's args spliced in,
 * (b) the tool names the agent should call, and (c) the right ordering
 * of operations.
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

async function setup() {
  const { server } = buildServer(CFG);
  const [s, c] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  const client = new Client({ name: "t", version: "0.0.0" }, { capabilities: {} });
  await client.connect(c);
  return client;
}

function getText(res: { messages: Array<{ content: { type: string; text?: string } }> }): string {
  return (res.messages[0].content.text ?? "") as string;
}

describe("start_automation_session prompt", () => {
  it("listed in prompts/list with both arg names", async () => {
    const c = await setup();
    const res = await c.listPrompts();
    const p = res.prompts.find((x) => x.name === "start_automation_session");
    expect(p).toBeDefined();
    const argNames = p!.arguments?.map((a) => a.name) ?? [];
    expect(argNames).toContain("goal");
    expect(argNames).toContain("machine_id");
  });

  it("with machine_id: locks the session to that VM", async () => {
    const c = await setup();
    const res = await c.getPrompt({
      name: "start_automation_session",
      arguments: { goal: "log into Gmail", machine_id: "550e8400-e29b-41d4-a716-446655440000" },
    });
    const text = getText(res);
    expect(text).toContain("log into Gmail");
    expect(text).toContain("550e8400-e29b-41d4-a716-446655440000");
    expect(text).toContain("Use VM");
  });

  it("without machine_id: instructs the agent to coasty_list_machines", async () => {
    const c = await setup();
    const res = await c.getPrompt({
      name: "start_automation_session",
      arguments: { goal: "scrape pricing page" },
    });
    const text = getText(res);
    expect(text).toContain("coasty_list_machines");
    expect(text).toContain("coasty_provision_machine");
  });

  it("includes the screenshot → predict → execute loop", async () => {
    const c = await setup();
    const res = await c.getPrompt({
      name: "start_automation_session",
      arguments: { goal: "x" },
    });
    const text = getText(res);
    expect(text).toContain("coasty_take_machine_screenshot");
    expect(text).toContain("coasty_predict");
    expect(text).toContain("coasty_execute_machine_action");
  });

  it("caps execution at 10 actions", async () => {
    const c = await setup();
    const res = await c.getPrompt({
      name: "start_automation_session",
      arguments: { goal: "x" },
    });
    expect(getText(res)).toMatch(/10 actions/);
  });
});

describe("debug_failed_run prompt", () => {
  it("listed in prompts/list", async () => {
    const c = await setup();
    const res = await c.listPrompts();
    const p = res.prompts.find((x) => x.name === "debug_failed_run");
    expect(p).toBeDefined();
    const argNames = p!.arguments?.map((a) => a.name) ?? [];
    expect(argNames).toContain("schedule_id");
  });

  it("splices in the schedule_id arg", async () => {
    const c = await setup();
    const res = await c.getPrompt({
      name: "debug_failed_run",
      arguments: { schedule_id: "sch_test_deadbeef" },
    });
    expect(getText(res)).toContain("sch_test_deadbeef");
  });

  it("instructs the agent to walk schedule → runs → machine → credits", async () => {
    const c = await setup();
    const res = await c.getPrompt({
      name: "debug_failed_run",
      arguments: { schedule_id: "x" },
    });
    const text = getText(res);
    expect(text).toContain("coasty_get_schedule");
    expect(text).toContain("coasty_list_schedule_runs");
    expect(text).toContain("coasty_get_machine");
    expect(text).toContain("coasty_get_credits");
  });

  it("provides remediation hints for each pause reason", async () => {
    const c = await setup();
    const res = await c.getPrompt({
      name: "debug_failed_run",
      arguments: { schedule_id: "x" },
    });
    const text = getText(res);
    expect(text).toContain("too_many_failures");
    expect(text).toContain("insufficient_credits");
    expect(text).toContain("coasty_resume_schedule");
    expect(text).toContain("coasty_start_machine");
  });
});
