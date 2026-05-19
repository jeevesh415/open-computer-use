import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { getAzureContainerService } from "@/lib/azure/container-instances";
import { getAwsEc2Service } from "@/lib/aws/ec2-service";
import { transformMachineFromDB, transformSessionFromDB } from "@/lib/utils/db-transforms";
import type { MachineActionRequest } from "@/types/machines.types";
import { deleteSwarmMailbox } from "@/lib/services/workmail-service";

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

// GET /api/machines/[id] - Get machine details
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = await createClient();
    if (!supabase) {
      return NextResponse.json({ error: "Database connection failed" }, { status: 500 });
    }
    const { id: machineId } = await params;
    
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = authData.user.id;

    // Get machine details
    const { data: dbMachine, error: machineError } = await supabase
      .from("user_machines")
      .select("*")
      .eq("id", machineId)
      .eq("user_id", userId)
      .single();

    if (machineError || !dbMachine) {
      return NextResponse.json(
        { error: "Machine not found" },
        { status: 404 }
      );
    }
    
    const machine = transformMachineFromDB(dbMachine);

    // Get recent sessions
    const { data: sessions } = await supabase
      .from("machine_sessions")
      .select("*")
      .eq("machine_id", machineId)
      .order("started_at", { ascending: false })
      .limit(10);

    // Get current usage
    const { data: usage } = await supabase
      .from("machine_usage")
      .select("*")
      .eq("machine_id", machineId)
      .gte("period_start", new Date(new Date().setDate(1)).toISOString())
      .order("period_start", { ascending: false });

    return NextResponse.json({
      machine,
      sessions: (sessions || []).map(transformSessionFromDB).filter(Boolean),
      usage: usage || [],
    });
  } catch (error) {
    console.error("Error in GET /api/machines/[id]:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST /api/machines/[id] - Perform action on machine
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = await createClient();
    if (!supabase) {
      return NextResponse.json({ error: "Database connection failed" }, { status: 500 });
    }
    const { id: machineId } = await params;
    
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = authData.user.id;
    const body: MachineActionRequest = await request.json();

    // Get machine
    const { data: machine, error: machineError } = await supabase
      .from("user_machines")
      .select("*")
      .eq("id", machineId)
      .eq("user_id", userId)
      .single();

    if (machineError || !machine) {
      return NextResponse.json(
        { error: "Machine not found" },
        { status: 404 }
      );
    }

    const settings = machine.settings as any;
    const isAws = settings?.provider === 'aws';
    const isElectron = settings?.provider === 'electron' || settings?.isLocal === true;

    switch (body.action) {
      case "start":
        if (machine.status === "running") {
          return NextResponse.json(
            { error: "Machine is already running" },
            { status: 400 }
          );
        }

        if (!["stopped", "error"].includes(machine.status)) {
          return NextResponse.json(
            { error: `Cannot start machine in ${machine.status} state` },
            { status: 400 }
          );
        }

        try {
          await supabase
            .from("user_machines")
            .update({ status: "starting", status_message: isAws ? "Starting machine..." : "Initializing container..." })
            .eq("id", machineId);

          if (isAws) {
            const awsService = getAwsEc2Service();
            const instanceId = settings?.awsInstanceId;
            if (!instanceId) {
              throw new Error("AWS instance ID not found");
            }

            await awsService.startInstance(instanceId);

            // Poll for status
            setTimeout(async () => {
              await updateMachineStatusAws(machineId, instanceId);
            }, 10000);

            return NextResponse.json({ message: "Machine starting" });
          } else {
            const azureService = getAzureContainerService();
            const startResult = await azureService.startContainer(
              machine.azure_container_group,
              machine.azure_resource_group,
              userId
            );

            if (startResult.recreated && startResult.vncPassword) {
              await supabase
                .from("user_machines")
                .update({
                  vnc_password: startResult.vncPassword,
                  status_message: "Container recreated with new password"
                })
                .eq("id", machineId);
            }

            await updateMachineStatus(machineId, machine.azure_container_group);

            setTimeout(async () => {
              await updateMachineStatus(machineId, machine.azure_container_group);
            }, 10000);

            return NextResponse.json({
              message: startResult.recreated
                ? "Machine recreated with new password"
                : "Machine starting",
              recreated: startResult.recreated,
              ...(startResult.recreated && startResult.vncPassword ? {
                vncPassword: startResult.vncPassword
              } : {})
            });
          }
        } catch (error: any) {
          await supabase
            .from("user_machines")
            .update({
              status: "error",
              status_message: error.message || "Failed to start machine"
            })
            .eq("id", machineId);

          throw error;
        }

      case "stop":
        if (machine.status === "stopped") {
          return NextResponse.json(
            { error: "Machine is already stopped" },
            { status: 400 }
          );
        }

        await supabase
          .from("machine_sessions")
          .update({ ended_at: new Date().toISOString() })
          .eq("machine_id", machineId)
          .is("ended_at", null);

        await supabase
          .from("user_machines")
          .update({ status: "stopping" })
          .eq("id", machineId);

        if (isAws) {
          const awsService = getAwsEc2Service();
          const instanceId = settings?.awsInstanceId;
          if (instanceId) {
            await awsService.stopInstance(instanceId);
          }
        } else {
          const azureService = getAzureContainerService();
          await azureService.stopContainer(machine.azure_container_group);
        }

        await supabase
          .from("user_machines")
          .update({ status: "stopped", started_at: null })
          .eq("id", machineId);

        await recordMachineUsage(machine);

        return NextResponse.json({ message: "Machine stopped" });

      case "restart":
        await supabase
          .from("machine_sessions")
          .update({ ended_at: new Date().toISOString() })
          .eq("machine_id", machineId)
          .is("ended_at", null);

        await supabase
          .from("user_machines")
          .update({ status: "stopping", status_message: "Restarting machine..." })
          .eq("id", machineId);

        if (isAws) {
          const awsService = getAwsEc2Service();
          const instanceId = settings?.awsInstanceId;
          if (!instanceId) {
            throw new Error("AWS instance ID not found");
          }

          await awsService.stopInstance(instanceId);
          await new Promise(resolve => setTimeout(resolve, 5000));

          await supabase
            .from("user_machines")
            .update({ status: "starting", status_message: "Machine is starting up..." })
            .eq("id", machineId);

          await awsService.startInstance(instanceId);

          setTimeout(async () => {
            await updateMachineStatusAws(machineId, instanceId);
          }, 15000);

          await recordMachineUsage(machine);

          return NextResponse.json({ message: "Machine restarting" });
        } else {
          const azureService = getAzureContainerService();

          await azureService.stopContainer(machine.azure_container_group);
          await new Promise(resolve => setTimeout(resolve, 2000));

          await supabase
            .from("user_machines")
            .update({ status: "starting", status_message: "Machine is starting up..." })
            .eq("id", machineId);

          const startResult = await azureService.startContainer(
            machine.azure_container_group,
            machine.azure_resource_group,
            userId
          );

          if (startResult.recreated && startResult.vncPassword) {
            await supabase
              .from("user_machines")
              .update({
                vnc_password: startResult.vncPassword,
                status_message: "Container recreated with new password"
              })
              .eq("id", machineId);
          }

          await updateMachineStatus(machineId, machine.azure_container_group);

          setTimeout(async () => {
            await updateMachineStatus(machineId, machine.azure_container_group);
          }, 5000);

          await recordMachineUsage(machine);

          return NextResponse.json({
            message: startResult.recreated
              ? "Machine restarted with new password"
              : "Machine restarting",
            recreated: startResult.recreated,
            ...(startResult.recreated && startResult.vncPassword ? {
              vncPassword: startResult.vncPassword
            } : {})
          });
        }

      case "delete":
        // Electron devices: unregister instead of delete. We don't call
        // external cleanup (there's no cloud resource) and we must keep
        // the DB row with an ``unregistered`` flag so a running Electron
        // install can't silently re-register on its next heartbeat.
        if (isElectron) {
          const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || "http://127.0.0.1:8001";
          const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";
          try {
            const unregRes = await fetch(
              `${PYTHON_BACKEND_URL}/api/electron/machines/${encodeURIComponent(machineId)}/unregister`,
              {
                method: "POST",
                headers: {
                  "X-User-ID": userId,
                  ...(INTERNAL_API_KEY && { "X-Internal-Key": INTERNAL_API_KEY }),
                },
                // Don't let an unresponsive backend hang the UI indefinitely.
                signal: AbortSignal.timeout(10_000),
              }
            );
            if (!unregRes.ok) {
              // FastAPI errors are JSON (`{detail: "..."}`); plain-text
              // fallback handles proxies / unexpected error pages.
              let detail = "";
              try {
                const body: any = await unregRes.clone().json();
                detail = body?.detail || body?.error || "";
              } catch {
                detail = await unregRes.text().catch(() => "");
              }
              const status = unregRes.status === 404 || unregRes.status === 400
                ? unregRes.status
                : 500;
              return NextResponse.json(
                { error: `Failed to unregister device${detail ? `: ${detail}` : ""}` },
                { status }
              );
            }
          } catch (err: any) {
            const msg = err?.name === "TimeoutError" || err?.name === "AbortError"
              ? "Timed out reaching backend to unregister device"
              : (err?.message || "Failed to reach backend to unregister device");
            return NextResponse.json({ error: msg }, { status: 502 });
          }
          return NextResponse.json({ message: "Local device unregistered" });
        }

        if (machine.status === "running") {
          return NextResponse.json(
            { error: "Cannot delete running machine. Please stop it first." },
            { status: 400 }
          );
        }

        await supabase
          .from("user_machines")
          .update({ status: "deleting" })
          .eq("id", machineId);

        if (isAws) {
          const awsService = getAwsEc2Service();
          const instanceId = settings?.awsInstanceId;
          const keyPairName = settings?.awsKeyPairName;
          if (instanceId) {
            // Snapshot before termination so user can restore later
            try {
              const snapshot = await awsService.createMachineImage(
                instanceId,
                userId,
                machine.display_name
              );
              // null = instance already gone / non-snapshottable. Race-safe skip.
              if (snapshot) {
                console.log(`Created pre-delete snapshot: ${snapshot.amiId}`);

                await supabase.from("machine_snapshots").insert({
                  machine_id: machineId,
                  user_id: userId,
                  snapshot_name: snapshot.name,
                  snapshot_type: "pre_shutdown",
                  storage_location: snapshot.amiId,
                  size_gb: settings?.storageGb || 16,
                  os_state: {
                    provider: "aws",
                    region: settings?.awsRegion || process.env.AWS_REGION || "us-east-1",
                    source_instance: instanceId,
                    desktop_enabled: settings?.desktopEnabled,
                  },
                });

                await awsService.cleanupOldSnapshots(userId, 2);
              }
            } catch (snapErr: any) {
              console.warn(`Failed to snapshot before delete:`, snapErr.message);
            }

            await awsService.terminateInstance(instanceId, keyPairName);
          }
        } else {
          const azureService = getAzureContainerService();
          await azureService.deleteContainer(machine.azure_container_group);
        }

        // Cleanup WorkMail mailbox if one was provisioned
        const emailIdentity = settings?.email_identity;
        if (emailIdentity?.workmailUserId) {
          try {
            await deleteSwarmMailbox(emailIdentity.workmailUserId);
            console.log(`Machine ${machineId}: deleted email mailbox`);
          } catch (emailErr: any) {
            console.warn(`Machine ${machineId}: mailbox cleanup failed:`, emailErr.message);
          }
        }

        await supabase
          .from("user_machines")
          .delete()
          .eq("id", machineId);

        return NextResponse.json({ message: "Machine deleted" });

      case "snapshot":
        if (!isAws) {
          return NextResponse.json(
            { error: "Snapshots are only supported for AWS machines" },
            { status: 400 }
          );
        }
        {
          const awsService = getAwsEc2Service();
          const instanceId = settings?.awsInstanceId;
          if (!instanceId) {
            return NextResponse.json(
              { error: "No AWS instance found for this machine" },
              { status: 400 }
            );
          }

          const snapshot = await awsService.createMachineImage(
            instanceId,
            userId,
            machine.display_name
          );

          // Manual snapshot endpoint — surface the skip to the user as a 409
          // (Conflict) so they understand the request didn't take. The
          // background snapshot paths absorb null silently because they're
          // best-effort racing cleanup.
          if (!snapshot) {
            return NextResponse.json(
              {
                error:
                  "Instance is no longer in a snapshottable state " +
                  "(pending/shutting-down/terminated). It may have just been " +
                  "terminated by cleanup; refresh the machines list.",
              },
              { status: 409 }
            );
          }

          await supabase.from("machine_snapshots").insert({
            machine_id: machineId,
            user_id: userId,
            snapshot_name: snapshot.name,
            snapshot_type: "manual",
            storage_location: snapshot.amiId,
            size_gb: settings?.storageGb || 16,
            os_state: {
              provider: "aws",
              region: settings?.awsRegion || process.env.AWS_REGION || "us-east-1",
              source_instance: instanceId,
              desktop_enabled: settings?.desktopEnabled,
            },
          });

          await awsService.cleanupOldSnapshots(userId, 2);

          return NextResponse.json({
            message: "Snapshot created successfully",
            snapshot: { amiId: snapshot.amiId, name: snapshot.name },
          });
        }

      default:
        return NextResponse.json(
          { error: "Invalid action" },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Error in POST /api/machines/[id]:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Helper function to update machine status
async function updateMachineStatus(machineId: string, containerGroupName: string) {
  try {
    const supabase = await createClient();
    if (!supabase) {
      console.error("Database connection failed in updateMachineStatus");
      return;
    }
    const azureService = getAzureContainerService();
    
    // Get current machine data first
    const { data: currentMachine } = await supabase
      .from("user_machines")
      .select("started_at")
      .eq("id", machineId)
      .single();
    
    const status = await azureService.getContainerStatus(containerGroupName);
    
    const updateData: any = {
      status: status.state,
      status_message: status.message,
      last_active_at: new Date().toISOString(),
    };
    
    if (status.ipAddress) {
      updateData.public_ip_address = status.ipAddress;
    }
    
    // Only set started_at if it's not already set and machine is running
    if (status.state === "running" && !currentMachine?.started_at) {
      updateData.started_at = new Date().toISOString();
    }
    
    // Clear started_at if machine is stopped
    if (status.state === "stopped") {
      updateData.started_at = null;
    }
    
    await supabase
      .from("user_machines")
      .update(updateData)
      .eq("id", machineId);
      
  } catch (error) {
    console.error("Error updating machine status:", error);
  }
}

// Helper function to update AWS EC2 machine status
async function updateMachineStatusAws(machineId: string, instanceId: string) {
  try {
    const supabase = await createClient();
    if (!supabase) {
      console.error("Database connection failed in updateMachineStatusAws");
      return;
    }
    const awsService = getAwsEc2Service();

    const { data: currentMachine } = await supabase
      .from("user_machines")
      .select("started_at")
      .eq("id", machineId)
      .single();

    const status = await awsService.getInstanceStatus(instanceId);

    const updateData: any = {
      status: status.state,
      status_message: status.message,
      last_active_at: new Date().toISOString(),
    };

    if (status.ipAddress) {
      updateData.public_ip_address = status.ipAddress;
    }

    if (status.state === "running" && !currentMachine?.started_at) {
      updateData.started_at = new Date().toISOString();
    }

    if (status.state === "stopped") {
      updateData.started_at = null;
    }

    await supabase
      .from("user_machines")
      .update(updateData)
      .eq("id", machineId);

  } catch (error) {
    console.error("Error updating AWS machine status:", error);
  }
}

// Helper function to record machine usage
async function recordMachineUsage(machine: any) {
  try {
    const supabase = await createClient();
    if (!supabase) {
      console.error("Database connection failed in recordMachineUsage");
      return;
    }

    const startTime = machine.started_at || machine.created_at;
    const endTime = new Date();
    const durationHours = (endTime.getTime() - new Date(startTime).getTime()) / (1000 * 60 * 60);

    const cpuSeconds = machine.cpu_cores * durationHours * 3600;
    const memoryGbSeconds = machine.memory_gb * durationHours * 3600;

    let estimatedCost: number;
    if ((machine.settings as any)?.provider === 'aws') {
      const awsService = getAwsEc2Service();
      estimatedCost = awsService.estimateCost(
        process.env.AWS_EC2_INSTANCE_TYPE || 't4g.nano',
        durationHours
      );
    } else {
      const azureService = getAzureContainerService();
      estimatedCost = azureService.estimateCost(
        machine.cpu_cores,
        machine.memory_gb,
        durationHours
      );
    }

    await supabase.from("machine_usage").insert({
      user_id: machine.user_id,
      machine_id: machine.id,
      period_start: startTime,
      period_end: endTime.toISOString(),
      cpu_seconds: cpuSeconds,
      memory_gb_seconds: memoryGbSeconds,
      storage_gb_hours: machine.storage_gb * durationHours,
      network_gb_transferred: 0,
      estimated_cost: estimatedCost,
    });

  } catch (error) {
    console.error("Error recording machine usage:", error);
  }
}