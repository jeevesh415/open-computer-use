import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { getAzureContainerService } from "@/lib/azure/container-instances";
import { getAwsEc2Service } from "@/lib/aws/ec2-service";
import { transformMachineFromDB } from "@/lib/utils/db-transforms";
import type { UserMachine, CreateMachineRequest, MachineStatus } from "@/types/machines.types";
import { dockerService } from "@/lib/docker/docker-service";
import { createSwarmMailbox, deleteSwarmMailbox } from "@/lib/services/workmail-service";
import crypto from "crypto";

// GET /api/machines - List user's machines
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    if (!supabase) {
      return NextResponse.json({ error: "Database connection failed" }, { status: 500 });
    }
    
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = authData.user.id;

    // Get user's machines
    const { data: dbMachines, error: machinesError } = await supabase
      .from("user_machines")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (machinesError) {
      // Error fetching machines
      return NextResponse.json(
        { error: "Failed to fetch machines" },
        { status: 500 }
      );
    }
    
    // Reconcile stale "creating"/"starting" AWS machines against real cloud status
    const staleMachines = (dbMachines || []).filter((m: any) => {
      const settings = m.settings as any;
      return (
        (m.status === "creating" || m.status === "starting") &&
        settings?.provider === "aws" &&
        settings?.awsInstanceId
      );
    });

    if (staleMachines.length > 0) {
      const awsService = getAwsEc2Service();
      await Promise.all(
        staleMachines.map(async (m: any) => {
          try {
            const settings = m.settings as any;
            const status = await awsService.getInstanceStatus(settings.awsInstanceId);

            // Only update if the real state differs from what's in the DB
            if (status.state !== m.status) {
              const updateData: any = {
                status: status.state,
                status_message: status.message,
              };
              if (status.ipAddress) {
                updateData.public_ip_address = status.ipAddress;
              }
              if (status.state === "running" && !m.started_at) {
                updateData.started_at = new Date().toISOString();
              }

              await supabase
                .from("user_machines")
                .update(updateData)
                .eq("id", m.id);

              // Apply the update to the in-memory row so the response is fresh
              m.status = updateData.status;
              m.status_message = updateData.status_message;
              if (updateData.public_ip_address) {
                m.public_ip_address = updateData.public_ip_address;
              }
              if (updateData.started_at) {
                m.started_at = updateData.started_at;
              }
            }
          } catch (err) {
            // If AWS call fails, leave the row as-is — next poll will retry
            console.error(`Failed to reconcile AWS status for machine ${m.id}:`, err);
          }
        })
      );
    }

    // Transform database results to TypeScript format
    const allDbMachines = (dbMachines || []).map(transformMachineFromDB);

    // Separate cloud machines from Electron (local) machines for limit calculations
    // Electron machines are registered in user_machines for display but must NOT
    // count towards cloud VM limits.
    const parseSettings = (m: any) => {
      const raw = m.settings;
      if (typeof raw === 'string') try { return JSON.parse(raw); } catch { return {}; }
      return raw || {};
    };
    const cloudMachines = allDbMachines.filter((m: any) => {
      const s = parseSettings(m);
      return s.provider !== 'electron' && !s.isLocal;
    });

    // Fetch live Electron connection status from backend
    const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || "http://127.0.0.1:8001";
    const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";
    let electronStatusMap: Record<string, boolean> = {};
    try {
      const electronRes = await fetch(`${PYTHON_BACKEND_URL}/api/electron/machines`, {
        headers: {
          "X-User-ID": userId,
          ...(INTERNAL_API_KEY && { "X-Internal-Key": INTERNAL_API_KEY }),
        },
      });
      if (electronRes.ok) {
        const electronData = await electronRes.json();
        for (const em of electronData.machines || []) {
          electronStatusMap[em.id] = em.connected;
        }
      }
    } catch {
      // Non-critical — Electron status will just use DB status
    }

    // Update Electron machine status based on live connection state
    for (const m of allDbMachines) {
      const s = parseSettings(m);
      if (s.provider === 'electron') {
        const isConnected = electronStatusMap[m.id] ?? false;
        (m as any).status = isConnected ? 'running' : 'stopped';
        (m as any).electronConnected = isConnected;
      }
    }

    // Get local Docker machines
    const localMachines = await dockerService.getLocalMachines();
    
    // Transform local machines to match UserMachine type
    const dockerMachines: UserMachine[] = localMachines.map(local => ({
      id: local.id,
      userId: userId,
      containerName: local.containerName,
      displayName: `${local.displayName} (Local)`,
      status: local.status === 'paused' ? 'stopped' as const : local.status as MachineStatus,
      azureResourceGroup: '',
      azureContainerGroup: '',
      azureResourceId: '',
      azureLocation: 'local',
      publicIpAddress: local.publicIpAddress,
      vncPort: local.ports?.vnc || 5900,
      websocketPort: local.ports?.websocket || 6080,
      vncPassword: 'local', // Local containers handle auth differently
      cpuCores: local.cpuCores,
      memoryGb: local.memoryGb,
      storageGb: local.storageGb,
      gpuEnabled: local.gpuEnabled,
      createdAt: local.createdAt,
      startedAt: local.status === 'running' ? new Date().toISOString() : undefined,
      stoppedAt: undefined,
      lastActiveAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      autoShutdownMinutes: 60,
      statusMessage: `Local Docker container on port ${local.ports?.vnc || 'N/A'}`,
      settings: {
        isLocal: true,
        provider: 'docker',
        ports: local.ports
      }
    }));
    
    // Combine all machines for display (cloud + electron + docker)
    const machines = [...allDbMachines, ...dockerMachines];

    // Get user's subscription tier and limits from database
    const { data: subscriptions } = await (supabase as any)
      .from("user_subscriptions")
      .select(`
        status,
        subscription_plans (
          tier,
          max_machines,
          max_cpu_cores,
          max_memory_gb,
          max_storage_gb,
          max_hours_per_month,
          gpu_access,
          allow_persistence,
          allow_snapshots,
          allow_custom_software
        )
      `)
      .eq("user_id", userId)
      .in("status", ["active", "trialing", "past_due"]);

    const subscription = subscriptions?.[0];
    const subscriptionPlan = subscription?.subscription_plans;
    const subscriptionTier = subscriptionPlan?.tier || null;

    // Get plan limits from database or use free tier defaults
    let baseLimits = {
      max_machines: 1,
      max_cpu_cores: 1,
      max_memory_gb: 3,
      max_storage_gb: 10,
      max_hours_per_month: 20,
      gpu_access: false,
      allow_persistence: false,
      allow_snapshots: false,
      allow_custom_software: false
    };

    if (subscriptionPlan) {
      baseLimits = {
        max_machines: subscriptionPlan.max_machines || 1,
        max_cpu_cores: subscriptionPlan.max_cpu_cores || 2,
        max_memory_gb: subscriptionPlan.max_memory_gb || 4,
        max_storage_gb: subscriptionPlan.max_storage_gb || 10,
        max_hours_per_month: subscriptionPlan.max_hours_per_month || 20,
        gpu_access: subscriptionPlan.gpu_access || false,
        allow_persistence: subscriptionPlan.allow_persistence || false,
        allow_snapshots: subscriptionPlan.allow_snapshots || false,
        allow_custom_software: subscriptionPlan.allow_custom_software || false
      };
    } else {
      // If no subscription, try to get free plan limits from database
      const { data: freePlan } = await (supabase as any)
        .from("subscription_plans")
        .select("*")
        .eq("tier", "free")
        .single();

      if (freePlan) {
        baseLimits = {
          max_machines: freePlan.max_machines || 1,
          max_cpu_cores: freePlan.max_cpu_cores || 1,
          max_memory_gb: freePlan.max_memory_gb || 3,
          max_storage_gb: freePlan.max_storage_gb || 10,
          max_hours_per_month: freePlan.max_hours_per_month || 20,
          gpu_access: freePlan.gpu_access || false,
          allow_persistence: freePlan.allow_persistence || false,
          allow_snapshots: freePlan.allow_snapshots || false,
          allow_custom_software: freePlan.allow_custom_software || false
        };
      }
    }
    
    // Still check database for any custom overrides
    const { data: limitsRows } = await supabase
      .from("machine_limits")
      .select("*")
      .eq("user_id", userId);
    
    const limitsData = limitsRows?.[0] || null;

    // Use database limits if they exist and are higher (for custom/grandfathered users)
    const effectiveLimits = limitsData ? {
      max_machines: Math.max(limitsData.max_machines || 0, baseLimits.max_machines),
      max_cpu_cores: Math.max(limitsData.max_cpu_cores || 0, baseLimits.max_cpu_cores),
      max_memory_gb: Math.max(limitsData.max_memory_gb || 0, baseLimits.max_memory_gb),
      max_storage_gb: Math.max(limitsData.max_storage_gb || 0, baseLimits.max_storage_gb),
    } : baseLimits;

    // Calculate current resource usage (only count cloud machines — exclude Electron/local)
    const totalCpuCores = cloudMachines.reduce((sum: number, m: any) => sum + (m?.cpuCores || 0), 0);
    const totalMemoryGb = cloudMachines.reduce((sum: number, m: any) => sum + (m?.memoryGb || 0), 0);
    const totalStorageGb = cloudMachines.reduce((sum: number, m: any) => sum + (m?.storageGb || 0), 0);

    // Check if user has a snapshot AMI available for restore
    // Query AWS directly — same source of truth used during actual restore
    let hasSnapshot = false;
    let snapshotDate: string | null = null;
    try {
      const awsService = getAwsEc2Service();
      const snapshotInfo = await awsService.findLatestUserSnapshotInfo(userId);
      if (snapshotInfo) {
        hasSnapshot = true;
        snapshotDate = snapshotInfo.createdAt;
      }
    } catch {
      // Non-critical — skip snapshot check
    }

    return NextResponse.json({
      machines: machines || [],
      limits: effectiveLimits,
      subscriptionTier,
      usage: {
        machines_count: cloudMachines.length,
        total_cpu_cores: totalCpuCores,
        total_memory_gb: totalMemoryGb,
        total_storage_gb: totalStorageGb,
      },
      snapshot: hasSnapshot ? { available: true, date: snapshotDate } : null,
    });
  } catch (error) {
    // Error in GET /api/machines
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST /api/machines - Create a new machine
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    if (!supabase) {
      return NextResponse.json({ error: "Database connection failed" }, { status: 500 });
    }
    
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = authData.user.id;
    const body: CreateMachineRequest = await request.json();
    const provider = body.provider || 'azure';

    // Validate request
    if (!body.displayName) {
      return NextResponse.json(
        { error: "Display name is required" },
        { status: 400 }
      );
    }

    // Check if user can create more machines (excluding Electron/local machines)
    // The RPC counts ALL user_machines entries, so we do our own check that
    // excludes Electron machines — they're the user's own computer and shouldn't
    // count towards cloud VM limits.
    const { data: allUserMachines } = await supabase
      .from("user_machines")
      .select("id, status, settings")
      .eq("user_id", userId)
      .not("status", "in", '("deleting","error")');

    const cloudMachineCount = (allUserMachines || []).filter((m: any) => {
      const s = typeof m.settings === 'string' ? JSON.parse(m.settings) : (m.settings || {});
      return s.provider !== 'electron' && !s.isLocal;
    }).length;

    // Get user's subscription tier and limits from database
    const { data: subscriptions } = await (supabase as any)
      .from("user_subscriptions")
      .select(`
        status,
        subscription_plans (
          tier,
          max_machines,
          max_cpu_cores,
          max_memory_gb,
          max_storage_gb,
          max_hours_per_month,
          gpu_access,
          allow_persistence,
          allow_snapshots,
          allow_custom_software
        )
      `)
      .eq("user_id", userId)
      .in("status", ["active", "trialing", "past_due"]);

    const subscription = subscriptions?.[0];
    const subscriptionPlan = subscription?.subscription_plans;
    const subscriptionTier = subscriptionPlan?.tier || null;

    // Get plan limits from database or use free tier defaults
    let baseLimits = {
      max_machines: 1,
      max_cpu_cores: 1,
      max_memory_gb: 3,
      max_storage_gb: 10,
      max_hours_per_month: 20,
      gpu_access: false,
      allow_persistence: false,
      allow_snapshots: false,
      allow_custom_software: false
    };

    if (subscriptionPlan) {
      baseLimits = {
        max_machines: subscriptionPlan.max_machines || 1,
        max_cpu_cores: subscriptionPlan.max_cpu_cores || 2,
        max_memory_gb: subscriptionPlan.max_memory_gb || 4,
        max_storage_gb: subscriptionPlan.max_storage_gb || 10,
        max_hours_per_month: subscriptionPlan.max_hours_per_month || 20,
        gpu_access: subscriptionPlan.gpu_access || false,
        allow_persistence: subscriptionPlan.allow_persistence || false,
        allow_snapshots: subscriptionPlan.allow_snapshots || false,
        allow_custom_software: subscriptionPlan.allow_custom_software || false
      };
    } else {
      // If no subscription, try to get free plan limits from database
      const { data: freePlan } = await (supabase as any)
        .from("subscription_plans")
        .select("*")
        .eq("tier", "free")
        .single();

      if (freePlan) {
        baseLimits = {
          max_machines: freePlan.max_machines || 1,
          max_cpu_cores: freePlan.max_cpu_cores || 1,
          max_memory_gb: freePlan.max_memory_gb || 3,
          max_storage_gb: freePlan.max_storage_gb || 10,
          max_hours_per_month: freePlan.max_hours_per_month || 20,
          gpu_access: freePlan.gpu_access || false,
          allow_persistence: freePlan.allow_persistence || false,
          allow_snapshots: freePlan.allow_snapshots || false,
          allow_custom_software: freePlan.allow_custom_software || false
        };
      }
    }
    
    // Still check database for any custom overrides
    const { data: limitsRows } = await supabase
      .from("machine_limits")
      .select("*")
      .eq("user_id", userId);
    
    const limitsData = limitsRows?.[0] || null;
    
    // Use database limits if they exist and are higher (for custom/grandfathered users)
    const effectiveLimits = limitsData ? {
      max_machines: Math.max(limitsData.max_machines || 0, baseLimits.max_machines),
      max_cpu_cores: Math.max(limitsData.max_cpu_cores || 0, baseLimits.max_cpu_cores),
      max_memory_gb: Math.max(limitsData.max_memory_gb || 0, baseLimits.max_memory_gb),
      max_storage_gb: Math.max(limitsData.max_storage_gb || 0, baseLimits.max_storage_gb),
    } : baseLimits;

    // Check cloud machine count against limit
    if (cloudMachineCount >= effectiveLimits.max_machines) {
      return NextResponse.json(
        { error: "Machine limit reached for your account" },
        { status: 403 }
      );
    }

    // Validate resources against limits and minimum requirements
    const isAws = provider === 'aws';
    const osType = (body as any).osType || 'linux';
    const isWindows = osType === 'windows';
    const isDesktop = isWindows || (isAws && body.desktopEnabled);
    const requestedCpu = isAws ? 2 : (body.cpuCores || 1);
    const requestedMemory = isDesktop ? 2 : (isAws ? 0.5 : (body.memoryGb || 3));
    const requestedStorage = body.storageGb || (isWindows ? 30 : (isDesktop ? 16 : (isAws ? 8 : 10)));

    // Enforce minimum requirements (only for Azure)
    if (!isAws && (requestedCpu < 1 || requestedMemory < 1)) {
      return NextResponse.json(
        { error: "Minimum requirements: 1 CPU core and 1GB memory" },
        { status: 400 }
      );
    }

    if (
      requestedCpu > effectiveLimits.max_cpu_cores ||
      requestedMemory > effectiveLimits.max_memory_gb ||
      requestedStorage > effectiveLimits.max_storage_gb
    ) {
      return NextResponse.json(
        { error: "Requested resources exceed your limits" },
        { status: 403 }
      );
    }

    // Generate the container/instance name using crypto-safe random bytes
    const uniqueId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
    const containerName = `vm-${userId.substring(0, 8)}-${uniqueId}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
    // Generate VNC password for Azure, AWS desktop, and Windows machines
    const needsVnc = !isAws || isDesktop || isWindows;
    let vncPassword = '';
    if (needsVnc) {
      vncPassword = generateSecureVncPassword(isWindows);
    }

    // First, create a placeholder in the database so it appears immediately
    const placeholderData = {
      user_id: userId,
      container_name: containerName,
      display_name: body.displayName,
      status: "creating" as const,
      azure_resource_group: isAws ? '' : (process.env.AZURE_RESOURCE_GROUP || "coasty-resources"),
      azure_container_group: isAws ? '' : containerName,
      vnc_password: vncPassword,
      vnc_port: isDesktop ? 5901 : (isAws ? 0 : 5901),
      websocket_port: isDesktop ? 6080 : (isAws ? 0 : 6080),
      cpu_cores: requestedCpu,
      memory_gb: requestedMemory,
      storage_gb: requestedStorage,
      gpu_enabled: false,
      settings: isAws
        ? { provider: 'aws' as const, sshUsername: isWindows ? 'Administrator' : 'ubuntu', desktopEnabled: isDesktop, osType }
        : {},
    };

    const { data: dbMachine, error: insertError } = await supabase
      .from("user_machines")
      .insert(placeholderData)
      .select()
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: "Failed to create machine" },
        { status: 500 }
      );
    }

    if (!dbMachine) {
      return NextResponse.json(
        { error: "Failed to create machine record" },
        { status: 500 }
      );
    }

    const machine = transformMachineFromDB(dbMachine);
    const machineId = machine?.id || dbMachine.id;

    if (isAws) {
      // AWS EC2 creation flow
      const awsService = getAwsEc2Service();
      const awsInstanceType = isWindows ? 't3.small' : (isDesktop ? 't4g.small' : 't4g.nano');

      (async () => {
        try {
          // Check if user has a previous machine snapshot to restore from
          // Only restore if user explicitly opted in (restoreFromSnapshot !== false)
          // Never restore Linux snapshots onto Windows machines (different arch + OS)
          let snapshotAmiId: string | undefined;
          if (body.restoreFromSnapshot !== false && !isWindows) {
            try {
              const latestSnapshot = await awsService.findLatestUserSnapshot(userId);
              if (latestSnapshot) {
                console.log(`Found snapshot AMI ${latestSnapshot} for user — restoring previous state`);
                snapshotAmiId = latestSnapshot;
              }
            } catch (snapErr: any) {
              console.warn("Failed to check for snapshots:", snapErr.message);
            }
          } else {
            console.log("User chose to start fresh — skipping snapshot restore");
          }

          console.log(`Creating AWS EC2 instance (${awsInstanceType}) with ${requestedStorage}GB storage${isDesktop ? ' + desktop' : ''}${snapshotAmiId ? ' [from snapshot]' : ''}`);

          const result = await awsService.createInstance(userId, {
            name: containerName,
            storageGb: requestedStorage,
            desktopEnabled: isDesktop,
            vncPassword: (isDesktop || isWindows) ? vncPassword : undefined,
            snapshotAmiId,
            osType: isWindows ? 'windows' : 'linux',
          });

          console.log(`AWS EC2 instance created: ${result.instanceId}`);

          // Provision a WorkMail mailbox for the machine (fire-and-forget)
          let emailIdentitySettings: Record<string, string> | undefined;
          try {
            const mailbox = await createSwarmMailbox(machineId, 0);
            if (mailbox) {
              emailIdentitySettings = {
                email: mailbox.email,
                password: mailbox.password,
                workmailUserId: mailbox.userId,
              };
              console.log(`Machine ${machineId}: provisioned email ${mailbox.email}`);
            }
          } catch (emailErr: any) {
            console.warn(`Machine ${machineId}: email provisioning failed:`, emailErr.message);
          }

          // Store AWS details in settings
          await supabase
            .from("user_machines")
            .update({
              settings: {
                provider: 'aws',
                osType,
                awsInstanceId: result.instanceId,
                awsRegion: process.env.AWS_REGION || 'us-east-1',
                awsKeyPairName: result.keyPairName,
                sshPrivateKey: result.privateKeyPem,
                sshUsername: isWindows ? 'Administrator' : 'ubuntu',
                awsInstanceType,
                desktopEnabled: isDesktop,
                desktopInitStatus: isDesktop ? 'installing' as const : undefined,
                agent_port: (isDesktop || isWindows) ? 8080 : undefined,
                ...(snapshotAmiId && {
                  restoredFromSnapshot: snapshotAmiId,
                  restoredAt: new Date().toISOString(),
                }),
                ...(emailIdentitySettings && {
                  email_identity: emailIdentitySettings,
                }),
              },
              ssh_port: isWindows ? undefined : 22,
            })
            .eq("id", machineId);

          // Poll for IP assignment
          let checkCount = 0;
          const checkInterval = setInterval(async () => {
            checkCount++;
            await updateMachineStatusAws(machineId, result.instanceId);

            const { data: updatedMachine } = await supabase
              .from("user_machines")
              .select("public_ip_address, status")
              .eq("id", machineId)
              .single();

            if (updatedMachine?.public_ip_address || checkCount > 24 || updatedMachine?.status === "error") {
              clearInterval(checkInterval);

              // If desktop enabled and IP assigned, poll for desktop readiness
              if (isDesktop && updatedMachine?.public_ip_address) {
                let desktopCheckCount = 0;
                const desktopCheckInterval = setInterval(async () => {
                  desktopCheckCount++;
                  try {
                    const res = await fetch(
                      `http://${updatedMachine.public_ip_address}:6080/`,
                      { signal: AbortSignal.timeout(3000) }
                    );
                    if (res.ok || res.status === 200) {
                      // Desktop is ready
                      const { data: m } = await supabase
                        .from("user_machines")
                        .select("settings")
                        .eq("id", machineId)
                        .single();
                      const currentSettings = (m?.settings || {}) as Record<string, any>;
                      await supabase
                        .from("user_machines")
                        .update({
                          settings: { ...currentSettings, desktopInitStatus: 'ready' },
                          status_message: 'Desktop ready',
                        })
                        .eq("id", machineId);
                      clearInterval(desktopCheckInterval);
                    }
                  } catch {
                    // noVNC not ready yet
                  }
                  if (desktopCheckCount > 90) {
                    // ~7.5 minutes - mark as failed
                    clearInterval(desktopCheckInterval);
                    const { data: m } = await supabase
                      .from("user_machines")
                      .select("settings")
                      .eq("id", machineId)
                      .single();
                    const currentSettings = (m?.settings || {}) as Record<string, any>;
                    if (currentSettings?.desktopInitStatus !== 'ready') {
                      await supabase
                        .from("user_machines")
                        .update({
                          settings: { ...currentSettings, desktopInitStatus: 'failed' },
                          status_message: 'Desktop setup may have failed. Check /var/log/desktop-setup.log via SSH.',
                        })
                        .eq("id", machineId);
                    }
                  }
                }, 5000);
              }
            }
          }, 5000);

        } catch (awsError: any) {
          console.error("AWS EC2 instance creation failed:", awsError);

          await supabase
            .from("user_machines")
            .update({
              status: "error",
              status_message: awsError.message || "Failed to create EC2 instance",
            })
            .eq("id", machineId);

          setTimeout(async () => {
            await supabase
              .from("user_machines")
              .delete()
              .eq("id", machineId)
              .eq("status", "error");
          }, 30000);
        }
      })();

      return NextResponse.json({
        machine,
        connectionDetails: {
          sshPort: 22,
          sshUsername: 'ubuntu',
          ...(isDesktop ? { password: vncPassword } : {}),
        },
      });
    }

    // Azure creation flow (existing)
    const azureService = getAzureContainerService();

    (async () => {
      try {
        console.log(`Creating Azure container with ${requestedCpu} vCPU, ${requestedMemory}GB RAM`);

        const containerResult = await azureService.createDesktopContainer(userId, {
          cpu: requestedCpu,
          memoryGb: requestedMemory,
          containerName: containerName,
          vncPassword: vncPassword,
        });

        console.log(`Azure container created successfully`);

        await supabase
          .from("user_machines")
          .update({
            azure_resource_id: containerResult.resourceId,
          })
          .eq("id", machineId);

        await updateMachineStatus(machineId, containerName);

        let checkCount = 0;
        const checkInterval = setInterval(async () => {
          checkCount++;
          await updateMachineStatus(machineId, containerName);

          const { data: updatedMachine } = await supabase
            .from("user_machines")
            .select("public_ip_address, status")
            .eq("id", machineId)
            .single();

          if (updatedMachine?.public_ip_address || checkCount > 12 || updatedMachine?.status === "error") {
            clearInterval(checkInterval);
          }
        }, 5000);

      } catch (azureError: any) {
        await supabase
          .from("user_machines")
          .update({
            status: "error",
            status_message: azureError.message || "Failed to create container",
          })
          .eq("id", machineId);

        setTimeout(async () => {
          await supabase
            .from("user_machines")
            .delete()
            .eq("id", machineId)
            .eq("status", "error");
        }, 30000);
      }
    })();

      return NextResponse.json({
        machine,
        connectionDetails: {
          vncUrl: `vnc://localhost:5901`,
          websocketUrl: `wss://${request.headers.get("host")}/api/machines/${machineId}/vnc`,
          password: vncPassword,
        },
      });
  } catch (error) {
    // Error in POST /api/machines
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Generate a cryptographically secure VNC password.
 * Uses crypto.randomBytes instead of Math.random to prevent prediction.
 */
function generateSecureVncPassword(isWindows: boolean): string {
  if (isWindows) {
    // Windows Server requires password complexity: uppercase + lowercase + digit + special char.
    // IMPORTANT: Only use special chars safe in PowerShell/batch/URLs/registry.
    const lower = 'abcdefghijkmnpqrstuvwxyz';
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const digits = '23456789';
    const special = '-_=+';
    const all = lower + upper + digits + special;

    // Guarantee one from each category
    const randomBytes = crypto.randomBytes(16 + 4); // 4 for categories, 12 for fill, 4 for shuffle
    const chars: string[] = [
      lower[randomBytes[0] % lower.length],
      upper[randomBytes[1] % upper.length],
      digits[randomBytes[2] % digits.length],
      special[randomBytes[3] % special.length],
    ];
    // Fill remaining 12 chars
    for (let i = 0; i < 12; i++) {
      chars.push(all[randomBytes[4 + i] % all.length]);
    }
    // Fisher-Yates shuffle with crypto randomness
    const shuffleBytes = crypto.randomBytes(chars.length * 2);
    for (let i = chars.length - 1; i > 0; i--) {
      const j = shuffleBytes.readUInt16BE(i * 2) % (i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  } else {
    // 20 bytes = 40 hex chars of entropy (much stronger than Math.random)
    return crypto.randomBytes(15).toString('base64url');
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
    
    const status = await azureService.getContainerStatus(containerGroupName);
    
    const updateData: any = {
      status: status.state,
      status_message: status.message,
    };
    
    if (status.ipAddress) {
      updateData.public_ip_address = status.ipAddress;
    }
    
    if (status.state === "running") {
      updateData.started_at = new Date().toISOString();
    }
    
    await supabase
      .from("user_machines")
      .update(updateData)
      .eq("id", machineId);
      
  } catch (error) {
    // Error updating machine status
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

    const status = await awsService.getInstanceStatus(instanceId);

    const updateData: any = {
      status: status.state,
      status_message: status.message,
    };

    if (status.ipAddress) {
      updateData.public_ip_address = status.ipAddress;
    }

    if (status.state === "running") {
      updateData.started_at = new Date().toISOString();
    }

    await supabase
      .from("user_machines")
      .update(updateData)
      .eq("id", machineId);

  } catch (error) {
    // Error updating AWS machine status
  }
}