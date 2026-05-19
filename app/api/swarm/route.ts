/**
 * POST /api/swarm — Swarm Mode orchestrator.
 *
 * 1. Creates N temporary AWS machines (tagged is_swarm)
 * 2. Polls until all are ready (agent health)
 * 3. Proxies to Python backend for parallel execution (SSE)
 * 4. Deletes ALL swarm machines in finally block — guaranteed cleanup
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAwsEc2Service } from "@/lib/aws/ec2-service";
import {
  createSwarmMailboxes,
  deleteSwarmMailboxes,
  type SwarmMailbox,
} from "@/lib/services/workmail-service";
import WebSocket from "ws";

const PYTHON_BACKEND_URL =
  process.env.PYTHON_BACKEND_URL || "http://127.0.0.1:8001";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";

export const maxDuration = 600; // 10 minutes — swarms take longer

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SwarmRequest {
  prompt: string;
  machineCount?: number;
  maxSteps?: number;
  model?: string;
  /** Keep machines alive after swarm completes (starter/plus/pro only) */
  persistent?: boolean;
}

/** Tiers that support persistent swarms */
const PERSISTENT_ELIGIBLE_TIERS = new Set(["starter", "professional", "unlimited", "enterprise"]);

interface SwarmMachineRecord {
  id: string;
  awsInstanceId: string;
  keyPairName: string;
  publicIp?: string;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Database connection failed" },
      { status: 500 }
    );
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = authData.user.id;

  let body: SwarmRequest;
  try {
    body = await req.json();
  } catch {
    // Empty or truncated body — typically from an aborted fetch
    return NextResponse.json(
      { error: "Invalid or empty request body" },
      { status: 400 }
    );
  }

  if (!body.prompt?.trim()) {
    return NextResponse.json(
      { error: "prompt is required" },
      { status: 400 }
    );
  }

  // -----------------------------------------------------------------------
  // Determine how many machines to create
  // -----------------------------------------------------------------------
  const { data: subscriptions } = await (supabase as any)
    .from("user_subscriptions")
    .select(`status, subscription_plans ( tier, max_machines )`)
    .eq("user_id", userId)
    .in("status", ["active", "trialing", "past_due"]);

  const plan = subscriptions?.[0]?.subscription_plans;
  const planTier: string = plan?.tier || "free";
  const planMaxMachines = plan?.max_machines || 1;

  // Persistent swarm validation
  const isPersistent = body.persistent === true;

  if (isPersistent) {
    if (!PERSISTENT_ELIGIBLE_TIERS.has(planTier)) {
      return NextResponse.json(
        { error: "Persistent swarms require a Starter ($19) or Unlimited ($249) plan" },
        { status: 403 }
      );
    }

    // Count user's existing persistent (non-swarm) machines
    const { data: existingMachines } = await (supabase as any)
      .from("user_machines")
      .select("id, settings")
      .eq("user_id", userId)
      .neq("status", "deleting")
      .neq("status", "error");

    const existingPersistentCount = (existingMachines || []).filter((m: any) => {
      const s = typeof m.settings === "string" ? JSON.parse(m.settings) : m.settings || {};
      // Don't count temporary swarm machines (is_swarm but not persistent_swarm)
      return !s.is_swarm || s.persistent_swarm;
    }).length;

    const requestedPersistent = Math.min(
      body.machineCount || planMaxMachines,
      planMaxMachines,
    );

    if (existingPersistentCount + requestedPersistent > planMaxMachines) {
      const slotsLeft = Math.max(0, planMaxMachines - existingPersistentCount);
      return NextResponse.json(
        {
          error: slotsLeft === 0
            ? `You already have ${existingPersistentCount} persistent machine${existingPersistentCount !== 1 ? "s" : ""} (plan limit: ${planMaxMachines}). Delete a machine first or run a temporary swarm.`
            : `Only ${slotsLeft} persistent machine slot${slotsLeft !== 1 ? "s" : ""} available (${existingPersistentCount}/${planMaxMachines} used). Reduce machine count to ${slotsLeft} or run a temporary swarm.`,
        },
        { status: 400 }
      );
    }
  }

  // Persistent swarms are capped at plan's max_machines (they become persistent machines).
  // Temporary swarms get 3x the limit, hard-capped at 10.
  //
  // EXCEPTION: the "unlimited" tier ships with unlimited credits but only
  // 1 concurrent agent — without this cap a single user could spin up 6
  // (= 2 * 3) machines and burn massive compute per hour at flat $249/mo,
  // breaking plan economics.  The cap is also reflected in lib/pricing/tiers.ts
  // (unlimited.swarmAgentsLimit = 1) and shown in the marketing UI as
  // "1 concurrent agent".
  const swarmMaxMachines = planTier === "unlimited"
    ? 1
    : isPersistent
      ? planMaxMachines
      : Math.min(planMaxMachines * 3, 10);

  const requestedCount = Math.min(
    body.machineCount || swarmMaxMachines,
    swarmMaxMachines,
  );

  if (requestedCount < 1) {
    return NextResponse.json(
      { error: "Need at least 1 machine" },
      { status: 400 }
    );
  }

  // -----------------------------------------------------------------------
  // Persist swarm run record
  // -----------------------------------------------------------------------
  const swarmId = crypto.randomUUID();
  console.log(`Swarm ${swarmId}: starting with ${requestedCount} machines for user ${userId}`);

  await (supabase as any).from("swarm_runs").insert({
    swarm_id: swarmId,
    user_id: userId,
    prompt: body.prompt.slice(0, 5000),
    machine_count: requestedCount,
    status: "creating",
    model: body.model || null,
    max_steps: body.maxSteps || 200,
    persistent: isPersistent,
  });

  // -----------------------------------------------------------------------
  // Create swarm machines
  // -----------------------------------------------------------------------
  const awsService = getAwsEc2Service();
  const machines: SwarmMachineRecord[] = [];
  let mailboxes: SwarmMailbox[] = [];
  let cleanedUp = false;

  // Helper: cleanup swarm machines — idempotent via cleanedUp guard.
  // For persistent swarms that completed/cancelled successfully, converts machines
  // to regular persistent machines instead of deleting them.
  // For failed swarms or temporary swarms, deletes everything.
  async function deleteAllSwarmMachines(finalStatus: "completed" | "failed" | "cancelled" = "completed") {
    if (cleanedUp) return;
    cleanedUp = true;

    // Persistent swarms keep machines on success/cancel — only delete on failure
    const keepMachines = isPersistent && finalStatus !== "failed";

    if (keepMachines) {
      // Convert swarm machines to regular persistent machines
      for (const m of machines) {
        try {
          if (!m.awsInstanceId) continue;
          // Fetch current settings and strip swarm flags
          const { data: dbm } = await (supabase as any)
            .from("user_machines")
            .select("settings, display_name")
            .eq("id", m.id)
            .single();

          if (dbm) {
            const settings = typeof dbm.settings === "string"
              ? JSON.parse(dbm.settings)
              : { ...dbm.settings };

            // Remove swarm-specific flags, keep AWS/provider details
            delete settings.is_swarm;
            delete settings.persistent_swarm;
            delete settings.swarm_id;
            delete settings.swarm_index;
            delete settings.swarm_created_at;

            await (supabase as any)
              .from("user_machines")
              .update({
                settings,
                display_name: dbm.display_name?.replace(/^Swarm #\d+/, "Machine"),
                status: "running",
              })
              .eq("id", m.id);
          }
        } catch (e) {
          console.error(`Swarm ${swarmId}: failed to convert machine ${m.id} to persistent:`, e);
        }
      }
      console.log(
        `Swarm ${swarmId}: converted ${machines.filter(m => m.awsInstanceId).length} machines to persistent`
      );
    } else {
      // Delete all swarm machines (temporary swarm or failed persistent)
      for (const m of machines) {
        try {
          if (m.awsInstanceId) {
            await awsService.terminateInstance(m.awsInstanceId, m.keyPairName);
          }
        } catch (e) {
          console.error(
            `Swarm cleanup: failed to terminate ${m.awsInstanceId}:`,
            e
          );
        }
        try {
          await (supabase as any)
            .from("user_machines")
            .delete()
            .eq("id", m.id);
        } catch (e) {
          console.error(`Swarm cleanup: failed to delete DB record ${m.id}:`, e);
        }
      }
      if (machines.length > 0) {
        console.log(
          `Swarm ${swarmId}: cleaned up ${machines.length} temporary machines`
        );
      }
    }

    // Cleanup WorkMail mailboxes (unless keeping persistent machines)
    if (!keepMachines && mailboxes.length > 0) {
      try {
        await deleteSwarmMailboxes(mailboxes);
      } catch (e) {
        console.error(`Swarm ${swarmId}: mailbox cleanup failed:`, e);
      }
    }

    // Update swarm run record — fetch latest swarm_summary event if available
    let resultSummary = `${machines.filter(m => m.awsInstanceId).length} machines used`;
    try {
      const { data: summaryEvent } = await (supabase as any)
        .from("swarm_run_events")
        .select("content")
        .eq("swarm_id", swarmId)
        .eq("event_type", "swarm_summary")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (summaryEvent?.content) {
        resultSummary = summaryEvent.content.slice(0, 5000);
      }
    } catch { /* keep default */ }

    await (supabase as any)
      .from("swarm_runs")
      .update({
        status: finalStatus,
        completed_at: new Date().toISOString(),
        result_summary: resultSummary,
      })
      .eq("swarm_id", swarmId);
  }

  try {
    const vncPassword =
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 8);

    // Create all machines in parallel.
    // We push a partial record to `machines` immediately after DB insert
    // so cleanup can find it even if EC2 creation fails.
    const createPromises = Array.from({ length: requestedCount }, async (_, i) => {
      const containerName =
        `swarm-${userId.substring(0, 8)}-${swarmId.substring(0, 8)}-${i}`.toLowerCase();

      // Insert placeholder in DB
      const { data: dbMachine, error: insertError } = await (supabase as any)
        .from("user_machines")
        .insert({
          user_id: userId,
          container_name: containerName,
          display_name: `Swarm #${i + 1}`,
          status: "creating",
          azure_resource_group: "",
          azure_container_group: "",
          vnc_password: vncPassword,
          vnc_port: 5901,
          websocket_port: 6080,
          cpu_cores: 2,
          memory_gb: 2,
          storage_gb: 16,
          gpu_enabled: false,
          settings: {
            provider: "aws",
            is_swarm: true,
            persistent_swarm: isPersistent,
            swarm_id: swarmId,
            swarm_index: i,
            swarm_created_at: new Date().toISOString(),
            sshUsername: "ubuntu",
            desktopEnabled: true,
          },
        })
        .select()
        .single();

      if (insertError || !dbMachine) {
        console.error(`Swarm ${swarmId}: DB insert failed for machine #${i}:`, insertError);
        throw new Error(
          `Failed to create swarm machine #${i}: ${insertError?.message}`
        );
      }
      console.log(`Swarm ${swarmId}: DB record created for machine #${i}: ${dbMachine.id}`);

      // Track immediately so cleanup can find it if EC2 creation fails
      const record: SwarmMachineRecord = {
        id: dbMachine.id,
        awsInstanceId: "",
        keyPairName: "",
      };
      machines.push(record);

      // Launch EC2 instance
      const result = await awsService.createInstance(userId, {
        name: containerName,
        storageGb: 16,
        desktopEnabled: true,
        vncPassword,
      });

      // Update the tracked record with AWS details
      record.awsInstanceId = result.instanceId;
      record.keyPairName = result.keyPairName;

      // Update DB with AWS details
      await (supabase as any)
        .from("user_machines")
        .update({
          settings: {
            provider: "aws",
            is_swarm: true,
            persistent_swarm: isPersistent,
            swarm_id: swarmId,
            swarm_index: i,
            swarm_created_at: new Date().toISOString(),
            sshUsername: "ubuntu",
            desktopEnabled: true,
            awsInstanceId: result.instanceId,
            awsRegion: process.env.AWS_REGION || "us-east-1",
            awsKeyPairName: result.keyPairName,
            awsInstanceType: "t4g.small",
            agent_port: 8080,
          },
        })
        .eq("id", dbMachine.id);

      return record;
    });

    await Promise.allSettled(createPromises);

    // Filter to only machines that got an EC2 instance
    const liveMachines = machines.filter((m) => m.awsInstanceId);

    if (liveMachines.length === 0) {
      await deleteAllSwarmMachines("failed");
      return NextResponse.json(
        { error: "Failed to create any swarm machines" },
        { status: 500 }
      );
    }

    console.log(
      `Swarm ${swarmId}: created ${liveMachines.length}/${requestedCount} machines`
    );

    // -----------------------------------------------------------------------
    // Create WorkMail mailboxes in parallel with machine readiness polling
    // -----------------------------------------------------------------------
    const [readyMachines, createdMailboxes] = await Promise.all([
      waitForMachinesReady(supabase, awsService, liveMachines, swarmId),
      createSwarmMailboxes(swarmId, liveMachines.length).catch((e) => {
        console.error(`Swarm ${swarmId}: mailbox creation failed:`, e);
        return [] as SwarmMailbox[];
      }),
    ]);

    mailboxes = createdMailboxes;

    if (mailboxes.length > 0) {
      console.log(
        `Swarm ${swarmId}: ${mailboxes.length} email mailboxes provisioned`
      );
    }

    if (readyMachines.length === 0) {
      console.error(`Swarm ${swarmId}: no machines became ready`);
      await deleteAllSwarmMachines("failed");
      return NextResponse.json(
        { error: "No swarm machines became ready in time" },
        { status: 504 }
      );
    }

    console.log(
      `Swarm ${swarmId}: ${readyMachines.length} machines ready, starting execution`
    );

    await (supabase as any)
      .from("swarm_runs")
      .update({ status: "running" })
      .eq("swarm_id", swarmId);

    // -----------------------------------------------------------------------
    // Proxy to Python backend for parallel execution
    // -----------------------------------------------------------------------
    // Build a map of machine index → mailbox for the backend
    const mailboxByIndex = new Map<number, SwarmMailbox>();
    for (const mb of mailboxes) {
      mailboxByIndex.set(mb.machineIndex, mb);
    }

    const backendBody = {
      swarm_id: swarmId,
      prompt: body.prompt,
      machines: readyMachines.map((m, idx) => {
        const mb = mailboxByIndex.get(idx);
        return {
          machine_id: m.id,
          display_name: `Swarm Machine`,
          ...(mb && {
            email_identity: {
              email: mb.email,
              password: mb.password,
            },
          }),
        };
      }),
      model: body.model,
      max_steps: body.maxSteps || 200,
      user_id: userId,
      persistent: isPersistent,
    };

    const controller = new AbortController();
    req.signal.addEventListener("abort", () => {
      try {
        controller.abort();
      } catch {
        /* ignore */
      }
    });

    const backendResponse = await fetch(
      `${PYTHON_BACKEND_URL}/api/swarm/execute`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "X-User-ID": userId,
          ...(INTERNAL_API_KEY && { "X-Internal-Key": INTERNAL_API_KEY }),
        },
        body: JSON.stringify(backendBody),
        signal: controller.signal,
      }
    );

    if (!backendResponse.ok) {
      const errText = await backendResponse.text();
      await deleteAllSwarmMachines("failed");
      return NextResponse.json(
        { error: errText || "Backend swarm execution failed" },
        { status: backendResponse.status }
      );
    }

    const reader = backendResponse.body?.getReader();
    if (!reader) {
      await deleteAllSwarmMachines("failed");
      return NextResponse.json(
        { error: "No response stream from backend" },
        { status: 500 }
      );
    }

    // Strip ALL internal agent tags/markers from content before saving
    function stripAgentTags(text: string): string {
      return text
        // Strip cua-section tags but KEEP inner content (so DB events preserve plans/reflections)
        .replace(/<cua-section[^>]*>/g, "")
        .replace(/<\/cua-section>/g, "")
        // Strip markers but keep inner content
        .replace(/\[TASK_PLAN_START\]/g, "")
        .replace(/\[TASK_PLAN_END\]/g, "")
        .replace(/\[Coasty_REPORT_START\]/g, "")
        .replace(/\[Coasty_REPORT_END\]/g, "")
        // <file-attachment .../> and <file-attachment ...>...</file-attachment>
        .replace(/<file-attachment[^>]*>[\s\S]*?<\/file-attachment>/g, "")
        .replace(/<file-attachment[^>]*\/>/g, "")
        .replace(/<file-attachment[^>]*>/g, "")
        .replace(/<\/file-attachment>/g, "")
        // Agent code blocks: ```python agent.* ```
        .replace(/```python\s+agent\.[\s\S]*?```/g, "")
        // [NEED_USER_INPUT] markers
        .replace(/\[NEED_USER_INPUT\]/g, "")
        // Generic self-closing XML-like tags (e.g. <tool-result />)
        .replace(/<[a-z][\w-]*[^>]*\/>/g, "")
        .trim();
    }

    // Buffer for parsing SSE events from the stream
    const decoder = new TextDecoder();
    let sseBuf = "";

    // Fire-and-forget: save an event row (don't block stream)
    function saveEvent(
      machineIndex: number | null,
      eventType: string,
      content: string,
      screenshot?: string | null,
      toolName?: string | null,
    ) {
      const row: Record<string, any> = {
        swarm_id: swarmId,
        machine_index: machineIndex,
        event_type: eventType,
        content: content.slice(0, 10000),
      };
      if (screenshot) row.screenshot = screenshot;
      if (toolName) row.tool_name = toolName;

      (supabase as any)
        .from("swarm_run_events")
        .insert(row)
        .then(() => {})
        .catch((e: any) =>
          console.error(`Swarm ${swarmId}: failed to save event:`, e)
        );
    }

    // Parse SSE lines and persist interesting events
    function captureEvents(raw: string) {
      sseBuf += raw;
      const parts = sseBuf.split("\n\n");
      sseBuf = parts.pop() || "";

      for (const part of parts) {
        if (!part.trim()) continue;
        const colonIdx = part.indexOf(":");
        if (colonIdx < 0) continue;
        const dataStr = part.substring(colonIdx + 1);
        try {
          const chunk = JSON.parse(dataStr);
          const type = chunk.type;

          if (type === "swarm_meta") {
            saveEvent(null, "swarm_meta", chunk.status || "unknown");
          } else if (type === "swarm_planning") {
            // Task decomposition status + subtask assignments
            const content = chunk.subtasks
              ? JSON.stringify(chunk.subtasks)
              : chunk.status || "planning";
            saveEvent(null, "swarm_planning", content);
          } else if (type === "swarm_summary") {
            // Aggregated result summary
            saveEvent(null, "swarm_summary", chunk.summary || "");
          } else if (type === "swarm_machine_status") {
            saveEvent(
              chunk.machine_index ?? null,
              "machine_status",
              chunk.status || "unknown"
            );
          } else if (type === "text" && chunk.machine_index !== undefined) {
            const cleaned = stripAgentTags(chunk.content || "");
            if (cleaned) {
              saveEvent(
                chunk.machine_index,
                "text",
                cleaned
              );
            }
          } else if (type === "tool_call") {
            saveEvent(
              chunk.machine_index ?? null,
              "tool_call",
              chunk.toolName || chunk.tool_name || "",
              null,
              chunk.toolName || chunk.tool_name || null,
            );
          } else if (type === "tool_result") {
            // Capture screenshot from frontendScreenshot field
            const screenshot = chunk.frontendScreenshot || null;
            const toolName = chunk.toolName || chunk.tool_name || "";
            const result = typeof chunk.result === "string"
              ? chunk.result.slice(0, 500)
              : JSON.stringify(chunk.result || "").slice(0, 500);
            saveEvent(
              chunk.machine_index ?? null,
              "tool_result",
              `${toolName}: ${result}`,
              screenshot,
              toolName || null,
            );
          } else if (type === "step_complete") {
            saveEvent(
              chunk.machine_index ?? null,
              "step_complete",
              `Step ${chunk.step || "?"}`
            );
          } else if (type === "error") {
            saveEvent(
              chunk.machine_index ?? null,
              "error",
              chunk.error || "Unknown error"
            );
          }
        } catch {
          // skip non-JSON
        }
      }
    }

    let streamCancelled = false;

    const stream = new ReadableStream({
      async start(streamController) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              streamController.close();
              break;
            }
            // Pass through to client
            streamController.enqueue(value);
            // Also capture events for persistence
            try {
              captureEvents(decoder.decode(value, { stream: true }));
            } catch {
              /* capture failure should never break stream */
            }
          }
        } catch (e) {
          try {
            streamController.error(e);
          } catch {
            /* already closed */
          }
        } finally {
          // GUARANTEED CLEANUP — always runs
          const finalStatus = streamCancelled ? "cancelled" : "completed";
          await deleteAllSwarmMachines(finalStatus);
        }
      },
      cancel() {
        streamCancelled = true;
        reader.cancel();
        // cleanup handled by the finally above when reader errors/closes
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Swarm-ID": swarmId,
        "X-Swarm-Machine-Count": String(readyMachines.length),
      },
    });
  } catch (error: any) {
    console.error(`Swarm ${swarmId} error:`, error?.message || error);
    console.error(`Swarm ${swarmId} stack:`, error?.stack);
    await deleteAllSwarmMachines("failed");
    return NextResponse.json(
      { error: error.message || "Swarm execution failed" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// Wait for machines to get IPs and agent health
// ---------------------------------------------------------------------------

async function waitForMachinesReady(
  supabase: any,
  awsService: any,
  machines: SwarmMachineRecord[],
  swarmId: string,
  timeoutMs: number = 420000 // 7 minutes
): Promise<SwarmMachineRecord[]> {
  const deadline = Date.now() + timeoutMs;
  const pending = new Set(machines.map((m) => m.id));
  const ready: SwarmMachineRecord[] = [];

  while (pending.size > 0 && Date.now() < deadline) {
    await sleep(5000);

    for (const machineId of Array.from(pending)) {
      const machine = machines.find((m) => m.id === machineId)!;

      // Sync EC2 status to DB first
      if (machine.awsInstanceId) {
        await syncMachineStatus(supabase, awsService, machineId, machine.awsInstanceId);
      }

      // Check DB for IP
      const { data: dbm } = await (supabase as any)
        .from("user_machines")
        .select("public_ip_address, status, settings")
        .eq("id", machineId)
        .single();

      if (!dbm) {
        pending.delete(machineId);
        continue;
      }

      if (dbm.status === "error") {
        console.warn(`Swarm ${swarmId}: machine ${machineId} errored`);
        pending.delete(machineId);
        continue;
      }

      if (!dbm.public_ip_address) continue;

      machine.publicIp = dbm.public_ip_address;

      // Check agent health
      const settings = dbm.settings as any;
      const agentPort = settings?.agent_port || 8080;
      const agentReady = await pingAgent(dbm.public_ip_address, agentPort);

      if (agentReady) {
        await (supabase as any)
          .from("user_machines")
          .update({ status: "running", started_at: new Date().toISOString() })
          .eq("id", machineId);

        ready.push(machine);
        pending.delete(machineId);
        console.log(
          `Swarm ${swarmId}: machine ${machineId} ready (${ready.length}/${machines.length})`
        );
      }
    }
  }

  if (pending.size > 0) {
    console.warn(
      `Swarm ${swarmId}: ${pending.size} machines never became ready`
    );
  }

  return ready;
}

// Sync EC2 instance status to database
async function syncMachineStatus(
  supabase: any,
  awsService: any,
  machineId: string,
  instanceId: string
) {
  try {
    const status = await awsService.getInstanceStatus(instanceId);
    const updates: Record<string, any> = {};

    if (status.state === "running") {
      updates.status = "running";
      if (status.ipAddress) updates.public_ip_address = status.ipAddress;
    } else if (status.state === "failed") {
      updates.status = "error";
      updates.status_message = status.message || "Instance failed";
    }

    if (Object.keys(updates).length > 0) {
      await (supabase as any)
        .from("user_machines")
        .update(updates)
        .eq("id", machineId);
    }
  } catch {
    // Non-critical — keep polling
  }
}

// ---------------------------------------------------------------------------
// Agent health ping
// ---------------------------------------------------------------------------

function pingAgent(ipAddress: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://${ipAddress}:${port}`);
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close();
        resolve(false);
      }
    }, 3000);

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "ping" }));
    });

    ws.on("message", (data: Buffer) => {
      if (settled) return;
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "pong") {
          settled = true;
          clearTimeout(timeout);
          ws.close();
          resolve(true);
        }
      } catch {
        // ignore
      }
    });

    ws.on("error", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(false);
      }
    });

    ws.on("close", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(false);
      }
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
