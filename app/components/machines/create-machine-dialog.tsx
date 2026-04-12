"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Clock, Monitor, ArrowRight, History, Plus } from "lucide-react";
import { useAccountDialog } from "@/lib/account-dialog-store";
import { LinuxIcon, WindowsIcon } from "@/components/icons/platform-icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { trackVmCreated } from "@/lib/posthog/analytics";
import { NoiseBackground } from "@/components/ui/noise-background";
import { useSubscription } from "@/hooks/use-subscription";
import type { UserMachine } from "@/types/machines.types";

interface CreateMachineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMachineCreated: () => void;
}

interface MachineLimits {
  max_machines: number;
  max_cpu_cores: number;
  max_memory_gb: number;
  max_storage_gb: number;
}

interface MachineApiResponse {
  machines: UserMachine[];
  limits: MachineLimits;
  subscriptionTier?: string | null;
  usage: MachineUsage;
  snapshot?: { available: boolean; date: string } | null;
}

interface MachineUsage {
  machines_count: number;
  total_cpu_cores: number;
  total_memory_gb: number;
  total_storage_gb: number;
}

export function CreateMachineDialog({
  open,
  onOpenChange,
  onMachineCreated,
}: CreateMachineDialogProps) {
  const t = useTranslations("createMachine");
  const { isFreeTier, loading: subscriptionLoading } = useSubscription();
  const [creating, setCreating] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [osType, setOsType] = useState<'linux' | 'windows'>('linux');
  const [desktopEnabled, setDesktopEnabled] = useState(true);
  const [storageGb, setStorageGb] = useState(16);
  const [limits, setLimits] = useState<MachineLimits | null>(null);
  const [usage, setUsage] = useState<MachineUsage | null>(null);
  const [subscriptionTier, setSubscriptionTier] = useState<string | null>(null);
  const [loadingLimits, setLoadingLimits] = useState(false);
  const [snapshotAvailable, setSnapshotAvailable] = useState(false);
  const [snapshotDate, setSnapshotDate] = useState<string | null>(null);
  const [restoreFromSnapshot, setRestoreFromSnapshot] = useState(true);

  useEffect(() => {
    if (open) {
      fetchLimitsAndUsage();
    }
  }, [open]);

  const fetchLimitsAndUsage = async () => {
    try {
      setLoadingLimits(true);
      const response = await fetch("/api/machines");
      if (response.ok) {
        const data: MachineApiResponse = await response.json();
        setLimits(data.limits);
        setUsage(data.usage);
        setSubscriptionTier(data.subscriptionTier || null);
        if (data.snapshot?.available) {
          setSnapshotAvailable(true);
          setSnapshotDate(data.snapshot.date);
          setRestoreFromSnapshot(true);
        } else {
          setSnapshotAvailable(false);
          setSnapshotDate(null);
          setRestoreFromSnapshot(false);
        }
      } else {
        console.error("Failed to fetch limits, status:", response.status);
        const errorText = await response.text();
        console.error("Error response:", errorText);
      }
    } catch (error) {
      console.error("Failed to fetch limits and usage:", error);
    } finally {
      setLoadingLimits(false);
    }
  };

  // Check if adding new resources would exceed limits
  const wouldExceedLimit = () => {
    if (!limits || !usage) return false;

    const memoryNeeded = desktopEnabled ? 2 : 0.5;
    return (
      usage.machines_count >= limits.max_machines ||
      usage.total_cpu_cores + 2 > limits.max_cpu_cores ||
      usage.total_memory_gb + memoryNeeded > limits.max_memory_gb ||
      usage.total_storage_gb + storageGb > limits.max_storage_gb
    );
  };

  const getRemainingResources = () => {
    if (!limits || !usage) return null;
    
    return {
      machines: limits.max_machines - usage.machines_count,
      cpu: limits.max_cpu_cores - usage.total_cpu_cores,
      memory: limits.max_memory_gb - usage.total_memory_gb,
      storage: limits.max_storage_gb - usage.total_storage_gb,
    };
  };

  const handleCreate = async () => {
    if (!displayName.trim()) {
      toast.error(t("nameRequired"));
      return;
    }

    if (displayName.trim().toLowerCase().startsWith("local")) {
      toast.error(t("nameError"));
      return;
    }

    setCreating(true);

    // Store the values — Windows always uses desktop mode and needs more storage
    const isWindows = osType === 'windows';
    const machineConfig = {
      displayName: displayName.trim(),
      provider: 'aws' as const,
      osType,
      storageGb: isWindows ? Math.max(storageGb, 30) : storageGb,
      desktopEnabled: isWindows ? true : desktopEnabled,
      restoreFromSnapshot: snapshotAvailable ? restoreFromSnapshot : false,
    };

    try {
      // Start the creation request
      const responsePromise = fetch("/api/machines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(machineConfig),
      });

      // Show immediate success and close dialog
      const restoring = snapshotAvailable && restoreFromSnapshot;
      toast.success(restoring ? t("toasts.restoringSnapshot") : isWindows ? t("toasts.windowsCreated") : `Ubuntu machine creation started!`, {
        description: restoring
          ? t("toasts.restoringDescription")
          : isWindows
            ? t("toasts.windowsDescription")
            : desktopEnabled
              ? t("toasts.linuxCreated")
              : t("toasts.sshCreated"),
        duration: 5000,
      });

      // Reset form for next time
      setDisplayName("");
      setOsType('linux');
      setDesktopEnabled(true);
      setStorageGb(16);
      setCreating(false);

      // Close dialog immediately
      onOpenChange(false);
      
      // Refresh the machines list immediately to show creating status
      onMachineCreated();
      
      // Handle the response in the background
      responsePromise.then(async (response) => {
        if (!response.ok) {
          const error = await response.json();
          toast.error(error.error || t("create"), {
            description: "Please check your limits and try again.",
          });
          // Refresh list to remove any failed machine
          onMachineCreated();
        } else {
          // Machine created successfully - list will auto-update via polling
          const data = await response.json();
          trackVmCreated(data.machine.id, "azure");
          console.log("Machine created successfully:", data.machine.id);
        }
      }).catch((error) => {
        console.error("Machine creation error:", error);
        toast.error("Network error while creating machine");
        // Refresh list to remove any failed machine
        onMachineCreated();
      });
      
    } catch (error: any) {
      // This should rarely happen since we're handling errors in the promise
      toast.error(error.message, {
        description: "Failed to start machine creation.",
      });
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="create-machine-dialog max-w-[95vw] sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>{t("title")}</DialogTitle>
            {limits && (
              <span className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground mr-6">
                {usage?.machines_count ?? 0} / {limits.max_machines}
              </span>
            )}
          </div>
          <DialogDescription>
            {t("subtitle")}
          </DialogDescription>
        </DialogHeader>

        {/* Free Tier Notice */}
        {!subscriptionLoading && isFreeTier && (
          <NoiseBackground
            containerClassName="w-full p-[1px] rounded-lg bg-transparent dark:bg-transparent shadow-none"
            className="p-0"
            gradientColors={["rgb(139, 92, 246)", "rgb(99, 102, 241)", "rgb(168, 85, 247)"]}
            noiseIntensity={0.06}
            speed={0.06}
          >
            <div className="flex items-center justify-between gap-3 rounded-[7px] bg-background/80 px-4 py-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                <p className="text-sm text-muted-foreground truncate">
                  {t("freeExpiry")}<span className="font-medium text-foreground">{t("freeExpiry2")}</span>
                </p>
              </div>
              <button
                onClick={() => useAccountDialog.getState().open("billing")}
                className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-foreground hover:opacity-80 transition-opacity"
              >
                {t("upgrade")}
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </NoiseBackground>
        )}

        {/* Limit reached notice */}
        {!loadingLimits && wouldExceedLimit() && (
          <p className="text-sm text-muted-foreground rounded-lg border border-border bg-muted/40 px-4 py-3">
            {t("limitReached")}{" "}
            <button onClick={() => useAccountDialog.getState().open("billing")} className="font-medium text-foreground hover:opacity-80 transition-opacity">
              {t("upgradeMore")}
            </button>
          </p>
        )}

        <div className="space-y-6 py-4">
          {/* Machine Name */}
          <div className="space-y-2">
            <Label htmlFor="name">{t("nameLabel")}</Label>
            <Input
              id="name"
              placeholder={t("namePlaceholder")}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={creating}
              className={displayName.trim().toLowerCase().startsWith("local") ? "border-destructive" : ""}
            />
            {displayName.trim().toLowerCase().startsWith("local") && (
              <p className="text-xs text-destructive">
                {t("nameError")}
              </p>
            )}
          </div>

          {/* OS Selection */}
          <div className="space-y-2">
            <Label>{t("osLabel")}</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => { setOsType('linux'); setStorageGb(16); }}
                className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                  osType === 'linux'
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-border bg-muted/30 hover:bg-muted/50"
                }`}
              >
                <LinuxIcon className="h-5 w-5 shrink-0 text-foreground/70" />
                <div className="text-xs space-y-0.5">
                  <p className="font-medium text-foreground">{t("linux.name")}</p>
                  <p className="text-muted-foreground">{t("linux.description")}</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => { setOsType('windows'); setStorageGb(30); setDesktopEnabled(true); setRestoreFromSnapshot(false); }}
                className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                  osType === 'windows'
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-border bg-muted/30 hover:bg-muted/50"
                }`}
              >
                <WindowsIcon className="h-4.5 w-4.5 shrink-0 text-foreground/70" />
                <div className="text-xs space-y-0.5">
                  <p className="font-medium text-foreground">{t("windows.name")} <span className="text-[10px] font-medium text-amber-500 bg-amber-500/10 px-1 py-0.5 rounded">{t("windows.badge")}</span></p>
                  <p className="text-muted-foreground">{t("windows.description")}</p>
                </div>
              </button>
            </div>
          </div>

          {/* Machine Info */}
          <div className="flex items-center gap-3 rounded-lg border p-3 bg-muted/30">
            <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              {osType === 'windows'
                ? t("osHintWindows")
                : t("osHintLinux")}
            </p>
          </div>

          {/* Snapshot restore choice — only for matching OS (Linux snapshots can't restore to Windows) */}
          {snapshotAvailable && osType === 'linux' && (
            <div className="space-y-2">
              <Label>{t("stateLabel")}</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRestoreFromSnapshot(true)}
                  className={`flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors ${
                    restoreFromSnapshot
                      ? "border-blue-500 bg-blue-500/10"
                      : "border-border bg-muted/30 hover:bg-muted/50"
                  }`}
                >
                  <History className={`h-4 w-4 mt-0.5 shrink-0 ${restoreFromSnapshot ? "text-blue-500" : "text-muted-foreground"}`} />
                  <div className="text-xs space-y-0.5">
                    <p className="font-medium text-foreground">{t("restorePrevious")}</p>
                    <p className="text-muted-foreground">
                      {t("restoreDescription")}
                      {snapshotDate && (
                        <span className="block text-[10px]">
                          {new Date(snapshotDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setRestoreFromSnapshot(false)}
                  className={`flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors ${
                    !restoreFromSnapshot
                      ? "border-blue-500 bg-blue-500/10"
                      : "border-border bg-muted/30 hover:bg-muted/50"
                  }`}
                >
                  <Plus className={`h-4 w-4 mt-0.5 shrink-0 ${!restoreFromSnapshot ? "text-blue-500" : "text-muted-foreground"}`} />
                  <div className="text-xs space-y-0.5">
                    <p className="font-medium text-foreground">{t("startFresh")}</p>
                    <p className="text-muted-foreground">{t("startFreshDescription")}</p>
                  </div>
                </button>
              </div>
            </div>
          )}

        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={creating}
          >
            {t("cancel")}
          </Button>
          <Button
            onClick={handleCreate}
            disabled={creating || !displayName.trim() || displayName.trim().toLowerCase().startsWith("local") || wouldExceedLimit()}
          >
            {creating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("creating")}
              </>
            ) : (
              t("create")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}