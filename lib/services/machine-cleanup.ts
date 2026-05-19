import { createServiceClient } from "@/lib/supabase/service";
import { deleteSwarmMailbox } from "@/lib/services/workmail-service";
import { withCronLock } from "@/lib/services/cross-replica-lock";
import {
  runAgentHealthCheck,
  type AgentHealthCheckStats,
} from "@/lib/services/agent-health-check";

interface CleanupStats {
  deleted: number;
  errors: number;
  processed: number;
}

// Cross-replica lock bucket sizes (in minutes). The interval loop fires every
// 2 hours, so a 120-min bucket means each cycle's runs (across all replicas)
// race for the same lock; exactly one replica wins per cycle.
const CLEANUP_BUCKET_MINUTES = 120;

// The agent-health-check cron runs much more frequently (every 2 minutes)
// than the heavy cleanup jobs above. Its bucket size matches its tick rate
// so each tick across all replicas races for one lock, and exactly one
// replica polls the backend + runs the SSM/EC2 remediation per cycle.
//
// Why a separate constant: the 2-hour cron is fundamentally
// "snapshot-and-delete free user machines"; the 2-min cron is
// "self-heal unresponsive agents." They don't share a cadence or a
// failure model, so coupling them via a shared bucket would be wrong.
const AGENT_HEALTH_CHECK_BUCKET_MINUTES = 2;

export class MachineCleanupService {
  private intervalId: NodeJS.Timeout | null = null;
  private agentHealthIntervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor() {}

  /**
   * Start the periodic cleanup service.
   *
   * Two cadences:
   *   * Heavy cleanup (snapshot, free-user purge, swarm reap) — every 2 hours
   *   * Agent health check (post-incident 2026-05-17) — every 2 minutes
   *
   * Both share the same cross-replica leader-election helper
   * (`withCronLock`) but with different bucket sizes so they elect leaders
   * independently. The agent-health-check job is intentionally short and
   * idempotent — even if the lock briefly slips between replicas (e.g. row
   * deletion between buckets), the worst case is "we try SSM restart twice"
   * which is harmless.
   */
  start() {
    if (this.intervalId) {
      console.log("Machine cleanup service is already running");
      return;
    }

    console.log("Starting machine cleanup service - runs every 2 hours");

    // Run immediately on start. All inner cleanups are wrapped in a
    // cross-replica advisory lock (cron_runs table + 23505 unique-violation)
    // so only one Next.js replica actually executes per bucket. See
    // lib/services/cross-replica-lock.ts and migration 013 for details.
    this.runCleanupLocked();
    this.cleanupLiteMachinesLocked();
    this.runPeriodicSnapshotsLocked();
    this.cleanupSwarmMachinesLocked();

    // Then run every 2 hours (2 * 60 * 60 * 1000 ms)
    this.intervalId = setInterval(() => {
      this.runCleanupLocked();
      this.cleanupLiteMachinesLocked();
      this.runPeriodicSnapshotsLocked();
      this.cleanupSwarmMachinesLocked();
    }, 2 * 60 * 60 * 1000);

    // Agent-health auto-recovery loop. Kill switch: setting
    // DISABLE_AGENT_AUTO_REPLACE=true at the env layer keeps the cron
    // mounted (for telemetry) but the inner runAgentHealthCheck no-ops
    // — see lib/services/agent-health-check.ts for the gate.
    console.log("Starting agent-health auto-recovery loop - runs every 2 minutes");
    this.runAgentHealthCheckLocked();
    this.agentHealthIntervalId = setInterval(() => {
      this.runAgentHealthCheckLocked();
    }, 2 * 60 * 1000);
  }

  /**
   * Cross-replica-locked wrapper for runCleanup. Only the replica that wins
   * the cron_runs INSERT for this bucket actually runs the work; other
   * replicas log + skip. Fail-safe: if the DB / migration is unavailable,
   * the lock returns null and we skip rather than risk the original
   * double-execution race.
   */
  private async runCleanupLocked(): Promise<void> {
    await withCronLock("runCleanup", CLEANUP_BUCKET_MINUTES, async (report) => {
      const stats = await this.runCleanup();
      report({ deleted: stats.deleted, errors: stats.errors, processed: stats.processed });
    });
  }

  /**
   * Cross-replica-locked wrapper for cleanupLiteMachines.
   */
  private async cleanupLiteMachinesLocked(): Promise<void> {
    await withCronLock("cleanupLiteMachines", CLEANUP_BUCKET_MINUTES, async () => {
      await this.cleanupLiteMachines();
    });
  }

  /**
   * Cross-replica-locked wrapper for runPeriodicSnapshots. This is the
   * concrete cron the 2026-05-02 NEW-3 audit caught firing on both replicas
   * → 6× InvalidAMIName.Duplicate. The lock makes only one replica run
   * createMachineImage per bucket; the AMI-name jitter in
   * lib/aws/ec2-service.ts is defense-in-depth for the rest.
   */
  private async runPeriodicSnapshotsLocked(): Promise<void> {
    await withCronLock("runPeriodicSnapshots", CLEANUP_BUCKET_MINUTES, async () => {
      await this.runPeriodicSnapshots();
    });
  }

  /**
   * Cross-replica-locked wrapper for cleanupSwarmMachines.
   */
  private async cleanupSwarmMachinesLocked(): Promise<void> {
    await withCronLock("cleanupSwarmMachines", CLEANUP_BUCKET_MINUTES, async () => {
      await this.cleanupSwarmMachines();
    });
  }

  /**
   * Cross-replica-locked wrapper for `runAgentHealthCheck`.
   *
   * Background — 2026-05-17 incident
   * --------------------------------
   * A single EC2 cloud VM agent died but the EC2 instance stayed "running".
   * The backend retried 7× per call (~38s each) and produced 91 dial
   * timeouts in CloudWatch over 24 minutes. NO alarm fired, NO recovery
   * kicked in, the user's CUA session sat broken. The only available
   * recovery path was the user manually stopping + relaunching the machine.
   *
   * Fix
   * ---
   * vm_control.py now flips an `agent_unresponsive` circuit breaker after
   * 3 consecutive dial failures within 5 minutes. /api/internal/vm-health
   * lists the flagged machines. This cron polls that endpoint every 2 min
   * (under a cross-replica lock so only one Next.js replica per bucket
   * issues SSM commands) and for each entry:
   *   1. SSM RunCommand `systemctl restart ai-agent.service`. Wait 60s.
   *   2. If still flagged: terminate + relaunch the EC2 instance, update
   *      Supabase, notify the user via WebSocket.
   *
   * `withCronLock` returns `false` when this replica didn't win the lock —
   * we report nothing in that case because the winning replica will write
   * the cron_runs row with the real numbers.
   */
  private async runAgentHealthCheckLocked(): Promise<void> {
    await withCronLock(
      "runAgentHealthCheck",
      AGENT_HEALTH_CHECK_BUCKET_MINUTES,
      async (report) => {
        const stats: AgentHealthCheckStats = await runAgentHealthCheck();
        report({
          polled: stats.polled,
          ssmRestarted: stats.ssmRestarted,
          ec2Replaced: stats.ec2Replaced,
          errors: stats.errors,
          skipped: stats.skipped,
        });
      }
    );
  }

  /**
   * Stop the cleanup service
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("Machine cleanup service stopped");
    }
    if (this.agentHealthIntervalId) {
      clearInterval(this.agentHealthIntervalId);
      this.agentHealthIntervalId = null;
      console.log("Agent-health auto-recovery loop stopped");
    }
  }

  /**
   * Run the cleanup process
   */
  private async runCleanup(): Promise<CleanupStats> {
    if (this.isRunning) {
      console.log("Cleanup already in progress, skipping...");
      return { deleted: 0, errors: 0, processed: 0 };
    }

    this.isRunning = true;
    console.log("Starting machine cleanup for free users...");

    const stats: CleanupStats = {
      deleted: 0,
      errors: 0,
      processed: 0
    };

    try {
      const supabase = createServiceClient();
      if (!supabase) {
        throw new Error("Failed to create Supabase service client");
      }

      // Find machines from free users that are older than 2 hours
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

      // Use the same pattern as other parts of the codebase to bypass TypeScript issues
      const { data: expiredMachines, error: queryError } = await (supabase as any)
        .from("user_machines")
        .select(`
          id,
          user_id,
          container_name,
          display_name,
          settings,
          status,
          created_at,
          users!inner (
            user_subscriptions (
              status,
              subscription_plans (
                tier
              )
            )
          )
        `)
        .lt('created_at', twoHoursAgo)
        .neq('status', 'deleting')
        .neq('status', 'error');

      if (queryError) {
        throw new Error(`Failed to query expired machines: ${queryError.message}`);
      }

      if (!expiredMachines || expiredMachines.length === 0) {
        console.log("No expired machines found for cleanup");
        return stats;
      }

      // Filter for free users only, and skip electron/local machines
      const freeuserMachines = expiredMachines.filter((machine: any) => {
        // Never delete electron (desktop app) or local Docker machines
        const settings = machine.settings as any;
        if (settings?.provider === 'electron' || settings?.isLocal) {
          return false;
        }

        const userSubscriptions = (machine.users as any)?.user_subscriptions;

        // If no subscriptions, user is free
        if (!userSubscriptions || userSubscriptions.length === 0) {
          return true;
        }

        // Check if user has active paid subscription
        const hasActivePaidSubscription = userSubscriptions.some((sub: any) =>
          sub.status === 'active' &&
          sub.subscription_plans?.tier &&
          sub.subscription_plans.tier !== 'free'
        );

        // Only cleanup machines for users without active paid subscriptions
        return !hasActivePaidSubscription;
      });

      console.log(`Found ${freeuserMachines.length} machines from free users to cleanup`);
      stats.processed = freeuserMachines.length;

      // Process each machine
      for (const machine of freeuserMachines) {
        try {
          await this.deleteMachine(machine, supabase);
          stats.deleted++;
          console.log(`Deleted machine: ${machine.display_name} (${machine.id})`);
        } catch (error) {
          stats.errors++;
          console.error(`Failed to delete machine ${machine.id}:`, error);
        }
      }

      console.log(`Cleanup completed: ${stats.deleted} deleted, ${stats.errors} errors`);

    } catch (error) {
      console.error("Machine cleanup failed:", error);
      stats.errors++;
    } finally {
      this.isRunning = false;
    }

    return stats;
  }

  /**
   * Delete machines belonging to Lite-tier users that are older than 48 hours.
   * Lite users get persistent machines but they expire after 48 hours,
   * unlike higher tiers (starter/professional/enterprise) which persist indefinitely.
   */
  private async cleanupLiteMachines(): Promise<void> {
    try {
      const supabase = createServiceClient();
      if (!supabase) return;

      const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

      const { data: expiredMachines, error } = await (supabase as any)
        .from("user_machines")
        .select(`
          id,
          user_id,
          container_name,
          display_name,
          settings,
          status,
          created_at,
          users!inner (
            user_subscriptions (
              status,
              subscription_plans (
                tier
              )
            )
          )
        `)
        .lt('created_at', fortyEightHoursAgo)
        .neq('status', 'deleting')
        .neq('status', 'error');

      if (error || !expiredMachines || expiredMachines.length === 0) return;

      // Filter to only Lite-tier users
      const liteMachines = expiredMachines.filter((machine: any) => {
        const settings = machine.settings as any;
        if (settings?.provider === 'electron' || settings?.isLocal || settings?.is_swarm) {
          return false;
        }

        const userSubscriptions = (machine.users as any)?.user_subscriptions;
        if (!userSubscriptions || userSubscriptions.length === 0) return false;

        // Check if user's ONLY active subscription is lite
        const activeSubs = userSubscriptions.filter((sub: any) => sub.status === 'active');
        return activeSubs.length > 0 && activeSubs.every((sub: any) =>
          sub.subscription_plans?.tier === 'lite'
        );
      });

      if (liteMachines.length === 0) return;

      console.log(`Found ${liteMachines.length} Lite-tier machines older than 48 hours to clean up`);

      for (const machine of liteMachines) {
        try {
          await this.deleteMachine(machine, supabase);
          console.log(`Lite cleanup: deleted ${machine.display_name} (${machine.id})`);
        } catch (err) {
          console.error(`Lite cleanup: failed to delete ${machine.id}:`, err);
        }
      }
    } catch (err) {
      console.error("Lite machine cleanup failed:", err);
    }
  }

  /**
   * Periodically snapshot running AWS machines (every 6 hours).
   * Runs alongside cleanup but only creates snapshots — never terminates.
   */
  private async runPeriodicSnapshots(): Promise<void> {
    try {
      const supabase = createServiceClient();
      if (!supabase) return;

      // Find all running AWS machines
      const { data: machines } = await (supabase as any)
        .from("user_machines")
        .select("id, user_id, display_name, settings, started_at")
        .eq("status", "running");

      if (!machines || machines.length === 0) return;

      const awsMachines = machines.filter((m: any) => {
        const s = m.settings as any;
        return s?.provider === "aws" && s?.awsInstanceId && s?.desktopEnabled;
      });

      if (awsMachines.length === 0) return;

      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

      for (const machine of awsMachines) {
        const settings = machine.settings as any;

        // Check if there's already a recent snapshot (within 6 hours)
        const { data: recentSnaps } = await (supabase as any)
          .from("machine_snapshots")
          .select("id, created_at")
          .eq("user_id", machine.user_id)
          .gt("created_at", sixHoursAgo)
          .limit(1);

        if (recentSnaps && recentSnaps.length > 0) {
          continue; // Already has a recent snapshot
        }

        try {
          const { getAwsEc2Service } = await import("@/lib/aws/ec2-service");
          const awsService = getAwsEc2Service();

          const snapshot = await awsService.createMachineImage(
            settings.awsInstanceId,
            machine.user_id,
            machine.display_name
          );

          // createMachineImage returns null when the instance has been
          // terminated or is in a non-snapshottable state — racy with the
          // lite-machine cleanup loop. Treat as a benign skip rather than
          // an error so we don't pollute logs with an InvalidParameterValue
          // traceback per audit window.
          if (!snapshot) {
            continue;
          }

          await (supabase as any).from("machine_snapshots").insert({
            machine_id: machine.id,
            user_id: machine.user_id,
            snapshot_name: snapshot.name,
            snapshot_type: "auto",
            storage_location: snapshot.amiId,
            size_gb: settings.storageGb || 16,
            os_state: {
              provider: "aws",
              region: settings.awsRegion || process.env.AWS_REGION || "us-east-1",
              source_instance: settings.awsInstanceId,
              desktop_enabled: settings.desktopEnabled,
            },
          });

          console.log(`Periodic snapshot created for machine ${machine.display_name}: ${snapshot.amiId}`);

          // Keep only latest 2 snapshots per user
          await awsService.cleanupOldSnapshots(machine.user_id, 2);
        } catch (snapErr) {
          console.warn(`Periodic snapshot failed for machine ${machine.id}:`, snapErr);
        }
      }
    } catch (error) {
      console.error("Periodic snapshots failed:", error);
    }
  }

  /**
   * Delete any swarm machines older than 30 minutes.
   * Swarm machines are temporary and MUST always be cleaned up regardless
   * of user tier.  They are identified by settings.is_swarm === true.
   */
  private async cleanupSwarmMachines(): Promise<void> {
    try {
      const supabase = createServiceClient();
      if (!supabase) return;

      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

      const { data: machines, error } = await (supabase as any)
        .from("user_machines")
        .select("id, user_id, display_name, settings, status, created_at")
        .lt("created_at", thirtyMinAgo)
        .neq("status", "deleting");

      if (error || !machines || machines.length === 0) return;

      const swarmMachines = machines.filter((m: any) => {
        const s = m.settings as any;
        // Only clean up temporary swarm machines — persistent swarm machines
        // follow normal machine lifecycle (no auto-deletion)
        return s?.is_swarm === true && !s?.persistent_swarm;
      });

      if (swarmMachines.length === 0) return;

      console.log(`Found ${swarmMachines.length} orphaned swarm machines to clean up`);

      for (const machine of swarmMachines) {
        try {
          // No snapshots for swarm machines — just terminate and delete
          await this.deleteMachine(machine, supabase);
          console.log(`Swarm cleanup: deleted ${machine.display_name} (${machine.id})`);
        } catch (err) {
          console.error(`Swarm cleanup: failed to delete ${machine.id}:`, err);
        }
      }
    } catch (err) {
      console.error("Swarm machine cleanup failed:", err);
    }
  }

  /**
   * Delete a single machine (terminate EC2 instance + delete database record)
   */
  private async deleteMachine(machine: any, supabase: any): Promise<void> {
    try {
      // First, update status to deleting to prevent conflicts
      await (supabase as any)
        .from("user_machines")
        .update({ status: 'deleting' })
        .eq('id', machine.id);

      // Terminate AWS EC2 instance if applicable
      const settings = machine.settings as any;
      if (settings?.provider === 'aws' && settings?.awsInstanceId) {
        try {
          // Dynamic import to avoid pulling Node.js modules (zlib) into Edge Runtime
          const { getAwsEc2Service } = await import("@/lib/aws/ec2-service");
          const awsService = getAwsEc2Service();

          // Snapshot the instance before termination so user can restore later
          // Skip snapshots for swarm machines — they're temporary throwaway instances
          if (settings?.is_swarm) {
            console.log(`Skipping snapshot for swarm machine ${machine.id}`);
          } else try {
            const snapshot = await awsService.createMachineImage(
              settings.awsInstanceId,
              machine.user_id,
              machine.display_name
            );
            // null = instance already terminated/non-snapshottable. Race-safe skip.
            if (snapshot) {
              console.log(`Created pre-termination snapshot: ${snapshot.amiId}`);

              await (supabase as any).from("machine_snapshots").insert({
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

              await awsService.cleanupOldSnapshots(machine.user_id, 2);
            }
          } catch (snapError) {
            console.warn(`Failed to snapshot instance ${settings.awsInstanceId}:`, snapError);
            // Continue with termination — snapshot failure shouldn't block cleanup
          }

          await awsService.terminateInstance(settings.awsInstanceId, settings.awsKeyPairName);
          console.log(`Terminated EC2 instance: ${settings.awsInstanceId}`);
        } catch (awsError) {
          console.warn(`Failed to terminate EC2 instance ${settings.awsInstanceId} for machine ${machine.id}:`, awsError);
          // Continue with DB deletion — instance may already be gone
        }
      }

      // Clean up WorkMail mailbox if one was provisioned
      if (settings?.email_identity?.workmailUserId) {
        try {
          await deleteSwarmMailbox(settings.email_identity.workmailUserId);
          console.log(`Deleted WorkMail mailbox for machine ${machine.id}`);
        } catch (mailErr) {
          console.warn(`Failed to delete WorkMail mailbox for machine ${machine.id}:`, mailErr);
        }
      }

      // Delete from database
      const { error: deleteError } = await (supabase as any)
        .from("user_machines")
        .delete()
        .eq('id', machine.id);

      if (deleteError) {
        throw new Error(`Failed to delete machine from database: ${deleteError.message}`);
      }

    } catch (error) {
      // If deletion fails, reset status back to original
      try {
        await (supabase as any)
          .from("user_machines")
          .update({ status: machine.status })
          .eq('id', machine.id);
      } catch (resetError) {
        console.error(`Failed to reset machine status for ${machine.id}:`, resetError);
      }
      throw error;
    }
  }

  /**
   * Manual cleanup trigger (for testing or admin use)
   */
  async runManualCleanup(): Promise<CleanupStats> {
    console.log("Running manual machine cleanup...");
    return await this.runCleanup();
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      hasScheduledCleanup: this.intervalId !== null,
      nextCleanupIn: this.intervalId ? "Within 2 hours" : "Not scheduled",
      hasScheduledAgentHealthCheck: this.agentHealthIntervalId !== null,
      nextAgentHealthCheckIn: this.agentHealthIntervalId ? "Within 2 minutes" : "Not scheduled",
    };
  }
}

// Singleton instance
let cleanupService: MachineCleanupService | null = null;

export function getMachineCleanupService(): MachineCleanupService {
  if (!cleanupService) {
    cleanupService = new MachineCleanupService();
  }
  return cleanupService;
}