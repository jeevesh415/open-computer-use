"use client";

import { ReactNode, useEffect, useState } from "react";
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
  Check,
  Calendar,
  Server,
  Activity,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MachineLayout } from "./machine-layout";
import { SimpleVNCViewer } from "./simple-vnc-viewer";
import { MachineSettings } from "./machine-settings";
import { FileTransfer } from "./file-transfer";
import { SshConnectionPanel } from "./ssh-connection-panel";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import type { UserMachine } from "@/types/machines.types";

interface MachineDetailContentProps {
  machineId: string;
}

const easeOut: [number, number, number, number] = [0.22, 1, 0.36, 1];

const containerVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.07, delayChildren: 0.04 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: easeOut } },
};

type StatusKey =
  | "running"
  | "stopped"
  | "creating"
  | "starting"
  | "stopping"
  | "deleting"
  | "error";

const statusConfig: Record<
  StatusKey,
  {
    label: string;
    dot: string;
    text: string;
    bg: string;
    border: string;
    glow: string;
    icon: typeof CheckCircle;
  }
> = {
  running: {
    label: "Running",
    dot: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
    glow: "rgba(16,185,129,0.20)",
    icon: CheckCircle,
  },
  stopped: {
    label: "Stopped",
    dot: "bg-foreground/30",
    text: "text-muted-foreground",
    bg: "bg-foreground/[0.05]",
    border: "border-border/40",
    glow: "rgba(120,120,120,0.10)",
    icon: Square,
  },
  creating: {
    label: "Creating",
    dot: "bg-blue-500",
    text: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    glow: "rgba(59,130,246,0.20)",
    icon: Loader2,
  },
  starting: {
    label: "Starting",
    dot: "bg-blue-500",
    text: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    glow: "rgba(59,130,246,0.20)",
    icon: Loader2,
  },
  stopping: {
    label: "Stopping",
    dot: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    glow: "rgba(245,158,11,0.20)",
    icon: Loader2,
  },
  deleting: {
    label: "Deleting",
    dot: "bg-destructive",
    text: "text-destructive",
    bg: "bg-destructive/10",
    border: "border-destructive/20",
    glow: "rgba(239,68,68,0.20)",
    icon: Loader2,
  },
  error: {
    label: "Error",
    dot: "bg-destructive",
    text: "text-destructive",
    bg: "bg-destructive/10",
    border: "border-destructive/20",
    glow: "rgba(239,68,68,0.20)",
    icon: AlertCircle,
  },
};

interface ActionBtnProps {
  icon: typeof Play;
  label: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "default" | "destructive";
}

function ActionBtn({ icon: Icon, label, onClick, loading, disabled, variant = "default" }: ActionBtnProps) {
  const isDead = disabled || loading;
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={isDead}
      whileTap={!isDead ? { scale: 0.97 } : undefined}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className={cn(
        "h-9 inline-flex items-center gap-2 px-3.5 rounded-xl text-sm font-medium transition-all duration-150 shrink-0",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        !isDead && "hover:-translate-y-px",
        variant === "primary" && "bg-foreground text-background hover:bg-foreground/90 shadow-sm",
        variant === "default" && "bg-foreground/[0.04] hover:bg-foreground/[0.08] border border-border/40 text-foreground",
        variant === "destructive" && "bg-foreground/[0.02] hover:bg-destructive/10 border border-destructive/20 text-destructive",
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        {loading ? (
          <motion.span
            key="spin"
            initial={{ opacity: 0, rotate: -90 }}
            animate={{ opacity: 1, rotate: 0 }}
            exit={{ opacity: 0, rotate: 90 }}
            transition={{ duration: 0.18 }}
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          </motion.span>
        ) : (
          <motion.span
            key="icon"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.18 }}
          >
            <Icon className="h-3.5 w-3.5" />
          </motion.span>
        )}
      </AnimatePresence>
      <span>{label}</span>
    </motion.button>
  );
}

interface StatCellProps {
  icon: typeof Activity;
  label: string;
  value: ReactNode;
  action?: ReactNode;
}

function StatCell({ icon: Icon, label, value, action }: StatCellProps) {
  return (
    <div className="group relative flex-1 min-w-0 px-5 py-4 sm:py-5 first:pl-6 sm:first:pl-8 last:pr-6 sm:last:pr-8">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/55 mb-1.5">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="text-sm font-medium tracking-tight truncate min-w-0">{value}</div>
        {action}
      </div>
    </div>
  );
}

export function MachineDetailContent({ machineId }: MachineDetailContentProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [machine, setMachine] = useState<UserMachine | null>(null);
  const [usage, setUsage] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [copiedIp, setCopiedIp] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [activeTab, setActiveTab] = useState<string | null>(null);

  useEffect(() => {
    fetchMachineData();

    const interval = setInterval(() => {
      if (
        machine &&
        (["creating", "starting", "stopping"].includes(machine.status) ||
          machine.settings?.desktopInitStatus === "installing")
      ) {
        fetchMachineData();
      }
    }, 5000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineId]);

  // Live uptime tick — only runs while machine is up
  useEffect(() => {
    if (machine?.status !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [machine?.status]);

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
    } catch (err) {
      console.error("Error fetching machine:", err);
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
        const err = await response.json();
        throw new Error(err.error || "Action failed");
      }

      const data = await response.json();

      if (action === "start" && data.recreated && data.vncPassword) {
        toast.success(
          "Machine recreated with new password. Please use the new password to connect.",
          { duration: 8000 }
        );
        setMachine((prev) => (prev ? { ...prev, vncPassword: data.vncPassword } : null));
      } else if (action === "snapshot") {
        toast.success(`Snapshot created successfully (${data.amiId})`, { duration: 5000 });
      } else {
        const message =
          action === "start" ? "Machine starting..." :
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
    } catch (err: any) {
      toast.error(err.message || "Action failed");
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
    const start = new Date(machine.startedAt).getTime();
    const diff = Math.max(0, now - start);
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    const s = Math.floor((diff % 60_000) / 1000);
    return `${h}h ${m}m ${s}s`;
  };

  if (loading) {
    return (
      <MachineLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center gap-4"
          >
            <div className="relative h-12 w-12">
              <motion.div
                className="absolute inset-0 rounded-full border border-foreground/15"
                animate={{ scale: [1, 1.6], opacity: [0.6, 0] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
              />
              <motion.div
                className="absolute inset-0 rounded-full border border-foreground/15"
                animate={{ scale: [1, 1.6], opacity: [0.6, 0] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut", delay: 0.9 }}
              />
              <div className="absolute inset-0 rounded-full border-2 border-foreground/10" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-foreground animate-spin" />
            </div>
            <span className="text-sm text-muted-foreground tracking-wide">Loading machine</span>
          </motion.div>
        </div>
      </MachineLayout>
    );
  }

  if (error || !machine) {
    return (
      <MachineLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: easeOut }}
            className="text-center max-w-sm"
          >
            <div className="h-14 w-14 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto mb-5">
              <AlertCircle className="h-7 w-7 text-destructive" />
            </div>
            <h3 className="text-xl font-medium tracking-tight mb-2">{error || "Machine not found"}</h3>
            <p className="text-sm text-muted-foreground mb-6">
              The machine may have been deleted or you don&apos;t have access.
            </p>
            <Button variant="outline" onClick={() => router.push("/machines")} className="rounded-xl">
              Back to Machines
            </Button>
          </motion.div>
        </div>
      </MachineLayout>
    );
  }

  const isElectron = machine.settings?.provider === "electron";
  const isAws = machine.settings?.provider === "aws";
  const isDesktopAws = isAws && machine.settings?.desktopEnabled;
  const isTransitioning = ["creating", "starting", "stopping", "deleting"].includes(machine.status);
  const isRunning = machine.status === "running";
  const status = statusConfig[(machine.status as StatusKey)] ?? statusConfig.stopped;
  const StatusIcon = status.icon;

  const tabs: { id: string; label: string; icon: typeof Monitor }[] = isElectron
    ? [{ id: "settings", label: "Settings", icon: Settings }]
    : isDesktopAws
    ? [
        { id: "desktop", label: "Desktop", icon: Monitor },
        { id: "ssh", label: "SSH", icon: Terminal },
        { id: "settings", label: "Settings", icon: Settings },
      ]
    : isAws
    ? [
        { id: "ssh", label: "SSH", icon: Terminal },
        { id: "settings", label: "Settings", icon: Settings },
      ]
    : [
        { id: "desktop", label: "Desktop", icon: Monitor },
        { id: "files", label: "Files", icon: FolderOpen },
        { id: "settings", label: "Settings", icon: Settings },
      ];

  const currentTab = activeTab ?? tabs[0]?.id ?? "settings";

  const NotRunningState = ({ label = "Start the machine to continue" }: { label?: string }) => (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.45, ease: easeOut }}
      className="relative overflow-hidden rounded-3xl border border-border/40 bg-card/30 backdrop-blur-sm"
    >
      <div
        className="absolute inset-0 opacity-[0.02] pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }}
      />
      <div className="relative flex flex-col items-center py-20 px-6 text-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.12, duration: 0.5, ease: easeOut }}
          className="relative mb-6"
        >
          <div className="h-16 w-16 rounded-2xl bg-foreground/[0.04] border border-border/30 flex items-center justify-center">
            <Monitor className="h-7 w-7 text-muted-foreground/60" />
          </div>
        </motion.div>
        <h3 className="text-lg font-medium tracking-tight mb-1.5">Machine Not Running</h3>
        <p className="text-sm text-muted-foreground max-w-xs mb-6">{label}</p>
        <ActionBtn
          icon={Play}
          label="Start Machine"
          variant="primary"
          onClick={() => handleAction("start")}
          loading={actionLoading === "start"}
          disabled={actionLoading !== null}
        />
      </div>
    </motion.div>
  );

  const DesktopInitializing = () => (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.45, ease: easeOut }}
      className="relative overflow-hidden rounded-3xl border border-border/40 bg-card/30 backdrop-blur-sm"
    >
      <motion.div
        className="absolute -top-1/2 left-1/2 -translate-x-1/2 h-[400px] w-[600px] pointer-events-none"
        style={{
          background: "radial-gradient(circle, rgba(59,130,246,0.10) 0%, transparent 60%)",
          filter: "blur(60px)",
        }}
      />
      <div className="relative flex flex-col items-center py-20 px-6 text-center">
        <div className="relative h-16 w-16 mb-6">
          <motion.div
            className="absolute inset-0 rounded-2xl border border-blue-500/30"
            animate={{ scale: [1, 1.5], opacity: [0.6, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
          />
          <motion.div
            className="absolute inset-0 rounded-2xl border border-blue-500/30"
            animate={{ scale: [1, 1.5], opacity: [0.6, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeOut", delay: 1 }}
          />
          <div className="absolute inset-0 rounded-2xl bg-blue-500/10 border border-blue-500/20" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-7 w-7 text-blue-500 animate-spin" />
          </div>
        </div>
        <h3 className="text-lg font-medium tracking-tight mb-1.5">Desktop Initializing</h3>
        <p className="text-sm text-muted-foreground max-w-sm mb-2">
          Installing desktop environment. This takes 1–3 minutes on first boot.
        </p>
        <p className="text-xs text-muted-foreground/60">
          You can use SSH while the desktop is being set up.
        </p>
      </div>
    </motion.div>
  );

  const DesktopFailed = () => (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.45, ease: easeOut }}
      className="relative overflow-hidden rounded-3xl border border-destructive/20 bg-destructive/[0.02]"
    >
      <div className="relative flex flex-col items-center py-20 px-6 text-center">
        <div className="h-16 w-16 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center mb-6">
          <AlertCircle className="h-7 w-7 text-destructive" />
        </div>
        <h3 className="text-lg font-medium tracking-tight mb-1.5">Desktop Setup Failed</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Check{" "}
          <code className="text-xs bg-foreground/[0.05] px-1.5 py-0.5 rounded font-mono">
            /var/log/desktop-setup.log
          </code>{" "}
          via SSH for details.
        </p>
      </div>
    </motion.div>
  );

  const renderTabContent = () => {
    switch (currentTab) {
      case "desktop":
        if (machine.status !== "running") {
          return <NotRunningState label="Start the machine to access the desktop" />;
        }
        if (isDesktopAws && machine.settings?.desktopInitStatus === "installing") {
          return <DesktopInitializing />;
        }
        if (isDesktopAws && machine.settings?.desktopInitStatus === "failed") {
          return <DesktopFailed />;
        }
        return <SimpleVNCViewer machine={machine} session={null} />;
      case "files":
        if (machine.status !== "running") {
          return <NotRunningState label="Start the machine to access file transfer" />;
        }
        return (
          <FileTransfer
            machineId={machine.id}
            connectionInfo={{
              publicIpAddress: machine.publicIpAddress,
              vncPort: machine.vncPort,
              vncPassword: machine.vncPassword,
              // Pass the VM OS so FileTransfer picks an OS-appropriate
              // starting directory.  Without this the panel hard-coded a
              // Linux-style /home/desktop/Desktop, which only worked on
              // Ubuntu cloud VMs (whose agent has a remap for that prefix);
              // Windows VMs and freshly-launched machines whose UserData
              // hadn't created the Desktop folder yet showed an empty
              // list with no error — the deployed-but-not-local symptom.
              osType: machine.settings?.osType,
              provider: machine.settings?.provider,
            }}
          />
        );
      case "ssh":
        return <SshConnectionPanel machine={machine} />;
      case "settings":
        return <MachineSettings machine={machine} onUpdate={fetchMachineData} />;
      default:
        return null;
    }
  };

  return (
    <MachineLayout
      machineId={machine.id}
      machineName={machine.displayName}
      machineStatus={machine.status}
    >
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="py-6"
      >
        {/* Unified machine card */}
        <motion.div
          variants={itemVariants}
          className="relative overflow-hidden rounded-3xl border border-border/40 bg-card/40 backdrop-blur-xl"
        >
          {/* Status-colored ambient glow */}
          <motion.div
            key={machine.status}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.9 }}
            className="absolute -top-1/2 -right-1/4 h-[420px] w-[620px] pointer-events-none"
            style={{
              background: `radial-gradient(circle, ${status.glow} 0%, transparent 60%)`,
              filter: "blur(70px)",
            }}
          />

          {/* ── Header section ───────────────────────────── */}
          <div className="relative p-6 sm:p-8">
            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
              <div className="space-y-4 min-w-0 flex-1">
                <div className="flex items-center gap-2.5">
                  <div className="relative flex items-center justify-center h-2.5 w-2.5 shrink-0">
                    <div className={cn("absolute inset-0 rounded-full", status.dot)} />
                    {isRunning && (
                      <>
                        <motion.div
                          className={cn("absolute inset-0 rounded-full", status.dot)}
                          animate={{ scale: [1, 3.2], opacity: [0.55, 0] }}
                          transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
                        />
                        <motion.div
                          className={cn("absolute inset-0 rounded-full", status.dot)}
                          animate={{ scale: [1, 3.2], opacity: [0.55, 0] }}
                          transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut", delay: 1.2 }}
                        />
                      </>
                    )}
                  </div>
                  <span
                    className={cn(
                      "text-[10px] font-medium uppercase tracking-[0.14em]",
                      status.text
                    )}
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span
                        key={status.label}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.22 }}
                        className="inline-block"
                      >
                        {status.label}
                      </motion.span>
                    </AnimatePresence>
                  </span>
                </div>

                <div className="min-w-0">
                  <motion.h1
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, ease: easeOut, delay: 0.05 }}
                    className="text-3xl sm:text-4xl font-medium tracking-tight leading-[1.1] truncate"
                  >
                    {machine.displayName}
                  </motion.h1>
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground/60 font-mono">
                    <Server className="h-3 w-3" />
                    <span className="truncate">{machine.id}</span>
                  </div>
                </div>
              </div>

              {!isElectron && (
                <motion.div
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.5, ease: easeOut, delay: 0.15 }}
                  className="flex flex-wrap items-center gap-2"
                >
                  <ActionBtn
                    icon={isRunning ? Square : Play}
                    label={isRunning ? "Stop" : "Start"}
                    variant="primary"
                    onClick={() => handleAction(isRunning ? "stop" : "start")}
                    loading={actionLoading === "start" || actionLoading === "stop"}
                    disabled={
                      actionLoading !== null ||
                      !["running", "stopped", "error"].includes(machine.status)
                    }
                  />
                  <ActionBtn
                    icon={RefreshCw}
                    label="Restart"
                    onClick={() => handleAction("restart")}
                    loading={actionLoading === "restart"}
                    disabled={actionLoading !== null || !isRunning}
                  />
                  {isAws && (
                    <ActionBtn
                      icon={Save}
                      label="Snapshot"
                      onClick={() => handleAction("snapshot")}
                      loading={actionLoading === "snapshot"}
                      disabled={actionLoading !== null || !isRunning}
                    />
                  )}
                  <div className="hidden sm:block w-px h-6 bg-border/40 mx-0.5" />
                  <ActionBtn
                    icon={Trash2}
                    label="Delete"
                    variant="destructive"
                    onClick={() => handleAction("delete")}
                    loading={actionLoading === "delete"}
                    disabled={actionLoading !== null || isRunning}
                  />
                </motion.div>
              )}
            </div>

            <AnimatePresence>
              {machine.statusMessage && (
                <motion.div
                  initial={{ opacity: 0, height: 0, marginTop: 0 }}
                  animate={{ opacity: 1, height: "auto", marginTop: 24 }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  transition={{ duration: 0.32, ease: easeOut }}
                  className="overflow-hidden"
                >
                  <div
                    className={cn(
                      "rounded-2xl px-4 py-3 text-sm flex items-start gap-2.5",
                      machine.status === "error"
                        ? "bg-destructive/[0.06] text-destructive border border-destructive/15"
                        : "bg-foreground/[0.03] text-muted-foreground border border-border/30"
                    )}
                  >
                    <StatusIcon
                      className={cn("h-4 w-4 mt-0.5 shrink-0", isTransitioning && "animate-spin")}
                    />
                    <span className="leading-relaxed">{machine.statusMessage}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Stats row ────────────────────────────────── */}
          <div className="relative border-t border-border/30">
            <div className="flex flex-wrap sm:flex-nowrap divide-y sm:divide-y-0 sm:divide-x divide-border/30">
              <div className="w-1/2 sm:flex-1 sm:w-auto">
                <StatCell
                  icon={Activity}
                  label="Status"
                  value={
                    <span className={cn("inline-flex items-center gap-2", status.text)}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
                      {status.label}
                    </span>
                  }
                />
              </div>
              <div className="w-1/2 sm:flex-1 sm:w-auto">
                <StatCell
                  icon={Clock}
                  label="Uptime"
                  value={<span className="tabular-nums">{formatUptime() ?? "—"}</span>}
                />
              </div>
              <div className="w-1/2 sm:flex-1 sm:w-auto">
                {!isElectron && machine.publicIpAddress ? (
                  <StatCell
                    icon={Network}
                    label="Public IP"
                    value={<span className="font-mono">{machine.publicIpAddress}</span>}
                    action={
                      <button
                        onClick={copyIp}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-foreground/[0.06] shrink-0"
                        aria-label="Copy IP"
                      >
                        <AnimatePresence mode="wait" initial={false}>
                          {copiedIp ? (
                            <motion.span
                              key="check"
                              initial={{ scale: 0.5, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              exit={{ scale: 0.5, opacity: 0 }}
                              transition={{ duration: 0.18 }}
                              className="block"
                            >
                              <Check className="h-3.5 w-3.5 text-emerald-500" />
                            </motion.span>
                          ) : (
                            <motion.span
                              key="copy"
                              initial={{ scale: 0.5, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              exit={{ scale: 0.5, opacity: 0 }}
                              transition={{ duration: 0.18 }}
                              className="block"
                            >
                              <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </button>
                    }
                  />
                ) : (
                  <StatCell
                    icon={isElectron ? Zap : Network}
                    label={isElectron ? "Connection" : "Public IP"}
                    value={isElectron ? "Desktop App" : "—"}
                  />
                )}
              </div>
              <div className="w-1/2 sm:flex-1 sm:w-auto">
                <StatCell
                  icon={Calendar}
                  label="Created"
                  value={new Date(machine.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                />
              </div>
            </div>
          </div>

          {/* ── Tab bar ──────────────────────────────────── */}
          {tabs.length > 1 && (
            <div className="relative border-t border-border/30 px-6 sm:px-8 py-3">
              <div className="relative inline-flex">
                {tabs.map((tab) => {
                  const TabIcon = tab.icon;
                  const isActive = currentTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        "relative z-10 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl transition-colors",
                        isActive
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="machineDetailActiveTab"
                          className="absolute inset-0 rounded-xl bg-foreground/[0.05] border border-border/40"
                          transition={{ type: "spring", stiffness: 380, damping: 32 }}
                        />
                      )}
                      <span className="relative z-10 flex items-center gap-2">
                        <TabIcon className="h-4 w-4" />
                        {tab.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Tab content ──────────────────────────────── */}
          <div className="relative border-t border-border/30 bg-foreground/[0.012]">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentTab}
                initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
                transition={{ duration: 0.32, ease: easeOut }}
                className="p-4 sm:p-6"
              >
                {renderTabContent()}
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      </motion.div>
    </MachineLayout>
  );
}
