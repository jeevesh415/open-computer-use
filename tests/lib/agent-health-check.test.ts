/**
 * Tests for `runAgentHealthCheck` + its `MachineCleanupService` wrapper.
 *
 * Background — 2026-05-17 production incident
 * -------------------------------------------
 * An EC2 cloud VM agent died but the EC2 instance kept running. The Python
 * backend retried 7× per call (91 dial timeouts in 24 min); no alarm fired,
 * no self-healing kicked in, the user's CUA session sat broken.
 *
 * The fix:
 *   * `vm_control.py` flips a per-machine `agent_unresponsive` circuit
 *     breaker after 3 dial failures within 5 min.
 *   * `/api/internal/vm-health` lists the flagged machines.
 *   * `runAgentHealthCheck` polls that, runs SSM restart, then EC2 replace.
 *   * `MachineCleanupService.runAgentHealthCheckLocked` wraps it in the
 *     same cross-replica lock used for the existing cleanup jobs.
 *
 * These tests pin:
 *   * The lock-wrapped cron exists and calls `withCronLock("runAgentHealthCheck", 2, …)`
 *   * `runAgentHealthCheck` polls the backend with the internal key
 *   * Empty backend list → no SSM, no EC2 actions
 *   * Each unresponsive machine triggers (a) SSM RunCommand, then (b) if
 *     still unresponsive, EC2 terminate + relaunch
 *   * Recovery via SSM (cleared mid-wait) does NOT proceed to terminate
 *   * Kill switch `DISABLE_AGENT_AUTO_REPLACE=true` short-circuits
 *
 * Run: `npx vitest run tests/lib/agent-health-check.test.ts`
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// ═══════════════════════════════════════════════════════════════════════════
// Module mocks — must be declared BEFORE imports so vi can hoist
// ═══════════════════════════════════════════════════════════════════════════

// Supabase service client — chainable mock. Behaviour is controlled per-test
// by setting `supabaseMachineRows` (FIFO queue of rows to return for each
// successive `.single()` call) and the recorded update/insert lists.
let supabaseMachineRows: any[] = [];
let supabaseLookupError: any = null;
let supabaseUpdates: any[] = [];
let supabaseInserts: any[] = [];

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            const data = supabaseMachineRows.shift() ?? null;
            return { data, error: supabaseLookupError };
          },
        }),
      }),
      update: (patch: any) => {
        supabaseUpdates.push({ table, patch });
        return {
          eq: () => Promise.resolve({ error: null }),
        };
      },
      insert: (row: any) => {
        supabaseInserts.push({ table, row });
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

// EC2 service — record calls
const ec2Calls = {
  terminateInstance: vi.fn(async () => undefined),
  createInstance: vi.fn(async () => ({
    instanceId: "i-replaced-0001",
    keyPairName: "kp-fresh",
    privateKeyPem: "-----BEGIN PEM-----",
  })),
  createMachineImage: vi.fn(async () => ({
    amiId: "ami-snap-1",
    name: "snap-1",
  })),
};

vi.mock("@/lib/aws/ec2-service", () => ({
  getAwsEc2Service: () => ec2Calls,
}));

// SSM client — record SendCommand calls
const ssmSendCommandSpy = vi.fn(async () => ({ Command: { CommandId: "cmd-1" } }));
const SSMClientCtor = vi.fn(function () {
  return { send: ssmSendCommandSpy };
});

vi.mock("@aws-sdk/client-ssm", () => ({
  SSMClient: SSMClientCtor,
  SendCommandCommand: vi.fn(function (input: any) {
    return { __ssmInput: input };
  }),
}));

// Fetch — stubbed per-test
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock as any);

// ═══════════════════════════════════════════════════════════════════════════
// Test fixtures
// ═══════════════════════════════════════════════════════════════════════════

import { runAgentHealthCheck } from "@/lib/services/agent-health-check";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  // Reset mocks
  supabaseMachineRows = [];
  supabaseLookupError = null;
  supabaseUpdates = [];
  supabaseInserts = [];
  ec2Calls.terminateInstance.mockClear();
  ec2Calls.createInstance.mockClear();
  ec2Calls.createMachineImage.mockClear();
  ssmSendCommandSpy.mockClear();
  SSMClientCtor.mockClear();
  fetchMock.mockReset();

  // Default env
  process.env.INTERNAL_API_KEY = "test-internal-key";
  process.env.PYTHON_BACKEND_URL = "http://localhost:8001";
  process.env.AWS_REGION = "us-east-1";
  process.env.AWS_ACCESS_KEY_ID = "AKIA-TEST";
  process.env.AWS_SECRET_ACCESS_KEY = "secret-test";
  delete process.env.DISABLE_AGENT_AUTO_REPLACE;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

/** Helper: queue a sequence of /vm-health responses. */
function mockVmHealthResponses(...payloads: any[]) {
  payloads.forEach((p) => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => p,
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Kill switch
// ═══════════════════════════════════════════════════════════════════════════

describe("kill switch", () => {
  it("DISABLE_AGENT_AUTO_REPLACE=true short-circuits before backend poll", async () => {
    process.env.DISABLE_AGENT_AUTO_REPLACE = "true";
    const stats = await runAgentHealthCheck();
    expect(stats.polled).toBe(0);
    expect(stats.ssmRestarted).toBe(0);
    expect(stats.ec2Replaced).toBe(0);
    expect(stats.errors).toBe(0);
    // The kill switch is the FIRST thing checked — no fetch call.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("missing INTERNAL_API_KEY skips the cycle (returns clean stats)", async () => {
    delete process.env.INTERNAL_API_KEY;
    const stats = await runAgentHealthCheck();
    expect(stats.polled).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Poll → empty list → no action
// ═══════════════════════════════════════════════════════════════════════════

describe("polling", () => {
  it("polls /api/internal/vm-health with the internal key", async () => {
    mockVmHealthResponses({ unresponsive_machines: [] });
    await runAgentHealthCheck();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8001/api/internal/vm-health");
    expect(init.method).toBe("GET");
    expect(init.headers["X-Internal-Key"]).toBe("test-internal-key");
  });

  it("empty unresponsive list = no SSM, no EC2 actions", async () => {
    mockVmHealthResponses({ unresponsive_machines: [] });

    const stats = await runAgentHealthCheck();
    expect(stats.polled).toBe(0);
    expect(ssmSendCommandSpy).not.toHaveBeenCalled();
    expect(ec2Calls.terminateInstance).not.toHaveBeenCalled();
    expect(ec2Calls.createInstance).not.toHaveBeenCalled();
  });

  it("backend 5xx is caught and counted as an error (no throw)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: async () => ({}),
    });
    const stats = await runAgentHealthCheck();
    expect(stats.errors).toBe(1);
    expect(stats.polled).toBe(0);
  });

  it("backend 200 with error field is caught", async () => {
    mockVmHealthResponses({
      unresponsive_machines: [],
      error: "tracemalloc-broken",
    });
    const stats = await runAgentHealthCheck();
    expect(stats.errors).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Skip conditions — non-AWS / no instance / wrong status
// ═══════════════════════════════════════════════════════════════════════════

describe("skip conditions", () => {
  it("skips electron / local provider", async () => {
    mockVmHealthResponses({
      unresponsive_machines: [{ machine_id: "m-electron", age_seconds: 90 }],
    });
    supabaseMachineRows.push({
      id: "m-electron",
      user_id: "u1",
      display_name: "User's laptop",
      status: "running",
      settings: { provider: "electron" },
    });

    const stats = await runAgentHealthCheck();
    expect(stats.skipped).toBe(1);
    expect(ssmSendCommandSpy).not.toHaveBeenCalled();
    expect(ec2Calls.terminateInstance).not.toHaveBeenCalled();
  });

  it("skips machines with no awsInstanceId", async () => {
    mockVmHealthResponses({
      unresponsive_machines: [{ machine_id: "m-no-inst", age_seconds: 90 }],
    });
    supabaseMachineRows.push({
      id: "m-no-inst",
      user_id: "u1",
      display_name: "broken",
      status: "running",
      settings: { provider: "aws" }, // no awsInstanceId!
    });

    const stats = await runAgentHealthCheck();
    expect(stats.skipped).toBe(1);
    expect(ssmSendCommandSpy).not.toHaveBeenCalled();
  });

  it("skips machines already in 'deleting' / 'error' / 'stopped'", async () => {
    mockVmHealthResponses({
      unresponsive_machines: [
        { machine_id: "m1", age_seconds: 90 },
        { machine_id: "m2", age_seconds: 90 },
        { machine_id: "m3", age_seconds: 90 },
      ],
    });
    // Queue one row per lookup — FIFO.
    supabaseMachineRows.push(
      { id: "m1", user_id: "u", display_name: "x", status: "deleting", settings: { provider: "aws", awsInstanceId: "i-1" } },
      { id: "m2", user_id: "u", display_name: "x", status: "error", settings: { provider: "aws", awsInstanceId: "i-2" } },
      { id: "m3", user_id: "u", display_name: "x", status: "stopped", settings: { provider: "aws", awsInstanceId: "i-3" } }
    );

    const stats = await runAgentHealthCheck();
    expect(stats.skipped).toBe(3);
    expect(ssmSendCommandSpy).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Recovery — SSM restart path
// ═══════════════════════════════════════════════════════════════════════════

describe("recovery via SSM restart", () => {
  beforeEach(() => {
    supabaseMachineRows.push({
      id: "m-broken",
      user_id: "user-1",
      display_name: "My machine",
      status: "running",
      settings: {
        provider: "aws",
        awsInstanceId: "i-0123456789abcdef0",
        awsKeyPairName: "kp-coasty-test",
        instanceType: "t4g.small",
        amiId: "ami-test",
        storageGb: 16,
      },
    });
  });

  it("issues SSM RunCommand against the instance_id", async () => {
    // Initial poll: 1 unresponsive machine.
    // First wait-poll: machine cleared (recovery succeeded).
    mockVmHealthResponses(
      { unresponsive_machines: [{ machine_id: "m-broken", age_seconds: 90 }] },
      { unresponsive_machines: [] }
    );

    // Reduce the inner wait loop's sleep so the test doesn't take 60s.
    // We hack this via faking setTimeout via vi's fake timers; but since
    // the wait loop is `await sleep(checkEveryMs)` with real setTimeout,
    // we use fakeTimers for predictability.
    vi.useFakeTimers();
    const promise = runAgentHealthCheck();
    // Advance through the wait: first checkEveryMs (5_000ms).
    await vi.advanceTimersByTimeAsync(5_000);
    const stats = await promise;
    vi.useRealTimers();

    // SSM was hit with the right instance id.
    expect(SSMClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({ region: "us-east-1" })
    );
    expect(ssmSendCommandSpy).toHaveBeenCalledTimes(1);
    // ssmSendCommandSpy was typed as `() => Promise<...>` (no args) so
    // mock.calls[0] is `[]`; cast through unknown to get at the recorded
    // argument. SendCommandCommand wraps its input into `{ __ssmInput }`
    // (see the mock factory at the top of this file).
    const callArgs = (ssmSendCommandSpy.mock.calls[0] as unknown) as unknown[];
    const sentInput = callArgs[0] as { __ssmInput: any };
    expect(sentInput.__ssmInput.DocumentName).toBe("AWS-RunShellScript");
    expect(sentInput.__ssmInput.InstanceIds).toEqual(["i-0123456789abcdef0"]);
    expect(sentInput.__ssmInput.Parameters.commands.join(" ")).toContain(
      "systemctl restart ai-agent.service"
    );

    // Stats reflect the SSM-only recovery.
    expect(stats.ssmRestarted).toBe(1);
    expect(stats.ec2Replaced).toBe(0);

    // EC2 lifecycle was NOT triggered (the SSM step succeeded).
    expect(ec2Calls.terminateInstance).not.toHaveBeenCalled();
    expect(ec2Calls.createInstance).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Recovery — EC2 replace fallback
// ═══════════════════════════════════════════════════════════════════════════

describe("recovery via EC2 replace", () => {
  it("if SSM restart doesn't clear the flag, terminates + relaunches", async () => {
    supabaseMachineRows.push({
      id: "m-broken",
      user_id: "user-1",
      display_name: "My machine",
      status: "running",
      settings: {
        provider: "aws",
        awsInstanceId: "i-original",
        awsKeyPairName: "kp-orig",
        instanceType: "t4g.small",
        amiId: "ami-test",
        storageGb: 16,
        desktopEnabled: true,
        vncPassword: "secret",
      },
    });

    // Initial poll = 1 broken. ALL subsequent polls during the wait window
    // also return the same broken machine → SSM step is judged to have
    // failed, EC2 replace fires.
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        unresponsive_machines: [{ machine_id: "m-broken", age_seconds: 200 }],
      }),
    });

    vi.useFakeTimers();
    const promise = runAgentHealthCheck();
    // Run the entire wait window (60s) in 5s increments.
    for (let i = 0; i < 12; i++) {
      await vi.advanceTimersByTimeAsync(5_000);
    }
    const stats = await promise;
    vi.useRealTimers();

    // SSM was called once.
    expect(ssmSendCommandSpy).toHaveBeenCalledTimes(1);

    // Then EC2 lifecycle was triggered.
    expect(ec2Calls.createMachineImage).toHaveBeenCalledWith(
      "i-original",
      "user-1",
      "My machine"
    );
    expect(ec2Calls.terminateInstance).toHaveBeenCalledWith(
      "i-original",
      "kp-orig"
    );
    expect(ec2Calls.createInstance).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        name: "My machine",
        instanceType: "t4g.small",
        amiId: "ami-test",
        storageGb: 16,
        desktopEnabled: true,
        vncPassword: "secret",
      })
    );

    // Stats reflect the EC2 replace.
    expect(stats.ec2Replaced).toBe(1);
    expect(stats.ssmRestarted).toBe(0);

    // Supabase: machine row got updated with the new instance id.
    const updates = supabaseUpdates.filter((u) => u.table === "user_machines");
    expect(updates.length).toBeGreaterThan(0);
    const settingsPatch = updates[updates.length - 1].patch.settings;
    expect(settingsPatch.awsInstanceId).toBe("i-replaced-0001");
    expect(settingsPatch.awsKeyPairName).toBe("kp-fresh");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Source-level guards — wrappers exist + use the right lock contract
// ═══════════════════════════════════════════════════════════════════════════

describe("source-level guards", () => {
  it("MachineCleanupService wires runAgentHealthCheckLocked into start()", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "..", "lib", "services", "machine-cleanup.ts"),
      "utf-8"
    );

    // The wrapper method exists.
    expect(src).toMatch(/private async runAgentHealthCheckLocked/);
    // It uses withCronLock with the right job name + a 2-minute bucket.
    expect(src).toMatch(/withCronLock\(\s*"runAgentHealthCheck"/);
    expect(src).toMatch(/AGENT_HEALTH_CHECK_BUCKET_MINUTES\s*=\s*2/);
    // start() schedules it on a 2-minute setInterval.
    expect(src).toMatch(/this\.runAgentHealthCheckLocked\(\)/);
    expect(src).toMatch(/setInterval\([^,]+,\s*2\s*\*\s*60\s*\*\s*1000\)/);
  });

  it("agent-health-check imports SSM SDK + EC2 service lazily", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "..", "lib", "services", "agent-health-check.ts"),
      "utf-8"
    );

    // SSM + EC2 imports must be dynamic (await import). Static imports would
    // pull these into every route that touches machine-cleanup, bloating
    // bundles unrelated to this code path.
    expect(src).toMatch(/await import\("@aws-sdk\/client-ssm"\)/);
    expect(src).toMatch(/await import\("@\/lib\/aws\/ec2-service"\)/);

    // Kill switch is named `DISABLE_AGENT_AUTO_REPLACE` — pin so we don't
    // silently rename and break the runbook.
    expect(src).toMatch(/DISABLE_AGENT_AUTO_REPLACE/);
  });
});
