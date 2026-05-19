/**
 * Regression test: AWS RunInstances enforces a 16384-byte limit on
 * UserData IN RAW FORM (i.e., what AWS sees AFTER decoding the base64
 * we send). This is from AWS's docs: "User data is limited to 16 KB,
 * in raw form, before it is base64-encoded."
 *
 * In practice we've observed AWS reject with two distinct errors:
 *   - "User data is limited to 16384 bytes"            (the raw limit)
 *   - "Encoded User data is limited to 25600 bytes"   (a base64 limit
 *     that some endpoints/Launch Templates use instead)
 * The 16384 RAW limit is the conservative target — fits both gates.
 *
 * Both Linux and Windows generators must stay under this. Linux gets
 * script-level gzip (cloud-init auto-decompresses); Windows wraps its
 * PowerShell in a self-decompressing bootstrap. Both ALSO minify their
 * payloads (strip pure-comment lines + collapse blanks, preserving
 * heredoc/here-string bodies verbatim).
 *
 * Adding code to the embedded Python agent or PowerShell wrapper and
 * watching this test fail is much cheaper than shipping the failure to
 * AWS in production.
 *
 * Run: `npx vitest run tests/userdata-size-limit.test.ts`
 */

import { describe, it, expect, beforeAll } from "vitest";

// AWS's documented raw-size limit for UserData (after base64 decode).
const HARD_RAW_LIMIT = 16384;
// We also keep an eye on the base64-string length because some
// endpoints enforce a 25600-byte base64 limit.
const HARD_B64_LIMIT = 25600;
const SAFETY_MARGIN = 500;

beforeAll(() => {
  process.env.AWS_ACCESS_KEY_ID ??= "AKIA-TEST-PLACEHOLDER";
  process.env.AWS_SECRET_ACCESS_KEY ??= "test-secret-placeholder";
  process.env.AWS_REGION ??= "us-east-1";
});

// Mock @aws-sdk/client-ec2 — we only need the generators, not the SDK
import { vi } from "vitest";
vi.mock("@aws-sdk/client-ec2", () => {
  const passthrough = (name: string) =>
    class {
      input: any;
      constructor(input: any) {
        this.input = input;
      }
      static __name__ = name;
    };
  return {
    EC2Client: class {
      async send() {
        return {};
      }
    },
    RunInstancesCommand: passthrough("RunInstancesCommand"),
    DescribeInstancesCommand: passthrough("DescribeInstancesCommand"),
    StartInstancesCommand: passthrough("StartInstancesCommand"),
    StopInstancesCommand: passthrough("StopInstancesCommand"),
    TerminateInstancesCommand: passthrough("TerminateInstancesCommand"),
    CreateKeyPairCommand: passthrough("CreateKeyPairCommand"),
    DeleteKeyPairCommand: passthrough("DeleteKeyPairCommand"),
    CreateSecurityGroupCommand: passthrough("CreateSecurityGroupCommand"),
    AuthorizeSecurityGroupIngressCommand: passthrough("AuthorizeSecurityGroupIngressCommand"),
    DescribeSecurityGroupsCommand: passthrough("DescribeSecurityGroupsCommand"),
    DescribeImagesCommand: passthrough("DescribeImagesCommand"),
    DeregisterImageCommand: passthrough("DeregisterImageCommand"),
    DescribeSnapshotsCommand: passthrough("DescribeSnapshotsCommand"),
    DeleteSnapshotCommand: passthrough("DeleteSnapshotCommand"),
    CreateImageCommand: passthrough("CreateImageCommand"),
  };
});

import { AwsEc2Service } from "@/lib/aws/ec2-service";

// The generators are private; reach in via casts. This is a test, not prod.
function callPrivate(svc: AwsEc2Service, name: string, ...args: any[]): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = (svc as any)[name];
  if (typeof fn !== "function") throw new Error(`No method ${name}`);
  return fn.apply(svc, args);
}

// What AWS sees as "raw" is the byte length of base64-decoding what we
// send. Compute it accurately: bytes-from-base64.
function rawDecodedSize(b64: string): number {
  return Buffer.from(b64, "base64").length;
}

function assertFits(label: string, ud: string) {
  expect(ud).toBeTypeOf("string");
  const raw = rawDecodedSize(ud);
  // Hard gates (mirror AWS's two documented limits)
  expect(raw, `${label} raw size`).toBeLessThan(HARD_RAW_LIMIT);
  expect(ud.length, `${label} base64 length`).toBeLessThan(HARD_B64_LIMIT);
  // Soft warnings
  if (raw > HARD_RAW_LIMIT - SAFETY_MARGIN) {
    console.warn(
      `[userdata] ${label}: raw=${raw}B is within ${SAFETY_MARGIN}B of AWS's ${HARD_RAW_LIMIT}B raw limit. Trim the agent or wrapper.`
    );
  }
}

describe("AWS UserData size limit (RunInstances 16384B raw cap)", () => {
  it("Linux desktop UserData fits the 16384B raw limit", () => {
    const svc = new AwsEc2Service();
    const ud = callPrivate(svc, "generateDesktopUserData", "TESTPW");
    assertFits("Linux desktop", ud);
  });

  it("Linux golden-AMI slim UserData fits the 16384B raw limit", () => {
    const svc = new AwsEc2Service();
    const ud = callPrivate(svc, "generateGoldenAmiUserData", "TESTPW");
    assertFits("Linux golden", ud);
  });

  it("Windows golden UserData fits the 16384B raw limit", () => {
    // This is the test that catches the production failures the user hit:
    //   "User data is limited to 16384 bytes" (the raw limit)
    //   "Encoded User data is limited to 25600 bytes" (the base64 limit)
    // The Windows path uses a self-decompressing PowerShell bootstrap +
    // Python-agent minification + PowerShell-script minification to fit.
    const svc = new AwsEc2Service();
    const ud = callPrivate(svc, "generateWindowsGoldenUserData", "TESTPW");
    assertFits("Windows golden", ud);
  });

  it("Windows generateWindowsDesktopUserData (full path) also fits", () => {
    const svc = new AwsEc2Service();
    const ud = callPrivate(svc, "generateWindowsDesktopUserData", "TESTPW");
    assertFits("Windows desktop", ud);
  });

  it("Windows bootstrap is a valid <powershell>...</powershell> block", () => {
    // Catch malformed bootstrap (would also fail at AWS validation but
    // earlier feedback is better).
    const svc = new AwsEc2Service();
    const ud = callPrivate(svc, "generateWindowsGoldenUserData", "TESTPW");
    const decoded = Buffer.from(ud, "base64").toString("utf-8");
    expect(decoded.startsWith("<powershell>")).toBe(true);
    expect(decoded.endsWith("</powershell>")).toBe(true);
    // Must contain the gzip-decompression incantation
    expect(decoded).toMatch(/GZipStream/);
    expect(decoded).toMatch(/FromBase64String/);
    expect(decoded).toMatch(/Invoke|powershell\.exe -NoProfile/);
  });

  it("Windows bootstrap-extracted inner script still has the agent + auto-logon + reboot", () => {
    // Sanity: after decompressing the inner script, it must contain the
    // critical sections — agent deploy, auto-logon, reboot. Catches
    // accidental truncation by the strip/wrap step.
    const svc = new AwsEc2Service();
    const ud = callPrivate(svc, "generateWindowsGoldenUserData", "TESTPW");
    const decoded = Buffer.from(ud, "base64").toString("utf-8");

    // Extract the embedded base64 inner payload, gunzip, inspect
    const m = decoded.match(/FromBase64String\("([^"]+)"\)/);
    expect(m).not.toBeNull();
    const innerB64 = m![1];
    const innerGz = Buffer.from(innerB64, "base64");
    const zlib = require("zlib");
    const innerScript = zlib.gunzipSync(innerGz).toString("utf-8");

    // Critical sections must survive
    expect(innerScript).toMatch(/AutoAdminLogon/);
    expect(innerScript).toMatch(/server\.py/);
    expect(innerScript).toMatch(/shutdown \/r/);
    // Should NOT have <powershell> tags inside (they were stripped)
    expect(innerScript).not.toMatch(/<powershell>/);
    expect(innerScript).not.toMatch(/<\/powershell>/);
  });
});
