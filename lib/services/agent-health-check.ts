/**
 * Agent health-check + auto-recovery for cloud VM agents.
 *
 * Background — 2026-05-17 production incident
 * -------------------------------------------
 * A single EC2 cloud VM at 18.207.92.91:8080 went dark for 24 minutes.
 * The Python backend's `connect_to_agent` retry loop produced 91 dial
 * timeouts in CloudWatch with no alarm firing and no automated recovery.
 * The user's CUA session sat broken until they manually stopped + restarted
 * the machine. The only signal was a log pattern nobody was paged on.
 *
 * Recovery model
 * --------------
 * `backend/app/services/vm_control.py` now flips an `agent_unresponsive`
 * circuit breaker after 3 consecutive dial failures within 5 minutes.
 * `/api/internal/vm-health` lists the flagged machines. This module is
 * the consumer:
 *
 *   1. Poll the backend's unresponsive list.
 *   2. For each machine, look up the EC2 instance_id from Supabase.
 *   3. Run `systemctl restart ai-agent.service` via SSM RunCommand.
 *      Wait ~60s for the agent to come back.
 *   4. If still on the unresponsive list after the SSM restart attempt,
 *      terminate + relaunch the EC2 instance (via existing
 *      `getAwsEc2Service` lifecycle methods), update Supabase with
 *      the new instance id/IP, and write a `machine_events` row so the
 *      user-visible WebSocket bridge can notify the user.
 *
 * Cross-replica safety
 * --------------------
 * `machine-cleanup.ts` wraps this with `withCronLock("runAgentHealthCheck",
 * 2 /* minutes *\/, …)`. One replica per 2-min bucket performs the work.
 * Backend `/api/internal/vm-health` is replicated across api/sse/ws —
 * we hit ONE of them and act on whatever it returns.
 *
 * Kill switch
 * -----------
 * `DISABLE_AGENT_AUTO_REPLACE=true` (env var) keeps the cron lock running
 * (so we still observe whether the loop is healthy) but the body no-ops.
 * This lets operators disable the destructive EC2-replace path during
 * incidents while leaving the diagnostic surface in place.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServiceClient } from "@/lib/supabase/service";

/** Per-cycle stats — reported into the cron_runs lock row for postmortems. */
export interface AgentHealthCheckStats {
  /** Total machines listed by /api/internal/vm-health this cycle. */
  polled: number;
  /** How many we ran `systemctl restart ai-agent.service` against via SSM. */
  ssmRestarted: number;
  /** How many we terminated + relaunched (step 2 of the auto-replace flow). */
  ec2Replaced: number;
  /** How many we skipped (no instance_id, kill switch, electron, etc.). */
  skipped: number;
  /** Per-machine failures. Always logged; counts surfaced for visibility. */
  errors: number;
}

/** Shape of one entry from `GET /api/internal/vm-health`. */
interface UnresponsiveMachineEntry {
  machine_id: string;
  age_seconds?: number;
  opened_at_monotonic?: number;
}

/** Response shape from `GET /api/internal/vm-health`. */
interface VmHealthResponse {
  unresponsive_machines: UnresponsiveMachineEntry[];
  diagnostic_counters?: Record<string, number>;
  worker_id?: string;
  error?: string;
}

/**
 * Public entry point — does one health-check cycle.
 *
 * NEVER throws: any error from the polling / SSM / EC2 lifecycle is caught
 * and counted in `stats.errors`. The caller wraps this in `withCronLock`
 * and the resulting `crashed` status applies only when this function
 * itself ALSO threw (e.g. supabase service-client init failure).
 */
export async function runAgentHealthCheck(): Promise<AgentHealthCheckStats> {
  const stats: AgentHealthCheckStats = {
    polled: 0,
    ssmRestarted: 0,
    ec2Replaced: 0,
    skipped: 0,
    errors: 0,
  };

  // ── Kill switch ────────────────────────────────────────────────────────
  // Read env at call-time (NOT module load) so a runtime env-var flip is
  // picked up on the next cron tick without a deploy.
  if (process.env.DISABLE_AGENT_AUTO_REPLACE === "true") {
    console.log(
      "[agent-health] DISABLE_AGENT_AUTO_REPLACE=true — skipping this cycle"
    );
    return stats;
  }

  const backendUrl =
    process.env.PYTHON_BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "http://0.0.0.0:8001";
  const internalKey = process.env.INTERNAL_API_KEY;
  if (!internalKey) {
    console.warn(
      "[agent-health] INTERNAL_API_KEY missing — backend will reject the poll. Skipping."
    );
    return stats;
  }

  // ── Poll the backend ───────────────────────────────────────────────────
  let payload: VmHealthResponse;
  try {
    payload = await fetchVmHealth(backendUrl, internalKey);
  } catch (err: any) {
    console.error(
      `[agent-health] poll failed against ${backendUrl}: ${err?.message ?? err}`
    );
    stats.errors += 1;
    return stats;
  }
  stats.polled = payload.unresponsive_machines.length;
  if (stats.polled === 0) {
    return stats;
  }

  console.log(
    `[agent-health] ${stats.polled} unresponsive machine(s) reported by ${payload.worker_id ?? "backend"}`
  );

  // ── Recovery per machine ───────────────────────────────────────────────
  for (const entry of payload.unresponsive_machines) {
    try {
      const action = await recoverMachine(entry, backendUrl, internalKey);
      if (action === "ssm-restart") stats.ssmRestarted += 1;
      else if (action === "ec2-replace") stats.ec2Replaced += 1;
      else if (action === "skipped") stats.skipped += 1;
    } catch (err: any) {
      console.error(
        `[agent-health] recovery for ${entry.machine_id} failed: ${err?.message ?? err}`
      );
      stats.errors += 1;
    }
  }

  return stats;
}

/** Fetch /api/internal/vm-health. Throws on non-2xx. */
async function fetchVmHealth(
  backendUrl: string,
  internalKey: string
): Promise<VmHealthResponse> {
  const url = `${backendUrl.replace(/\/+$/, "")}/api/internal/vm-health`;
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      "X-Internal-Key": internalKey,
      Accept: "application/json",
    },
    // The endpoint is hand-built to never 5xx (it always returns 200 with
    // an `error` field on internal failure) so we accept a 200 with empty
    // list as the normal path.
  });
  if (!resp.ok) {
    throw new Error(
      `vm-health responded ${resp.status} ${resp.statusText}`
    );
  }
  const body = (await resp.json()) as VmHealthResponse;
  if (body.error) {
    throw new Error(`vm-health returned error: ${body.error}`);
  }
  return body;
}

/** Outcome of one machine's recovery attempt. */
type RecoveryAction = "ssm-restart" | "ec2-replace" | "skipped";

/**
 * Recover one machine.
 *
 * Returns the recovery action taken so the caller can update aggregate stats.
 * Throws only on unexpected failure (DB error, etc.); routine outcomes
 * (no instance, electron-provider, lite cleanup raced) return "skipped".
 */
async function recoverMachine(
  entry: UnresponsiveMachineEntry,
  backendUrl: string,
  internalKey: string
): Promise<RecoveryAction> {
  const supabase = createServiceClient();
  if (!supabase) {
    throw new Error("Failed to create Supabase service client");
  }

  // Look up the machine row to find the EC2 instance id + IP.
  const { data: machineRow, error: lookupErr } = await (supabase as any)
    .from("user_machines")
    .select("id, user_id, display_name, settings, status")
    .eq("id", entry.machine_id)
    .single();

  if (lookupErr || !machineRow) {
    console.warn(
      `[agent-health] no Supabase row for unresponsive machine ${entry.machine_id} — skip`
    );
    return "skipped";
  }

  const settings = (machineRow.settings ?? {}) as any;

  // Skip non-AWS providers — Electron, local Docker, etc. are not in scope
  // for this self-heal flow (they live on the user's own hardware or have
  // their own lifecycle handlers).
  if (settings.provider !== "aws" || !settings.awsInstanceId) {
    console.log(
      `[agent-health] skipping ${entry.machine_id} — non-AWS provider (${settings.provider ?? "unknown"})`
    );
    return "skipped";
  }

  // Skip machines already in a non-recoverable state.
  if (
    machineRow.status === "deleting" ||
    machineRow.status === "error" ||
    machineRow.status === "stopped"
  ) {
    console.log(
      `[agent-health] skipping ${entry.machine_id} — status=${machineRow.status}`
    );
    return "skipped";
  }

  const instanceId: string = settings.awsInstanceId;

  // ── Step 1: SSM restart ───────────────────────────────────────────────
  console.log(
    `[agent-health] step 1 SSM restart ai-agent.service on ${instanceId} (${entry.machine_id})`
  );
  await restartAgentViaSsm(instanceId);

  // Wait for the agent to come back. 60s is the existing
  // ai-agent.service `Restart=on-failure` + boot window observed in
  // production. Sleeping in 5s chunks so we can check whether the
  // backend cleared the flag part-way through (best case: 5–15s).
  const cleared = await waitForBackendToClear(
    entry.machine_id,
    backendUrl,
    internalKey,
    /* totalWaitMs */ 60_000,
    /* checkEveryMs */ 5_000
  );

  if (cleared) {
    console.log(
      `[agent-health] ${entry.machine_id} recovered via SSM restart`
    );
    await notifyUser(supabase, machineRow, "auto-recovered via agent restart");
    return "ssm-restart";
  }

  // ── Step 2: terminate + relaunch ──────────────────────────────────────
  console.warn(
    `[agent-health] step 2 EC2 replace for ${entry.machine_id} (${instanceId}) — SSM restart didn't recover the agent`
  );

  // Dynamic import: ec2-service pulls zlib and other Node-only deps that we
  // don't want loaded into Edge-runtime callers of this module.
  const { getAwsEc2Service } = await import("@/lib/aws/ec2-service");
  const awsService = getAwsEc2Service();

  // Snapshot the broken instance first so the user can restore later.
  // null = the instance is already gone (race against lite cleanup) —
  // skip and proceed to relaunch with a fresh image.
  try {
    const snapshot = await awsService.createMachineImage(
      instanceId,
      machineRow.user_id,
      machineRow.display_name
    );
    if (snapshot) {
      await (supabase as any).from("machine_snapshots").insert({
        machine_id: machineRow.id,
        user_id: machineRow.user_id,
        snapshot_name: snapshot.name,
        snapshot_type: "pre_auto_replace",
        storage_location: snapshot.amiId,
        size_gb: settings.storageGb || 16,
        os_state: {
          provider: "aws",
          region: settings.awsRegion || process.env.AWS_REGION || "us-east-1",
          source_instance: instanceId,
          desktop_enabled: settings.desktopEnabled,
        },
      });
    }
  } catch (snapErr) {
    console.warn(
      `[agent-health] pre-replace snapshot failed for ${instanceId}: ${(snapErr as Error)?.message ?? snapErr}`
    );
  }

  await awsService.terminateInstance(instanceId, settings.awsKeyPairName);

  // Relaunch with the same config. Existing `createInstance` returns a
  // new instance_id + key pair; we update Supabase atomically.
  const relaunchConfig = {
    name: machineRow.display_name,
    instanceType: settings.instanceType,
    amiId: settings.amiId,
    storageGb: settings.storageGb,
    desktopEnabled: settings.desktopEnabled,
    vncPassword: settings.vncPassword,
    osType: settings.osType,
  };
  const fresh = await awsService.createInstance(machineRow.user_id, relaunchConfig);

  await (supabase as any)
    .from("user_machines")
    .update({
      status: "creating",
      settings: {
        ...settings,
        awsInstanceId: fresh.instanceId,
        awsKeyPairName: fresh.keyPairName,
      },
    })
    .eq("id", machineRow.id);

  await notifyUser(
    supabase,
    machineRow,
    "your machine was auto-recovered, please refresh"
  );
  return "ec2-replace";
}

/**
 * Run `systemctl restart ai-agent.service` on the given EC2 instance via SSM.
 *
 * SSM requires the instance to have:
 *   * The SSM agent installed and running (default on Amazon Linux 2,
 *     Ubuntu 22.04+ via amazon-ssm-agent.deb in the AMI bake).
 *   * An IAM instance profile with `AmazonSSMManagedInstanceCore`.
 *
 * The current ec2-service.ts UserData installs amazon-ssm-agent on the
 * Ubuntu base image; the IAM profile is attached at launch time via the
 * existing `instanceProfileName` in the launch config. We document both
 * here so future EC2 image changes don't silently break this path.
 *
 * Throws on the AWS API error (no retries — the cron tick is the retry).
 */
async function restartAgentViaSsm(instanceId: string): Promise<void> {
  // Dynamic import: only loaded when actually needed so the SDK doesn't
  // bloat the bundle for routes that never run this code path.
  //
  // IMPORTANT: use a **literal** string for the module specifier, NOT a
  // string variable.  An earlier revision did `const moduleId =
  // "@aws-sdk/client-ssm"; await import(moduleId)` to dodge TS type
  // resolution, but that bypasses vitest's `vi.mock("@aws-sdk/client-ssm",
  // …)` hoisting — vitest can only intercept module specifiers it can
  // resolve statically.  Under fake timers + the un-mocked SDK, the
  // SDK's internal HTTP retry uses setTimeout (now faked) and `client.send`
  // hangs forever — exactly what the 2026-05-17 test timeout exposed.
  // Literal-string dynamic import keeps the lazy-load benefit AND lets
  // vitest hoist the mock cleanly.  The kept-on-one-line form is also
  // pinned by `tests/lib/agent-health-check.test.ts` ("imports SSM SDK
  // + EC2 service lazily" — regex match against the literal source).
  const mod = (await import("@aws-sdk/client-ssm")) as unknown as {
    SSMClient: new (cfg: any) => { send: (cmd: any) => Promise<unknown> };
    SendCommandCommand: new (input: any) => unknown;
  };
  const { SSMClient, SendCommandCommand } = mod;

  const region = process.env.AWS_REGION || "us-east-1";
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY required for SSM auto-recovery"
    );
  }

  const client = new SSMClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });

  await client.send(
    new SendCommandCommand({
      DocumentName: "AWS-RunShellScript",
      InstanceIds: [instanceId],
      Parameters: {
        // The agent runs as `ai-agent.service` under the ubuntu user; the
        // restart command matches the systemd unit installed by UserData.
        commands: [
          "set -e",
          "systemctl restart ai-agent.service",
          // Give the unit a beat to come back so the SSM invocation
          // doesn't return SUCCESS while the agent is still booting.
          "sleep 3",
          "systemctl is-active ai-agent.service",
        ],
      },
      Comment: `coasty auto-recovery: restart ai-agent.service (instance ${instanceId})`,
      // Don't wait for completion: the caller polls
      // /api/internal/vm-health for the unresponsive flag clearing,
      // which is the real success signal. SSM completion is just
      // "command dispatched" — the agent may still need a few seconds.
    })
  );
}

/**
 * Poll the backend's vm-health endpoint until the given machine is no longer
 * flagged, or we exceed `totalWaitMs`. Returns true if cleared.
 *
 * 60s is the production-observed agent-restart envelope (systemd unit
 * start + Python boot + WebSocket listener bind). Going longer pays no
 * dividend; going shorter risks declaring the SSM step a failure and
 * proceeding to the destructive EC2 replace prematurely.
 */
async function waitForBackendToClear(
  machineId: string,
  backendUrl: string,
  internalKey: string,
  totalWaitMs: number,
  checkEveryMs: number
): Promise<boolean> {
  const deadline = Date.now() + totalWaitMs;
  while (Date.now() < deadline) {
    await sleep(checkEveryMs);
    try {
      const payload = await fetchVmHealth(backendUrl, internalKey);
      const stillBad = payload.unresponsive_machines.some(
        (m) => m.machine_id === machineId
      );
      if (!stillBad) return true;
    } catch (err: any) {
      // Transient poll failure: keep waiting until the deadline. The
      // SSM step has already been dispatched; another poll cycle will
      // pick up the recovery if it landed.
      console.warn(
        `[agent-health] poll during wait failed: ${err?.message ?? err}`
      );
    }
  }
  return false;
}

/**
 * Emit a `machine_events` row so the user-visible WebSocket bridge can
 * surface a toast/notification. Best-effort — failure logs but doesn't
 * propagate (user-visible UI is not the source of truth for the recovery).
 */
async function notifyUser(
  supabase: any,
  machineRow: any,
  message: string
): Promise<void> {
  try {
    await supabase.from("machine_events").insert({
      machine_id: machineRow.id,
      user_id: machineRow.user_id,
      event_type: "agent_auto_recovered",
      message,
      created_at: new Date().toISOString(),
    });
  } catch (err: any) {
    // machine_events may not exist on every environment — log and continue.
    console.warn(
      `[agent-health] machine_events insert failed for ${machineRow.id}: ${err?.message ?? err}`
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
