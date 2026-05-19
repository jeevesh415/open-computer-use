/**
 * Machine Cleanup Utility Functions
 *
 * This module provides utilities for managing automated cleanup of free tier machines
 * that have been running for more than 2 hours.
 */

import { createClient } from "@/lib/supabase/server";

export interface CleanupResult {
  machineId: string;
  displayName: string;
  userId: string;
  success: boolean;
  error?: string;
  startedAt?: string;
  runningDuration?: string;
}

export interface CleanupSummary {
  totalCandidates: number;
  freeUserMachines: number;
  deleted: number;
  failed: number;
  results: CleanupResult[];
}

/**
 * Get machines that are candidates for cleanup (running > 2 hours)
 */
export async function getCleanupCandidates(): Promise<{
  machines: any[];
  userTiers: Map<string, string>;
}> {
  const supabase = await createClient();
  if (!supabase) {
    throw new Error("Database connection failed");
  }

  const twoHoursAgo = new Date();
  twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);

  // Get all running machines older than 2 hours
  const { data: machines, error: machinesError } = await supabase
    .from("user_machines")
    .select(`
      id,
      user_id,
      container_name,
      display_name,
      status,
      started_at,
      settings
    `)
    .eq("status", "running")
    .lt("started_at", twoHoursAgo.toISOString());

  if (machinesError) {
    throw new Error(`Failed to fetch machines: ${machinesError.message}`);
  }

  if (!machines || machines.length === 0) {
    return { machines: [], userTiers: new Map() };
  }

  // Get subscription tiers for all users
  const userIds = [...new Set(machines.map((m: any) => m.user_id))];

  // Use the same pattern as other parts of the codebase to bypass TypeScript issues
  const { data: subscriptions } = await (supabase as any)
    .from("user_subscriptions")
    .select(`
      user_id,
      status,
      subscription_plans (tier)
    `)
    .in("user_id", userIds)
    .in("status", ["active", "trialing", "past_due"]);

  // Create user tier mapping
  const userTiers = new Map<string, string>();
  subscriptions?.forEach((sub: any) => {
    if (sub.subscription_plans?.tier) {
      userTiers.set(sub.user_id, sub.subscription_plans.tier);
    }
  });

  return { machines, userTiers };
}

/**
 * Calculate how long a machine has been running
 */
export function calculateRunningDuration(startedAt: string): string {
  const start = new Date(startedAt);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  return `${hours}h ${minutes}m`;
}

/**
 * Delete a single machine (terminate EC2 instance + delete database record)
 */
export async function deleteMachine(machine: any): Promise<CleanupResult> {
  const result: CleanupResult = {
    machineId: machine.id,
    displayName: machine.display_name,
    userId: machine.user_id,
    success: false,
    startedAt: machine.started_at,
    runningDuration: calculateRunningDuration(machine.started_at)
  };

  try {
    // Terminate AWS EC2 instance if applicable
    const settings = machine.settings as any;
    if (settings?.provider === 'aws' && settings?.awsInstanceId) {
      try {
        // Dynamic import to avoid pulling Node.js modules (zlib) into Edge Runtime
        const { getAwsEc2Service } = await import("@/lib/aws/ec2-service");
        const awsService = getAwsEc2Service();

        // Snapshot the instance before termination so user can restore later
        try {
          const snapshot = await awsService.createMachineImage(
            settings.awsInstanceId,
            machine.user_id,
            machine.display_name
          );
          // null = instance already terminated/in non-snapshottable state.
          // Skip the DB write but proceed with the rest of cleanup.
          if (snapshot) {
            console.log(`Created pre-termination snapshot: ${snapshot.amiId}`);

            // Store snapshot reference in database
            const supabaseForSnapshot = await createClient();
            if (supabaseForSnapshot) {
              await supabaseForSnapshot.from("machine_snapshots").insert({
                machine_id: machine.id,
                user_id: machine.user_id,
                snapshot_name: snapshot.name,
                snapshot_type: "pre_shutdown",
                storage_location: snapshot.amiId,
                size_gb: settings.storageGb || 16,
                os_state: {
                  provider: "aws",
                  region: settings.awsRegion || process.env.AWS_REGION || "us-east-1",
                  source_instance: settings.awsInstanceId,
                  desktop_enabled: settings.desktopEnabled,
                },
              });
            }

            // Clean up old snapshots (keep latest 2)
            await awsService.cleanupOldSnapshots(machine.user_id, 2);
          }
        } catch (snapError: any) {
          console.warn(`Failed to snapshot instance ${settings.awsInstanceId}:`, snapError.message);
          // Continue with termination — snapshot failure shouldn't block cleanup
        }

        await awsService.terminateInstance(settings.awsInstanceId, settings.awsKeyPairName);
        console.log(`Terminated EC2 instance: ${settings.awsInstanceId}`);
      } catch (awsError: any) {
        console.warn(`Failed to terminate EC2 instance ${settings.awsInstanceId}:`, awsError.message);
        // Continue with DB deletion — instance may already be gone
      }
    }

    // Delete from database
    const supabase = await createClient();
    if (!supabase) {
      throw new Error("Database connection failed");
    }

    const { error: deleteError } = await supabase
      .from("user_machines")
      .delete()
      .eq("id", machine.id);

    if (deleteError) {
      throw new Error(`Database deletion failed: ${deleteError.message}`);
    }

    result.success = true;
    console.log(`Machine ${machine.display_name} (${result.runningDuration}) deleted successfully`);

  } catch (error: any) {
    result.error = error.message;
    console.error(`Failed to delete machine ${machine.id}:`, error.message);
  }

  return result;
}

/**
 * Perform cleanup of free tier machines
 */
export async function performCleanup(): Promise<CleanupSummary> {
  try {
    const { machines, userTiers } = await getCleanupCandidates();

    const summary: CleanupSummary = {
      totalCandidates: machines.length,
      freeUserMachines: 0,
      deleted: 0,
      failed: 0,
      results: []
    };

    if (machines.length === 0) {
      console.log("No machines older than 2 hours found");
      return summary;
    }

    // Filter to only free tier users, and skip electron/local machines
    const freeUserMachines = machines.filter(machine => {
      const settings = machine.settings as any;
      if (settings?.provider === 'electron' || settings?.isLocal) {
        return false;
      }
      const userTier = userTiers.get(machine.user_id) || "free";
      return userTier === "free";
    });

    summary.freeUserMachines = freeUserMachines.length;

    if (freeUserMachines.length === 0) {
      console.log("No free tier machines to cleanup");
      return summary;
    }

    console.log(`Found ${freeUserMachines.length} free tier machines to delete`);

    // Delete machines sequentially with delay
    for (const machine of freeUserMachines) {
      const result = await deleteMachine(machine);
      summary.results.push(result);

      if (result.success) {
        summary.deleted++;
      } else {
        summary.failed++;
      }

      // Small delay between deletions
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`Cleanup completed: ${summary.deleted} deleted, ${summary.failed} failed`);
    return summary;

  } catch (error: any) {
    console.error("Cleanup failed:", error);
    throw error;
  }
}

/**
 * Get cleanup statistics without performing cleanup
 */
export async function getCleanupStats(): Promise<{
  candidateMachines: number;
  freeUserMachines: number;
  machineDetails: Array<{
    id: string;
    displayName: string;
    userTier: string;
    runningDuration: string;
  }>;
}> {
  const { machines, userTiers } = await getCleanupCandidates();

  const freeUserMachines = machines.filter(machine => {
    const userTier = userTiers.get(machine.user_id) || "free";
    return userTier === "free";
  });

  const machineDetails = machines.map(machine => ({
    id: machine.id,
    displayName: machine.display_name,
    userTier: userTiers.get(machine.user_id) || "free",
    runningDuration: calculateRunningDuration(machine.started_at)
  }));

  return {
    candidateMachines: machines.length,
    freeUserMachines: freeUserMachines.length,
    machineDetails
  };
}