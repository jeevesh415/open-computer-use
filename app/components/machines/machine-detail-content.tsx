"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Monitor,
  Terminal,
  Settings,
  Loader2,
  AlertCircle,
  Play,
  Square,
  RefreshCw,
  Trash2,
  Network,
  FolderOpen,
  Save,
  Clock,
  CheckCircle,
  Copy,
  Check
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MachineLayout } from "./machine-layout";
import { SimpleVNCViewer } from "./simple-vnc-viewer";
import { MachineSettings } from "./machine-settings";
import { FileTransfer } from "./file-transfer";
import { SshConnectionPanel } from "./ssh-connection-panel";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import type { UserMachine } from "@/types/machines.types";

interface MachineDetailContentProps {
  machineId: string;
}

export function MachineDetailContent({ machineId }: MachineDetailContentProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [machine, setMachine] = useState<UserMachine | null>(null);
  const [usage, setUsage] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [copiedIp, setCopiedIp] = useState(false);

  useEffect(() => {
    fetchMachineData();

    // Poll while machine is transitioning. The condition is checked inside the
    // callback (not in deps) so state changes don't cascade-restart the interval.
    const interval = setInterval(() => {
      if (machine && (
        ['creating', 'starting', 'stopping'].includes(machine.status) ||
        machine.settings?.desktopInitStatus === 'installing'
      )) {
        fetchMachineData();
      }
    }, 5000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineId]);

  const fetchMachineData = async () => {
    try {
      const response = await fetch(`/api/machines/${machineId}`);

      if (!response.ok) {
        if (response.status === 404) {
          setError("Machine not found");
        } else if (response.status === 401) {
          router.push("/auth");
        } else {
          setError("Failed to load machine");
        }
        return;
      }

      const data = await response.json();
      setMachine(data.machine);
      setUsage(data.usage || []);
    } catch (error) {
      console.error("Error fetching machine:", error);
      setError("Failed to load machine");
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (action: "start" | "stop" | "restart" | "delete" | "snapshot") => {
    if (!machine) return;

    if (action === "delete") {
      if (!confirm("Are you sure you want to delete this machine? This action cannot be undone.")) {
        return;
      }
    }

    setActionLoading(action);

    try {
      const response = await fetch(`/api/machines/${machineId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Action failed");
      }

      const data = await response.json();

      if (action === "start" && data.recreated && data.vncPassword) {
        toast.success(
          "Machine recreated with new password. Please use the new password to connect.",
          { duration: 8000 }
        );
        setMachine(prev => prev ? { ...prev, vncPassword: data.vncPassword } : null);
      } else if (action === "snapshot") {
        toast.success(`Snapshot created successfully (${data.amiId})`, { duration: 5000 });
      } else {
        const message = action === "start" ? "Machine starting..." :
                        action === "stop" ? "Machine stopping..." :
                        action === "restart" ? "Machine restarting..." :
                        "Machine deleted";
        toast.success(message);
      }

      if (action === "delete") {
        router.push("/machines");
      } else {
        fetchMachineData();
      }
    } catch (error: any) {
      toast.error(error.message || "Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  const copyIp = () => {
    if (machine?.publicIpAddress) {
      navigator.clipboard.writeText(machine.publicIpAddress);
      setCopiedIp(true);
      setTimeout(() => setCopiedIp(false), 2000);
    }
  };

  const formatUptime = () => {
    if (!machine?.startedAt || machine.status !== "running") return null;
    const start = new Date(machine.startedAt);
    const now = new Date();
    const hours = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60));
    const minutes = Math.floor(((now.getTime() - start.getTime()) % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  if (loading) {
    return (
      <MachineLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="flex flex-col items-center gap-3">
            <div className="relative h-10 w-10">
              <div className="absolute inset-0 rounded-full border-2 border-muted" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-foreground animate-spin" />
            </div>
            <span className="text-sm text-muted-foreground">Loading machine...</span>
          </div>
        </div>
      </MachineLayout>
    );
  }

  if (error || !machine) {
    return (
      <MachineLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center"
          >
            <div className="h-12 w-12 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <h3 className="text-lg font-medium mb-1.5">{error || "Machine not found"}</h3>
            <p className="text-sm text-muted-foreground mb-6">
              The machine may have been deleted or you don&apos;t have access.
            </p>
            <Button
              variant="outline"
              onClick={() => router.push("/machines")}
              className="rounded-xl"
            >
              Back to Machines
            </Button>
          </motion.div>
        </div>
      </MachineLayout>
    );
  }

  const isElectron = machine.settings?.provider === 'electron';
  const isAws = machine.settings?.provider === 'aws';
  const isDesktopAws = isAws && machine.settings?.desktopEnabled;
  const isTransitioning = ["creating", "starting", "stopping", "deleting"].includes(machine.status);

  const statusLabel = machine.status === "running" ? "Running"
    : machine.status === "stopped" ? "Stopped"
    : machine.status === "creating" ? "Creating"
    : machine.status === "starting" ? "Starting"
    : machine.status === "stopping" ? "Stopping"
    : machine.status === "error" ? "Error"
    : machine.status === "deleting" ? "Deleting"
    : machine.status;

  const NotRunningState = ({ label = "Start the machine to continue" }: { label?: string }) => (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-2xl border border-border/30 bg-card/30 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center py-16 px-6 text-center">
        <div className="h-12 w-12 rounded-2xl bg-foreground/[0.04] flex items-center justify-center mb-4">
          <Monitor className="h-6 w-6 text-muted-foreground/50" />
        </div>
        <h3 className="text-base font-medium mb-1.5">Machine Not Running</h3>
        <p className="text-sm text-muted-foreground mb-6">{label}</p>
        <Button
          onClick={() => handleAction("start")}
          disabled={actionLoading !== null}
          className="rounded-xl h-10 px-5 gap-2"
        >
          {actionLoading === "start" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Start Machine
        </Button>
      </div>
    </motion.div>
  );

  const DesktopInitializing = () => (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-2xl border border-border/30 bg-card/30 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center py-16 px-6 text-center">
        <div className="relative h-12 w-12 mb-4">
          <div className="absolute inset-0 rounded-full border-2 border-muted" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-foreground animate-spin" />
        </div>
        <h3 className="text-base font-medium mb-1.5">Desktop Initializing</h3>
        <p className="text-sm text-muted-foreground mb-2">
          Installing desktop environment. This takes 1-3 minutes on first boot.
        </p>
        <p className="text-xs text-muted-foreground/60">
          You can use SSH while the desktop is being set up.
        </p>
      </div>
    </motion.div>
  );

  const DesktopFailed = () => (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-2xl border border-destructive/20 bg-destructive/[0.02]"
    >
      <div className="flex flex-col items-center py-16 px-6 text-center">
        <div className="h-12 w-12 rounded-2xl bg-destructive/10 flex items-center justify-center mb-4">
          <AlertCircle className="h-6 w-6 text-destructive" />
        </div>
        <h3 className="text-base font-medium mb-1.5">Desktop Setup Failed</h3>
        <p className="text-sm text-muted-foreground">
          Check <code className="text-xs bg-foreground/[0.05] px-1.5 py-0.5 rounded">/var/log/desktop-setup.log</code> via SSH for details.
        </p>
      </div>
    </motion.div>
  );

  const tabTriggerClass = "gap-2 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm text-sm px-4 py-2";

  return (
    <MachineLayout
      machineId={machine.id}
      machineName={machine.displayName}
      machineStatus={machine.status}
    >
      <div className="py-6 space-y-6">
        {/* Overview header card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-2xl border border-border/30 bg-card/50 backdrop-blur-sm p-5 sm:p-6"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            {/* Left: info */}
            <div className="space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-medium tracking-tight">{machine.displayName}</h1>
                <div className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                  machine.status === "running" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                  machine.status === "stopped" && "bg-foreground/[0.05] text-muted-foreground",
                  machine.status === "error" && "bg-destructive/10 text-destructive",
                  (machine.status === "creating" || machine.status === "starting") && "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                  machine.status === "stopping" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                  machine.status === "deleting" && "bg-destructive/10 text-destructive",
                )}>
                  {machine.status === "running" && <CheckCircle className="h-3 w-3" />}
                  {isTransitioning && <Loader2 className="h-3 w-3 animate-spin" />}
                  {machine.status === "error" && <AlertCircle className="h-3 w-3" />}
                  {machine.status === "stopped" && <Square className="h-3 w-3" />}
                  {statusLabel}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
                <span>Created {new Date(machine.createdAt).toLocaleDateString()}</span>
                {formatUptime() && (
                  <span className="flex items-center gap-1 tabular-nums">
                    <Clock className="h-3.5 w-3.5" />
                    Uptime {formatUptime()}
                  </span>
                )}
                {!isElectron && machine.publicIpAddress && (
                  <button
                    onClick={copyIp}
                    className="flex items-center gap-1.5 font-mono text-xs hover:text-foreground transition-colors group"
                  >
                    <Network className="h-3.5 w-3.5" />
                    {machine.publicIpAddress}
                    {copiedIp ? (
                      <Check className="h-3 w-3 text-emerald-500" />
                    ) : (
                      <Copy className="h-3 w-3 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity" />
                    )}
                  </button>
                )}
                {isElectron && (
                  <span className="text-xs">Connected via Desktop App</span>
                )}
              </div>
            </div>

            {/* Right: actions */}
            {!isElectron && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant={machine.status === "running" ? "outline" : "default"}
                  size="sm"
                  onClick={() => handleAction(machine.status === "running" ? "stop" : "start")}
                  disabled={actionLoading !== null || !["running", "stopped", "error"].includes(machine.status)}
                  className="h-9 rounded-xl gap-2 px-4 font-medium"
                >
                  {(actionLoading === "start" || actionLoading === "stop") ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : machine.status === "running" ? (
                    <>
                      <Square className="h-3.5 w-3.5" />
                      Stop
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5" />
                      Start
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleAction("restart")}
                  disabled={actionLoading !== null || machine.status !== "running"}
                  className="h-9 rounded-xl gap-2 px-4 border-border/40"
                >
                  {actionLoading === "restart" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <RefreshCw className="h-3.5 w-3.5" />
                      Restart
                    </>
                  )}
                </Button>
                {isAws && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleAction("snapshot")}
                    disabled={actionLoading !== null || machine.status !== "running"}
                    className="h-9 rounded-xl gap-2 px-4 border-border/40"
                  >
                    {actionLoading === "snapshot" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Save className="h-3.5 w-3.5" />
                        Snapshot
                      </>
                    )}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleAction("delete")}
                  disabled={actionLoading !== null || machine.status === "running"}
                  className="h-9 rounded-xl gap-2 px-4 border-destructive/20 text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  {actionLoading === "delete" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>

          {/* Status message */}
          {machine.statusMessage && (
            <div className={cn(
              "mt-4 rounded-xl px-4 py-3 text-sm",
              machine.status === "error"
                ? "bg-destructive/[0.06] text-destructive border border-destructive/15"
                : "bg-foreground/[0.03] text-muted-foreground border border-border/20"
            )}>
              {machine.statusMessage}
            </div>
          )}
        </motion.div>

        {/* Tabs */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
        >
          {isElectron ? (
            <Tabs defaultValue="settings" className="space-y-4">
              <TabsList className="bg-foreground/[0.04] border border-border/30 rounded-xl p-1 h-auto w-auto inline-flex">
                <TabsTrigger value="settings" className={tabTriggerClass}>
                  <Settings className="h-4 w-4" />
                  Settings
                </TabsTrigger>
              </TabsList>
              <TabsContent value="settings" className="space-y-4">
                <MachineSettings machine={machine} onUpdate={fetchMachineData} />
              </TabsContent>
            </Tabs>
          ) : isDesktopAws ? (
            <Tabs defaultValue="desktop" className="space-y-4">
              <TabsList className="bg-foreground/[0.04] border border-border/30 rounded-xl p-1 h-auto w-auto inline-flex">
                <TabsTrigger value="desktop" className={tabTriggerClass}>
                  <Monitor className="h-4 w-4" />
                  Desktop
                </TabsTrigger>
                <TabsTrigger value="ssh" className={tabTriggerClass}>
                  <Terminal className="h-4 w-4" />
                  SSH
                </TabsTrigger>
                <TabsTrigger value="settings" className={tabTriggerClass}>
                  <Settings className="h-4 w-4" />
                  Settings
                </TabsTrigger>
              </TabsList>

              <TabsContent value="desktop" className="space-y-4">
                {machine.status !== "running" ? (
                  <NotRunningState label="Start the machine to access the desktop" />
                ) : machine.settings?.desktopInitStatus === 'installing' ? (
                  <DesktopInitializing />
                ) : machine.settings?.desktopInitStatus === 'failed' ? (
                  <DesktopFailed />
                ) : (
                  <SimpleVNCViewer machine={machine} session={null} />
                )}
              </TabsContent>

              <TabsContent value="ssh" className="space-y-4">
                <SshConnectionPanel machine={machine} />
              </TabsContent>

              <TabsContent value="settings" className="space-y-4">
                <MachineSettings machine={machine} onUpdate={fetchMachineData} />
              </TabsContent>
            </Tabs>
          ) : isAws ? (
            <Tabs defaultValue="ssh" className="space-y-4">
              <TabsList className="bg-foreground/[0.04] border border-border/30 rounded-xl p-1 h-auto w-auto inline-flex">
                <TabsTrigger value="ssh" className={tabTriggerClass}>
                  <Terminal className="h-4 w-4" />
                  SSH
                </TabsTrigger>
                <TabsTrigger value="settings" className={tabTriggerClass}>
                  <Settings className="h-4 w-4" />
                  Settings
                </TabsTrigger>
              </TabsList>

              <TabsContent value="ssh" className="space-y-4">
                <SshConnectionPanel machine={machine} />
              </TabsContent>

              <TabsContent value="settings" className="space-y-4">
                <MachineSettings machine={machine} onUpdate={fetchMachineData} />
              </TabsContent>
            </Tabs>
          ) : (
            <Tabs defaultValue="desktop" className="space-y-4">
              <TabsList className="bg-foreground/[0.04] border border-border/30 rounded-xl p-1 h-auto w-auto inline-flex">
                <TabsTrigger value="desktop" className={tabTriggerClass}>
                  <Monitor className="h-4 w-4" />
                  Desktop
                </TabsTrigger>
                <TabsTrigger value="files" className={tabTriggerClass}>
                  <FolderOpen className="h-4 w-4" />
                  Files
                </TabsTrigger>
                <TabsTrigger value="settings" className={tabTriggerClass}>
                  <Settings className="h-4 w-4" />
                  Settings
                </TabsTrigger>
              </TabsList>

              <TabsContent value="desktop" className="space-y-4">
                {machine.status !== "running" ? (
                  <NotRunningState label="Start the machine to access the desktop" />
                ) : (
                  <SimpleVNCViewer machine={machine} session={null} />
                )}
              </TabsContent>

              <TabsContent value="files" className="space-y-4">
                {machine.status !== "running" ? (
                  <NotRunningState label="Start the machine to access file transfer" />
                ) : (
                  <FileTransfer
                    machineId={machine.id}
                    connectionInfo={{
                      publicIpAddress: machine.publicIpAddress,
                      vncPort: machine.vncPort,
                      vncPassword: machine.vncPassword
                    }}
                  />
                )}
              </TabsContent>

              <TabsContent value="settings" className="space-y-4">
                <MachineSettings machine={machine} onUpdate={fetchMachineData} />
              </TabsContent>
            </Tabs>
          )}
        </motion.div>
      </div>
    </MachineLayout>
  );
}
