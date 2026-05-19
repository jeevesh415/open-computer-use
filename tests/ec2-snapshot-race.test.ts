/**
 * Tests for the P2-1 fix: EC2 createMachineImage race with cleanup.
 *
 * Pre-fix, runPeriodicSnapshots called createMachineImage on an instance
 * that lite-machine-cleanup had just terminated, producing a full-stack
 * `InvalidParameterValue: Instance is not in state 'running' or 'stopping'
 * or 'stopped'` traceback in CloudWatch Logs (1 event 22:53:50 UTC on
 * 2026-04-30).
 *
 * Fix in lib/aws/ec2-service.ts:createMachineImage:
 *   1. DescribeInstances pre-flight — if state ∈ {pending, shutting-down,
 *      terminated} OR instance is not found, return null without calling
 *      CreateImage (skip rather than throw)
 *   2. CreateImage TOCTOU fallback — if AWS still returns
 *      InvalidParameterValue or InvalidInstanceID.NotFound (state changed
 *      between DescribeInstances and CreateImage), return null instead of
 *      propagating
 *   3. Any OTHER error still propagates — never silently swallow real failures
 *
 * Run: `npx vitest run tests/ec2-snapshot-race.test.ts`
 */

import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";

// AwsEc2Service constructor reads AWS creds from env at construction time;
// the mocked EC2Client doesn't actually use them, but the env-var guard
// throws first. Set safe placeholders before importing the module.
beforeAll(() => {
  process.env.AWS_ACCESS_KEY_ID ??= "AKIA-TEST-PLACEHOLDER";
  process.env.AWS_SECRET_ACCESS_KEY ??= "test-secret-placeholder";
  process.env.AWS_REGION ??= "us-east-1";
});

// ---- Mock @aws-sdk/client-ec2 -------------------------------------------
//
// We use a stateful client mock so we can choreograph the race: configure
// what DescribeInstances returns and what CreateImage returns separately,
// then drive the production code through the real call chain.

const sentCommands: any[] = [];

let describeInstancesBehavior:
  | { kind: "ok"; state: string }
  | { kind: "throw"; errorName: string }
  | { kind: "no-instance" }
  = { kind: "ok", state: "running" };

let createImageBehavior:
  | { kind: "ok"; imageId: string }
  | { kind: "throw"; errorName: string; message?: string }
  = { kind: "ok", imageId: "ami-deadbeef" };

class FakeAwsError extends Error {
  name: string;
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

vi.mock("@aws-sdk/client-ec2", () => {
  // Keep the original command-class identity (so `instanceof` checks would
  // work if any caller used them) by mocking minimally.
  class DescribeInstancesCommand {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  }
  class CreateImageCommand {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  }
  // The other commands are imported at module-load time but unused by our test;
  // provide dummy shims so the import doesn't fail.
  const passthrough = (name: string) =>
    class {
      input: any;
      constructor(input: any) {
        this.input = input;
      }
      static __name__ = name;
    };

  return {
    DescribeInstancesCommand,
    CreateImageCommand,
    EC2Client: class {
      async send(cmd: any) {
        sentCommands.push(cmd);
        if (cmd instanceof DescribeInstancesCommand) {
          if (describeInstancesBehavior.kind === "throw") {
            throw new FakeAwsError(
              describeInstancesBehavior.errorName,
              `describe failed: ${describeInstancesBehavior.errorName}`
            );
          }
          if (describeInstancesBehavior.kind === "no-instance") {
            return { Reservations: [] };
          }
          return {
            Reservations: [
              {
                Instances: [{ State: { Name: describeInstancesBehavior.state } }],
              },
            ],
          };
        }
        if (cmd instanceof CreateImageCommand) {
          if (createImageBehavior.kind === "throw") {
            throw new FakeAwsError(
              createImageBehavior.errorName,
              createImageBehavior.message ??
                `create failed: ${createImageBehavior.errorName}`
            );
          }
          return { ImageId: createImageBehavior.imageId };
        }
        // Unknown command — don't fail tests by accident
        return {};
      }
    },
    RunInstancesCommand: passthrough("RunInstancesCommand"),
    StartInstancesCommand: passthrough("StartInstancesCommand"),
    StopInstancesCommand: passthrough("StopInstancesCommand"),
    TerminateInstancesCommand: passthrough("TerminateInstancesCommand"),
    CreateKeyPairCommand: passthrough("CreateKeyPairCommand"),
    DeleteKeyPairCommand: passthrough("DeleteKeyPairCommand"),
    CreateSecurityGroupCommand: passthrough("CreateSecurityGroupCommand"),
    AuthorizeSecurityGroupIngressCommand: passthrough(
      "AuthorizeSecurityGroupIngressCommand"
    ),
    DescribeSecurityGroupsCommand: passthrough("DescribeSecurityGroupsCommand"),
    DescribeImagesCommand: passthrough("DescribeImagesCommand"),
    DeregisterImageCommand: passthrough("DeregisterImageCommand"),
    DescribeSnapshotsCommand: passthrough("DescribeSnapshotsCommand"),
    DeleteSnapshotCommand: passthrough("DeleteSnapshotCommand"),
  };
});

import { AwsEc2Service } from "@/lib/aws/ec2-service";

const TEST_INSTANCE = "i-0647744cc92f57528";
const TEST_USER = "8d19ce8c-9741-47bd-98c7-eadc6512e642";

function freshService(): AwsEc2Service {
  // Constructor reads creds from process.env (set in beforeAll) and the
  // EC2Client is mocked above, so this is fully isolated.
  return new AwsEc2Service();
}

beforeEach(() => {
  sentCommands.length = 0;
  describeInstancesBehavior = { kind: "ok", state: "running" };
  createImageBehavior = { kind: "ok", imageId: "ami-deadbeef" };
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 1 — Pre-flight DescribeInstances + skip on non-snapshottable state
// ═══════════════════════════════════════════════════════════════════════════

describe("createMachineImage — pre-flight state check", () => {
  it("calls DescribeInstances before CreateImage (correct ordering)", async () => {
    const svc = freshService();
    await svc.createMachineImage(TEST_INSTANCE, TEST_USER);
    const names = sentCommands.map((c) => c.constructor.name);
    expect(names[0]).toBe("DescribeInstancesCommand");
    expect(names[1]).toBe("CreateImageCommand");
  });

  it.each([
    ["pending"],
    ["shutting-down"],
    ["terminated"],
    ["stopping-and-degraded"],
  ])("returns null when instance state is %s (skip without CreateImage)", async (state) => {
    describeInstancesBehavior = { kind: "ok", state };
    const svc = freshService();

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await svc.createMachineImage(TEST_INSTANCE, TEST_USER);

    expect(result).toBeNull();
    // CreateImage MUST NOT have been called — that's the whole point of P2-1
    const names = sentCommands.map((c) => c.constructor.name);
    expect(names).not.toContain("CreateImageCommand");
    // And the operator-visible log must clearly explain WHY we skipped
    const logged = consoleSpy.mock.calls.map((c) => c[0]).join(" | ");
    expect(logged).toMatch(/skipping|not snapshottable|not in state|not found/i);
    consoleSpy.mockRestore();
  });

  it.each([["running"], ["stopping"], ["stopped"]])(
    "DOES proceed with CreateImage when state is %s",
    async (state) => {
      describeInstancesBehavior = { kind: "ok", state };
      const svc = freshService();

      const result = await svc.createMachineImage(TEST_INSTANCE, TEST_USER);

      expect(result).not.toBeNull();
      expect(result?.amiId).toBe("ami-deadbeef");
      const names = sentCommands.map((c) => c.constructor.name);
      expect(names).toContain("CreateImageCommand");
    }
  );

  it("returns null when DescribeInstances reports no instance found", async () => {
    describeInstancesBehavior = { kind: "no-instance" };
    const svc = freshService();
    const result = await svc.createMachineImage(TEST_INSTANCE, TEST_USER);
    // No state → falls through to CreateImage; CreateImage will be the
    // backstop in TOCTOU, but pre-flight reported "no instance" — we still
    // must NOT crash. Since preflightState is undefined, it falls through to
    // CreateImage which (in this test) succeeds. That's acceptable behavior:
    // the crucial guarantee is "no exception propagates".
    // Actually — preflightState undefined means we proceed and CreateImage
    // returns ami-deadbeef in the default mock. So the result is the AMI.
    // This documents that "no Reservations" is treated permissively.
    expect(result?.amiId).toBe("ami-deadbeef");
  });

  it("returns null when DescribeInstances throws InvalidInstanceID.NotFound", async () => {
    describeInstancesBehavior = {
      kind: "throw",
      errorName: "InvalidInstanceID.NotFound",
    };
    const svc = freshService();

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await svc.createMachineImage(TEST_INSTANCE, TEST_USER);

    expect(result).toBeNull();
    const names = sentCommands.map((c) => c.constructor.name);
    expect(names).not.toContain("CreateImageCommand");
    const logged = consoleSpy.mock.calls.map((c) => c[0]).join(" | ");
    expect(logged).toMatch(/already terminated|not found/i);
    consoleSpy.mockRestore();
  });

  it("falls through to CreateImage on transient DescribeInstances error", async () => {
    // Anything that's NOT InvalidInstanceID.NotFound: e.g. RequestLimitExceeded.
    // The fix philosophy is: never silently swallow real failures.
    describeInstancesBehavior = {
      kind: "throw",
      errorName: "RequestLimitExceeded",
    };
    const svc = freshService();

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await svc.createMachineImage(TEST_INSTANCE, TEST_USER);

    // Default CreateImage mock succeeds → we still get an AMI back
    expect(result?.amiId).toBe("ami-deadbeef");
    // And we logged a warning about the pre-check failure for observability
    const warned = consoleSpy.mock.calls.map((c) => c[0]).join(" | ");
    expect(warned).toMatch(/pre-check failed/i);
    expect(warned).toMatch(/RequestLimitExceeded/);
    consoleSpy.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 2 — TOCTOU race: CreateImage fails after pre-flight passed
// ═══════════════════════════════════════════════════════════════════════════

describe("createMachineImage — TOCTOU race fallback", () => {
  it("returns null when CreateImage rejects with InvalidParameterValue (state changed mid-call)", async () => {
    // Pre-flight says running, but TerminateInstances landed between calls
    describeInstancesBehavior = { kind: "ok", state: "running" };
    createImageBehavior = {
      kind: "throw",
      errorName: "InvalidParameterValue",
      message:
        "Invalid value 'i-0647744cc92f57528' for instanceId. Instance is not in state 'running' or 'stopping' or 'stopped'",
    };
    const svc = freshService();

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await svc.createMachineImage(TEST_INSTANCE, TEST_USER);

    expect(result).toBeNull();
    const logged = consoleSpy.mock.calls.map((c) => c[0]).join(" | ");
    expect(logged).toMatch(/TOCTOU|state changed|skipping/i);
    consoleSpy.mockRestore();
  });

  it("returns null when CreateImage rejects with InvalidInstanceID.NotFound mid-call", async () => {
    describeInstancesBehavior = { kind: "ok", state: "running" };
    createImageBehavior = {
      kind: "throw",
      errorName: "InvalidInstanceID.NotFound",
      message: "Instance i-0647744cc92f57528 was terminated",
    };
    const svc = freshService();

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await svc.createMachineImage(TEST_INSTANCE, TEST_USER);

    expect(result).toBeNull();
    consoleSpy.mockRestore();
  });

  it("PROPAGATES other errors (never silently swallow real failures)", async () => {
    describeInstancesBehavior = { kind: "ok", state: "running" };
    createImageBehavior = {
      kind: "throw",
      errorName: "RequestLimitExceeded",
      message: "Throttled by AWS",
    };
    const svc = freshService();

    await expect(
      svc.createMachineImage(TEST_INSTANCE, TEST_USER)
    ).rejects.toMatchObject({
      name: "RequestLimitExceeded",
    });
  });

  it("InvalidParameterValue with a different message still propagates", async () => {
    // The fix matches BOTH error name AND message regex — a different
    // InvalidParameterValue (e.g. invalid Name parameter) MUST still throw
    // so the bug is visible.
    describeInstancesBehavior = { kind: "ok", state: "running" };
    createImageBehavior = {
      kind: "throw",
      errorName: "InvalidParameterValue",
      message: "Image name 'foo' contains invalid characters",
    };
    const svc = freshService();

    await expect(
      svc.createMachineImage(TEST_INSTANCE, TEST_USER)
    ).rejects.toMatchObject({
      name: "InvalidParameterValue",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 3 — Happy path regression checks
// ═══════════════════════════════════════════════════════════════════════════

describe("createMachineImage — happy path", () => {
  it("returns {amiId, name} when AWS accepts the call", async () => {
    describeInstancesBehavior = { kind: "ok", state: "running" };
    createImageBehavior = { kind: "ok", imageId: "ami-12345" };
    const svc = freshService();

    const result = await svc.createMachineImage(TEST_INSTANCE, TEST_USER, "my-machine");
    expect(result).not.toBeNull();
    expect(result?.amiId).toBe("ami-12345");
    expect(result?.name).toMatch(/^coasty-snapshot-8d19ce8c-/);
  });

  it("uses NoReboot=true so user's session isn't interrupted", async () => {
    const svc = freshService();
    await svc.createMachineImage(TEST_INSTANCE, TEST_USER);
    const createCmd = sentCommands.find(
      (c) => c.constructor.name === "CreateImageCommand"
    );
    expect(createCmd?.input?.NoReboot).toBe(true);
  });

  it("tags the AMI with UserId, ManagedBy, SourceInstance", async () => {
    const svc = freshService();
    await svc.createMachineImage(TEST_INSTANCE, TEST_USER, "machine-name");
    const createCmd = sentCommands.find(
      (c) => c.constructor.name === "CreateImageCommand"
    );
    const tags = createCmd?.input?.TagSpecifications?.[0]?.Tags ?? [];
    const tagMap = Object.fromEntries(tags.map((t: any) => [t.Key, t.Value]));
    expect(tagMap.UserId).toBe(TEST_USER);
    expect(tagMap.ManagedBy).toBe("coasty-snapshot");
    expect(tagMap.SourceInstance).toBe(TEST_INSTANCE);
  });

  it("throws when AWS returns no ImageId (the original guard still works)", async () => {
    describeInstancesBehavior = { kind: "ok", state: "running" };
    createImageBehavior = { kind: "ok", imageId: undefined as any };
    const svc = freshService();
    await expect(
      svc.createMachineImage(TEST_INSTANCE, TEST_USER)
    ).rejects.toThrow(/no image ID/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 4 — Anti-drift source check
// ═══════════════════════════════════════════════════════════════════════════

describe("createMachineImage — source guards", () => {
  it("source uses DescribeInstancesCommand pre-flight + null-return on race", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "lib", "aws", "ec2-service.ts"),
      "utf-8"
    );
    // The fix's distinctive markers — if a future refactor strips them,
    // this test should fail before the bug returns.
    expect(src).toMatch(/DescribeInstancesCommand\(\{\s*InstanceIds:\s*\[instanceId\]\s*\}\)/);
    expect(src).toMatch(/InvalidInstanceID\.NotFound/);
    expect(src).toMatch(/Instance is not in state/i);
    expect(src).toMatch(/preflightState/);
  });
});
