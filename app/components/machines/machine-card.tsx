"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAccountDialog } from "@/lib/account-dialog-store";
import {
  Monitor,
  Play,
  Square,
  Trash2,
  MoreVertical,
  Clock,
  AlertCircle,
  Loader2,
  ArrowRight,
  Terminal,
  Save,
  History,
  Mail,
  ExternalLink,
  Copy,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useSubscription } from "@/hooks/use-subscription";
import { formatTimeRemaining } from "@/lib/utils/subscription";
import { WindowsIcon, AppleIcon, LinuxIcon } from "@/components/icons/platform-icons";
import { MachineCardThumbnail } from "@/app/components/machines/machine-card-thumbnail";
import type { UserMachine, MachineStatus } from "@/types/machines.types";

interface MachineCardProps {
  machine: UserMachine;
  onUpdate: (machine: UserMachine) => void;
  onDelete: (machineId: string) => void;
}

function getOsInfo(machine: UserMachine): { label: string; Icon: React.ComponentType<any> } | null {
  const platform = machine.settings?.platform;
  const osType = machine.settings?.osType;
  const provider = machine.settings?.provider;

  if (platform === "win32" || osType === "windows") {
    return { label: "Windows", Icon: WindowsIcon };
  }
  if (platform === "darwin") {
    return { label: "macOS", Icon: AppleIcon };
  }
  if (platform === "linux" || osType === "linux") {
    return { label: "Linux", Icon: LinuxIcon };
  }
  // Default for cloud/docker machines (Ubuntu)
  if (provider === "azure" || provider === "aws" || provider === "docker") {
    return { label: "Linux", Icon: LinuxIcon };
  }
  return null;
}


export function MachineCard({ machine, onUpdate, onDelete }: MachineCardProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<ReturnType<typeof formatTimeRemaining> | null>(null);
  const [emailCopied, setEmailCopied] = useState(false);
  const { isFreeTier, loading: subscriptionLoading } = useSubscription();

  const isTemporary = machine.id.startsWith("temp-");
  const isLocal = machine.settings?.isLocal || machine.id.startsWith("local-");
  const isElectron = machine.settings?.provider === "electron";
  const isAws = machine.settings?.provider === "aws";
  const isTransitioning = ["creating", "starting", "stopping", "deleting"].includes(machine.status);
  const osInfo = getOsInfo(machine);

  const handleCopyEmail = useCallback(() => {
    const email = machine.settings?.email_identity?.email;
    if (!email) return;
    navigator.clipboard.writeText(email).then(() => {
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 2000);
    });
  }, [machine.settings?.email_identity?.email]);

  useEffect(() => {
    if (!isFreeTier || subscriptionLoading || isLocal) {
      setTimeRemaining(null);
      return;
    }

    const updateTimeRemaining = () => {
      const remaining = formatTimeRemaining(machine.createdAt);
      setTimeRemaining(remaining);
    };

    updateTimeRemaining();
    const interval = setInterval(updateTimeRemaining, 60000);
    return () => clearInterval(interval);
  }, [isFreeTier, subscriptionLoading, machine.createdAt, isLocal]);

  const handleAction = async (action: "start" | "stop" | "restart" | "delete" | "snapshot") => {
    setLoading(action);

    try {
      const response = await fetch(`/api/machines/${machine.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Action failed");
      }

      const data = await response.json();

      if (action === "snapshot") {
        toast.success("Snapshot created successfully", { duration: 5000 });
        return;
      }

      if ((action === "start" || action === "restart") && data.recreated && data.vncPassword) {
        toast.success(
          `Computer ${action === "restart" ? "restarted" : "recreated"} with new password. Please use the new password to connect.`,
          { duration: 8000 }
        );

        const updatedMachine = {
          ...machine,
          vncPassword: data.vncPassword,
          status: "starting" as "starting",
        };
        onUpdate(updatedMachine);
      } else {
        const message =
          action === "start"
            ? "Computer starting..."
            : action === "stop"
              ? "Computer stopping..."
              : action === "restart"
                ? "Computer restarting..."
                : "Computer deleted";

        toast.success(message);

        if (action === "delete") {
          onDelete(machine.id);
        } else {
          const newStatus =
            action === "start"
              ? "starting"
              : action === "stop"
                ? "stopping"
                : action === "restart"
                  ? "stopping"
                  : "starting";
          onUpdate({ ...machine, status: newStatus as any });
        }
      }

      if (action !== "delete") {
        pollMachineStatus(machine.id);
      }
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(null);
      setShowDeleteDialog(false);
    }
  };

  const pollMachineStatus = async (machineId: string, attempts = 0) => {
    if (attempts > 20) return;

    try {
      const response = await fetch(`/api/machines/${machineId}`);
      if (response.ok) {
        const data = await response.json();
        onUpdate(data.machine);

        if (["creating", "starting", "stopping"].includes(data.machine.status)) {
          setTimeout(() => pollMachineStatus(machineId, attempts + 1), 3000);
        } else if (data.machine.status === "error") {
          const statusResponse = await fetch(`/api/machines/${machineId}/status`);
          if (statusResponse.ok) {
            const statusData = await statusResponse.json();
            if (statusData.needsRecreation) {
              toast.error("Computer was deallocated. Please try starting it again.");
            }
          }
        }
      }
    } catch (error) {
      console.error("Error polling machine status:", error);
    }
  };

  const handleConnect = () => {
    if (!isTemporary) {
      router.push(`/machines/${machine.id}`);
    }
  };

  const formatUptime = () => {
    if (!machine.startedAt || machine.status !== "running") return null;

    const start = new Date(machine.startedAt);
    const now = new Date();
    const hours = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60));
    const minutes = Math.floor(((now.getTime() - start.getTime()) % (1000 * 60 * 60)) / (1000 * 60));

    return `${hours}h ${minutes}m`;
  };

  const statusDot = cn(
    "h-2 w-2 rounded-full shrink-0",
    machine.status === "running" && "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]",
    machine.status === "stopped" && "bg-foreground/20",
    machine.status === "error" && "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.4)]",
    (machine.status === "creating" || machine.status === "starting") && "bg-blue-500 animate-pulse shadow-[0_0_6px_rgba(59,130,246,0.4)]",
    machine.status === "stopping" && "bg-amber-500 animate-pulse shadow-[0_0_6px_rgba(245,158,11,0.4)]",
    machine.status === "deleting" && "bg-red-500 animate-pulse",
  );

  const statusLabel =
    machine.status === "creating" ? "Creating" :
    machine.status === "starting" ? "Starting" :
    machine.status === "running" ? "Running" :
    machine.status === "stopping" ? "Stopping" :
    machine.status === "stopped" ? "Stopped" :
    machine.status === "error" ? "Error" :
    machine.status === "deleting" ? "Deleting" : "";

  return (
    <>
      <div
        className={cn(
          "relative group h-full flex flex-col rounded-2xl transition-all duration-300 overflow-hidden",
          "border border-border/40 bg-card/60 backdrop-blur-md",
          "hover:border-border/70 hover:bg-card/90 hover:shadow-xl hover:shadow-black/[0.03] dark:hover:shadow-black/[0.08]",
          "hover:-translate-y-0.5",
          machine.status === "error" && "border-red-500/20 bg-red-500/[0.02]",
        )}
      >
        {/* Generative animated thumbnail */}
        <div className="shrink-0 transition-transform duration-500 group-hover:scale-[1.03] origin-center">
          <MachineCardThumbnail
            machineId={machine.id}
            status={machine.status}
            platform={machine.settings?.platform}
          />
        </div>

        {/* Card content */}
        <div className="flex flex-col flex-1 px-5 pb-5 pt-4 relative">
          {/* Top row: Name + Status + Menu */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5 mb-1.5">
                <h3 className="text-[15px] font-semibold truncate text-foreground/90 tracking-tight">
                  {machine.displayName}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <div className={statusDot} />
                <span className={cn(
                  "text-xs font-medium",
                  machine.status === "running" && "text-emerald-600 dark:text-emerald-400",
                  machine.status === "stopped" && "text-muted-foreground/60",
                  machine.status === "error" && "text-red-500",
                  (machine.status === "creating" || machine.status === "starting") && "text-blue-600 dark:text-blue-400",
                  machine.status === "stopping" && "text-amber-600 dark:text-amber-400",
                  machine.status === "deleting" && "text-red-500",
                )}>
                  {statusLabel}
                </span>
                {osInfo && (
                  <span className="inline-flex items-center gap-1 text-muted-foreground/50 ml-0.5">
                    <span className="text-[10px]">·</span>
                    <osInfo.Icon className="h-2.5 w-2.5" />
                    <span className="text-[11px]">{osInfo.label}</span>
                  </span>
                )}
                {formatUptime() && (
                  <span className="text-[11px] text-muted-foreground/50 tabular-nums ml-1">
                    {formatUptime()}
                  </span>
                )}
              </div>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 rounded-lg text-muted-foreground/40 hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={handleConnect} disabled={isTemporary}>
                  <Monitor className="mr-2 h-4 w-4" />
                  View Details
                </DropdownMenuItem>
                {!isElectron && (
                  <>
                    <DropdownMenuSeparator />
                    {isAws && (
                      <DropdownMenuItem
                        onClick={() => handleAction("snapshot")}
                        disabled={machine.status !== "running" || loading !== null || isTemporary}
                      >
                        <Save className="mr-2 h-4 w-4" />
                        {loading === "snapshot" ? "Saving..." : "Create Snapshot"}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onClick={() => handleAction("restart")}
                      disabled={machine.status !== "running" || loading !== null || isTemporary}
                    >
                      Restart
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setShowDeleteDialog(true)}
                      disabled={machine.status === "running" || loading !== null || isTemporary}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Email identity */}
          {machine.settings?.email_identity?.email && (
            <div className="flex items-center gap-2 rounded-lg border border-border/30 bg-foreground/[0.02] px-3 py-2 mb-3 group/email">
              <Mail className="h-3 w-3 text-muted-foreground/40 shrink-0" />
              <span className="text-[11px] text-muted-foreground/60 truncate font-mono flex-1">
                {machine.settings.email_identity.email}
              </span>
              <button
                onClick={handleCopyEmail}
                className="shrink-0 p-0.5 rounded text-muted-foreground/30 hover:text-muted-foreground/70 opacity-0 group-hover/email:opacity-100 transition-all"
              >
                {emailCopied ? (
                  <Check className="h-3 w-3 text-emerald-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>
            </div>
          )}

          {/* Snapshot indicator */}
          {machine.settings?.restoredFromSnapshot && (
            <div className="flex items-center gap-1.5 text-[11px] text-blue-500/70 mb-3">
              <History className="h-3 w-3" />
              <span>Restored from snapshot</span>
            </div>
          )}

          {/* Free tier auto-deletion countdown */}
          {timeRemaining && isFreeTier && !subscriptionLoading && (
            <div
              className={cn(
                "flex items-center justify-between gap-2 rounded-xl border px-3 py-2 mb-3",
                timeRemaining.isExpiringSoon
                  ? "border-red-500/20 bg-red-500/[0.03]"
                  : "border-border/30 bg-foreground/[0.02]",
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                <p className="text-[11px] text-muted-foreground/70 truncate">
                  {timeRemaining.timeString === "Expired" ? (
                    <span className="font-medium text-red-500">Computer expired</span>
                  ) : (
                    <>
                      Deletes in{" "}
                      <span className="font-medium text-foreground/80">{timeRemaining.timeString}</span>
                    </>
                  )}
                </p>
              </div>
              <button
                onClick={() => useAccountDialog.getState().open("billing")}
                className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-foreground/60 hover:text-foreground transition-colors"
              >
                Upgrade
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* Status message */}
          {machine.statusMessage && (
            <p
              className={cn(
                "text-[11px] leading-relaxed mb-3",
                machine.status === "error" ? "text-red-500/80" : "text-muted-foreground/50",
              )}
            >
              {machine.statusMessage}
            </p>
          )}

          {/* Error state */}
          {machine.status === "error" && (
            <div className="rounded-xl border border-red-500/10 bg-red-500/[0.03] px-3 py-2.5 mb-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 text-red-500/60 shrink-0 mt-0.5" />
                <p className="text-[11px] text-red-500/70 leading-relaxed">
                  Computer encountered an error. Try starting it again or contact support.
                </p>
              </div>
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Action buttons */}
          <div className="flex gap-2 pt-2 mt-1 border-t border-border/20">
            {isElectron ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleConnect}
                className="flex-1 h-9 rounded-xl font-medium text-xs hover:bg-foreground/[0.05]"
              >
                View Details
                <ExternalLink className="h-3 w-3 ml-1.5 opacity-50" />
              </Button>
            ) : (
              <>
                {(machine.status === "stopped" || machine.status === "error") && !isTemporary && (
                  <Button
                    size="sm"
                    onClick={() => handleAction("start")}
                    disabled={loading !== null}
                    className="flex-1 h-9 rounded-xl font-medium text-xs"
                  >
                    {loading === "start" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5 mr-1.5" />
                        {machine.status === "error" ? "Retry" : "Start"}
                      </>
                    )}
                  </Button>
                )}

                {machine.status === "running" && !isTemporary && (
                  <>
                    <Button
                      size="sm"
                      onClick={handleConnect}
                      className="flex-1 h-9 rounded-xl font-medium text-xs"
                    >
                      {isAws ? (
                        <>
                          <Terminal className="h-3.5 w-3.5 mr-1.5" />
                          Connect
                        </>
                      ) : (
                        <>
                          <Monitor className="h-3.5 w-3.5 mr-1.5" />
                          Open
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleAction("stop")}
                      disabled={loading !== null}
                      className="h-9 w-9 p-0 rounded-xl text-muted-foreground/60 hover:text-red-500 hover:bg-red-500/[0.05]"
                    >
                      {loading === "stop" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Square className="h-3 w-3" />
                      )}
                    </Button>
                  </>
                )}

                {(isTransitioning || (isTemporary && machine.status === "creating")) && (
                  <Button size="sm" disabled className="flex-1 h-9 rounded-xl text-xs">
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    {isTemporary
                      ? "Creating..."
                      : `${statusLabel}...`}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Computer</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{machine.displayName}&rdquo;? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleAction("delete")}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
