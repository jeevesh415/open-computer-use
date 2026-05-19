"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, Monitor, Globe, Terminal, MousePointer2, ScanLine, Cpu, MoreHorizontal, Zap, ShieldCheck, Download, RefreshCw, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import Link from "next/link";
import { WindowsIcon, AppleIcon } from "@/components/icons/platform-icons";
import { MachineCard } from "@/app/components/machines/machine-card";
import { CreateMachineDialog } from "@/app/components/machines/create-machine-dialog";
import { UsageStats } from "@/app/components/machines/usage-stats";
import { motion, AnimatePresence } from "framer-motion";
import type { UserMachine, MachineUsage } from "@/types/machines.types";
import { PageLoader } from "@/components/common/page-loader";

interface MachinesData {
  machines: UserMachine[];
  limits: {
    max_machines: number;
    max_cpu_cores: number;
    max_memory_gb: number;
    max_storage_gb: number;
  };
  usage: {
    machines_count: number;
    total_cpu_cores: number;
    total_memory_gb: number;
    total_storage_gb: number;
  };
}

export function MachinesContent() {
  const router = useRouter();
  const t = useTranslations("machines");
  const tLoader = useTranslations("pageLoaders.machines");
  const [loading, setLoading] = useState(true);
  const [machines, setMachines] = useState<UserMachine[]>([]);
  const [limits, setLimits] = useState<MachinesData["limits"]>({
    max_machines: 3,
    max_cpu_cores: 4,
    max_memory_gb: 8,
    max_storage_gb: 50,
  });
  const [usage, setUsage] = useState<MachinesData["usage"]>({
    machines_count: 0,
    total_cpu_cores: 0,
    total_memory_gb: 0,
    total_storage_gb: 0,
  });
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [statusPollingIntervals, setStatusPollingIntervals] = useState<Map<string, NodeJS.Timeout>>(new Map());
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [fastPollingTimeout, setFastPollingTimeout] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    fetchMachines();
  }, []);

  // Single shared poll for ALL transitioning machines instead of one interval per machine.
  // Cleans up on unmount; restarts only when the set of transitioning IDs changes.
  useEffect(() => {
    const transitioningIds = machines
      .filter(m => ["creating", "starting", "stopping", "deleting"].includes(m.status))
      .map(m => m.id);

    if (transitioningIds.length === 0) return;

    const interval = setInterval(async () => {
      try {
        const response = await fetch("/api/machines");
        if (!response.ok) return;
        const data: MachinesData = await response.json();
        setMachines(data.machines);
        setLimits(data.limits);
        setUsage(data.usage);
      } catch (error) {
        console.error("Error polling machine status:", error);
      }
    }, 5000);

    return () => clearInterval(interval);
    // Only restart when the set of transitioning machine IDs actually changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machines.filter(m => ["creating", "starting", "stopping", "deleting"].includes(m.status)).map(m => m.id).join(",")]);

  useEffect(() => {
    return () => {
      statusPollingIntervals.forEach(interval => clearInterval(interval));
      if (fastPollingTimeout) {
        clearTimeout(fastPollingTimeout);
      }
    };
  }, []);

  const fetchMachines = async () => {
    try {
      const response = await fetch("/api/machines");

      if (!response.ok) {
        if (response.status === 401) {
          router.push("/auth");
          return;
        }
        throw new Error("Failed to fetch machines");
      }

      const data: MachinesData = await response.json();

      setMachines(data.machines);
      setLimits(data.limits);
      setUsage(data.usage);

      data.machines.forEach(machine => {
        if ((machine.status === "creating" || machine.status === "starting") && !statusPollingIntervals.has(machine.id)) {
          pollMachineStatus(machine.id);
        }
      });
    } catch (error) {
      console.error("Error fetching machines:", error);
      toast.error(t("toasts.fetchFailed"));
    } finally {
      setLoading(false);
    }
  };

  const pollMachineStatus = (machineId: string) => {
    const interval = setInterval(async () => {
      try {
        const response = await fetch("/api/machines");
        if (!response.ok) {
          console.error("Failed to poll machine status");
          return;
        }

        const data: MachinesData = await response.json();
        const machine = data.machines.find(m => m.id === machineId);

        if (!machine || (machine.status !== "creating" && machine.status !== "starting")) {
          clearInterval(interval);
          statusPollingIntervals.delete(machineId);

          setMachines(data.machines);

          const machine = data.machines.find(m => m.id === machineId);
          if (machine?.status === "running") {
            clearInterval(interval);
            statusPollingIntervals.delete(machineId);
            toast.success(`${machine.displayName} is now running!`, {
              description: t("toasts.readyOpen"),
              action: {
                label: t("toasts.open"),
                onClick: () => window.location.href = `/machines/${machineId}`,
              },
            });
          } else if (machine?.status === "error") {
            clearInterval(interval);
            statusPollingIntervals.delete(machineId);
            toast.error(`${machine.displayName} encountered an error`, {
              description: t("toasts.createFailed"),
            });
          }
        }
      } catch (error) {
        console.error("Error polling machine status:", error);
      }
    }, 5000);

    statusPollingIntervals.set(machineId, interval);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchMachines();
    setRefreshing(false);
  };

  const handleMachineCreated = async () => {
    await fetchMachines();

    if (fastPollingTimeout) {
      clearTimeout(fastPollingTimeout);
    }

    // Brief fast-poll to pick up the new machine, then the shared
    // transitioning-machine interval (5s) takes over.
    let pollCount = 0;
    const fastPoll = async () => {
      pollCount++;
      await fetchMachines();

      if (pollCount < 4) {
        const timeout = setTimeout(fastPoll, 3000);
        setFastPollingTimeout(timeout);
      } else {
        setFastPollingTimeout(null);
      }
    };

    const timeout = setTimeout(fastPoll, 2000);
    setFastPollingTimeout(timeout);
  };

  const handleMachineUpdated = (updatedMachine: UserMachine) => {
    setMachines(machines.map(m =>
      m.id === updatedMachine.id ? updatedMachine : m
    ));
  };

  const handleMachineDeleted = (machineId: string) => {
    setMachines(machines.filter(m => m.id !== machineId));
    toast.success(t("toasts.deleted"));
  };

  const runningMachines = machines.filter(m => m.status === "running").length;
  const creatingMachines = machines.filter(m => m.status === "creating").length;
  const stoppedMachines = machines.filter(m => m.status === "stopped").length;
  const totalMachines = machines.length;

  const filteredMachines = statusFilter === "all"
    ? machines
    : machines.filter(m => m.status === statusFilter);

  const statusFilters = [
    { id: "all", label: t("filters.all"), count: totalMachines },
    { id: "running", label: t("filters.running"), count: runningMachines },
    { id: "creating", label: t("filters.creating"), count: creatingMachines },
    { id: "stopped", label: t("filters.stopped"), count: stoppedMachines },
  ];

  return (
    <PageLoader
      isLoading={loading}
      title={tLoader("title")}
      description={tLoader("description")}
    >
    <div className="h-full overflow-y-auto overflow-x-hidden scrollbar-invisible relative">
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div
          className="absolute -top-[30%] -right-[15%] h-[60%] w-[50%] rounded-full opacity-[0.02] dark:opacity-[0.04] blur-[120px]"
          style={{ background: "radial-gradient(circle, currentColor, transparent 70%)" }}
        />
        <div
          className="absolute -bottom-[20%] -left-[10%] h-[50%] w-[40%] rounded-full opacity-[0.015] dark:opacity-[0.035] blur-[100px]"
          style={{ background: "radial-gradient(circle, currentColor, transparent 70%)" }}
        />
      </div>

      <div className="container mx-auto p-4 sm:p-6 lg:p-8 max-w-7xl space-y-6 relative z-10">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
        >
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl sm:text-3xl font-medium tracking-tight">{t("title")}</h1>
              {limits.max_machines > 0 && (
                <span className="inline-flex items-center rounded-full border border-border/60 bg-background px-2.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                  {usage.machines_count} / {limits.max_machines}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1.5">
              <p className="text-muted-foreground text-sm">
                {t("subtitle")}
              </p>
              <Link
                href="/guide?tab=machines"
                className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-foreground/[0.05] px-2.5 py-1 text-xs font-medium text-foreground/70 hover:text-foreground hover:border-border hover:bg-foreground/[0.08] transition-all"
              >
                <BookOpen className="h-3.5 w-3.5" />
                {t("guide")}
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
              className="h-9 w-9 p-0 rounded-xl text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
            <Button
              onClick={() => setShowCreateDialog(true)}
              size="sm"
              className="h-9 rounded-xl gap-2 px-4 font-medium"
            >
              <Plus className="h-4 w-4" />
              {t("newMachine")}
            </Button>
          </div>
        </motion.div>

        {/* Desktop App Banner */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
          className="hidden sm:flex items-center justify-between gap-3 rounded-xl border border-border/40 bg-card/50 backdrop-blur-sm px-4 py-3"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-1.5 text-muted-foreground/50">
              <WindowsIcon className="h-3.5 w-3.5" />
              <AppleIcon className="h-3.5 w-3.5" />
            </div>
            <p className="text-sm text-muted-foreground truncate">
              {t("desktopPromo.text")}
            </p>
          </div>
          <Link
            href="/download"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-foreground/[0.04] hover:bg-foreground/[0.08] px-3 py-1.5 text-xs font-medium text-foreground transition-colors"
          >
            <Download className="h-3 w-3" />
            {t("desktopPromo.cta")}
          </Link>
        </motion.div>

        {/* Status Filters */}
        {machines.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-wrap gap-1.5"
          >
            {statusFilters.map((filter) => (
              <button
                key={filter.id}
                onClick={() => setStatusFilter(filter.id)}
                className={`
                  px-3.5 py-1.5 rounded-lg text-sm transition-all duration-200
                  ${statusFilter === filter.id
                    ? 'bg-foreground text-background font-medium shadow-sm'
                    : 'bg-transparent hover:bg-foreground/[0.05] text-muted-foreground hover:text-foreground'
                  }
                `}
              >
                <span className="flex items-center gap-2">
                  {filter.label}
                  {filter.count > 0 && (
                    <span className={`
                      text-[11px] tabular-nums px-1.5 py-0.5 rounded-full
                      ${statusFilter === filter.id
                        ? 'bg-background/20'
                        : 'bg-foreground/[0.06]'
                      }
                    `}>
                      {filter.count}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </motion.div>
        )}

        {/* Machines Grid */}
        {machines.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="relative rounded-2xl border border-border/30 bg-card/30 backdrop-blur-sm overflow-hidden"
          >
            {/* Ambient blobs */}
            <div className="pointer-events-none absolute -top-20 -left-20 h-72 w-72 rounded-full bg-foreground/[0.02] blur-3xl" />
            <div className="pointer-events-none absolute -bottom-20 -right-20 h-72 w-72 rounded-full bg-foreground/[0.015] blur-3xl" />

            <div className="relative flex flex-col items-center px-6 py-16 text-center">
              {/* Capability icons */}
              <div className="mb-10 flex items-center gap-2">
                {[Globe, Terminal, MousePointer2, ScanLine, Cpu].map((Icon, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.2 + i * 0.06, ease: [0.22, 1, 0.36, 1] }}
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/40 bg-background/60 text-muted-foreground/70"
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </motion.div>
                ))}
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/40 bg-background/60 text-muted-foreground/40"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </motion.div>
              </div>

              {/* Headline */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <h2 className="text-2xl font-medium tracking-tight mb-2.5">
                  {t("emptyState.title")}
                </h2>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed mb-12">
                  {t("emptyState.description")}
                </p>
              </motion.div>

              {/* Feature cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-2xl mb-12">
                {[
                  {
                    icon: MousePointer2,
                    title: t("emptyState.feature1.title"),
                    desc: t("emptyState.feature1.description"),
                  },
                  {
                    icon: Zap,
                    title: t("emptyState.feature2.title"),
                    desc: t("emptyState.feature2.description"),
                  },
                  {
                    icon: ShieldCheck,
                    title: t("emptyState.feature3.title"),
                    desc: t("emptyState.feature3.description"),
                  },
                ].map(({ icon: Icon, title, desc }, i) => (
                  <motion.div
                    key={title}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.4 + i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                    className="rounded-xl border border-border/30 bg-background/30 backdrop-blur-sm px-4 py-4 text-left"
                  >
                    <div className="mb-2.5 flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/[0.04]">
                      <Icon className="h-4 w-4 text-foreground/60" />
                    </div>
                    <p className="text-sm font-medium mb-1">{title}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
                  </motion.div>
                ))}
              </div>

              {/* CTA */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.55, ease: [0.22, 1, 0.36, 1] }}
              >
                <Button onClick={() => setShowCreateDialog(true)} size="lg" className="gap-2 rounded-xl h-11 px-6">
                  <Plus className="h-4 w-4" />
                  {t("emptyState.cta")}
                </Button>
              </motion.div>
            </div>
          </motion.div>
        ) : filteredMachines.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <Card className="border-border/30 bg-card/30 backdrop-blur-sm">
              <CardContent className="flex flex-col items-center justify-center py-14">
                <Monitor className="h-10 w-10 text-muted-foreground/40 mb-4" />
                <h3 className="text-base font-medium mb-1.5">{statusFilter !== 'all' ? t("noFilteredMachines", { filter: statusFilter }) : t("noMachines")}</h3>
                <p className="text-sm text-muted-foreground">
                  {statusFilter === 'all'
                    ? t("noMachines")
                    : t("noFilteredDescription", { filter: statusFilter })}
                </p>
              </CardContent>
            </Card>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredMachines.map((machine, i) => (
              <motion.div
                key={machine.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.05 + i * 0.04, ease: [0.22, 1, 0.36, 1] }}
              >
                <MachineCard
                  machine={machine}
                  onUpdate={handleMachineUpdated}
                  onDelete={handleMachineDeleted}
                />
              </motion.div>
            ))}
          </div>
        )}

        {/* Create Machine Dialog */}
        <CreateMachineDialog
          open={showCreateDialog}
          onOpenChange={(open) => {
            setShowCreateDialog(open);
            if (!open && showCreateDialog) {
              handleMachineCreated();
            }
          }}
          onMachineCreated={handleMachineCreated}
        />
      </div>
    </div>
    </PageLoader>
  );
}
