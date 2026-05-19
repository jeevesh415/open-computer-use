"use client";

import { ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ArrowLeft, Monitor, Activity, Terminal, Settings, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MachineLayoutProps {
  children: ReactNode;
  machineId?: string;
  machineName?: string;
  machineStatus?: string;
  showBackButton?: boolean;
}

interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: ReactNode;
}

export function MachineLayout({
  children,
  machineId,
  machineName,
  machineStatus,
  showBackButton = true
}: MachineLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();

  const breadcrumbItems: BreadcrumbItem[] = [];

  if (pathname.includes("/sessions")) {
    breadcrumbItems.push({
      label: "Sessions",
      icon: <Activity className="h-3.5 w-3.5" />
    });
  } else if (pathname.includes("/terminal")) {
    breadcrumbItems.push({
      label: "Terminal",
      icon: <Terminal className="h-3.5 w-3.5" />
    });
  } else if (pathname.includes("/settings")) {
    breadcrumbItems.push({
      label: "Settings",
      icon: <Settings className="h-3.5 w-3.5" />
    });
  }

  const statusColor = machineStatus === "running"
    ? "bg-emerald-500"
    : machineStatus === "stopped"
    ? "bg-foreground/20"
    : machineStatus === "error"
    ? "bg-destructive"
    : machineStatus === "creating" || machineStatus === "starting"
    ? "bg-blue-500"
    : "bg-amber-500";

  return (
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

      {/* Breadcrumb header */}
      <div className="sticky top-0 z-20 bg-transparent">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl">
          <div className="flex items-center h-12 gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.back()}
              className="h-8 w-8 p-0 rounded-full bg-background/80 backdrop-blur-md border border-border/40 shadow-sm text-muted-foreground hover:text-foreground hover:bg-background/90 shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>

            {(machineName || breadcrumbItems.length > 0) && (
              <div className="flex items-center gap-1.5 text-sm min-w-0 h-8 px-3 rounded-full bg-background/80 backdrop-blur-md border border-border/40 shadow-sm">
                <button
                  onClick={() => router.push("/machines")}
                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  Machines
                </button>

                {machineName && (
                  <>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                    <div className="flex items-center gap-2 min-w-0">
                      {machineStatus && (
                        <div className={`h-2 w-2 rounded-full shrink-0 ${statusColor} ${
                          (machineStatus === "creating" || machineStatus === "starting" || machineStatus === "stopping") ? "animate-pulse" : ""
                        }`} />
                      )}
                      <span className="font-medium text-foreground truncate">{machineName}</span>
                    </div>
                  </>
                )}

                {breadcrumbItems.map((item, index) => (
                  <div key={index} className="flex items-center shrink-0">
                    <ChevronRight className="h-3.5 w-3.5 mx-1 text-muted-foreground/40" />
                    <span className="flex items-center gap-1.5 text-foreground font-medium">
                      {item.icon}
                      <span>{item.label}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl relative z-10">
        {children}
      </div>
    </div>
  );
}
