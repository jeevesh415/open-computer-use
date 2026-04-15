"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { MachineStatus } from "@/types/machines.types";

interface MachineCardThumbnailProps {
  machineId: string;
  status: MachineStatus;
  platform?: string;
}

const PALETTES = [
  { a: "#6366f1", b: "#a78bfa", c: "#818cf8" },
  { a: "#3b82f6", b: "#8b5cf6", c: "#60a5fa" },
  { a: "#06b6d4", b: "#6366f1", c: "#22d3ee" },
  { a: "#8b5cf6", b: "#ec4899", c: "#c084fc" },
  { a: "#f43f5e", b: "#f97316", c: "#fb7185" },
  { a: "#10b981", b: "#06b6d4", c: "#34d399" },
  { a: "#f59e0b", b: "#ef4444", c: "#fbbf24" },
  { a: "#ec4899", b: "#8b5cf6", c: "#f9a8d4" },
  { a: "#14b8a6", b: "#3b82f6", c: "#2dd4bf" },
  { a: "#a855f7", b: "#f43f5e", c: "#d946ef" },
];

export function MachineCardThumbnail({ machineId, status, platform }: MachineCardThumbnailProps) {
  const { palette, blobPos } = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < machineId.length; i++) {
      hash = machineId.charCodeAt(i) + ((hash << 5) - hash);
    }
    const r = (seed: number) => {
      const x = Math.sin(seed * 9301 + 49297) * 49297;
      return x - Math.floor(x);
    };
    return {
      palette: PALETTES[Math.abs(hash) % PALETTES.length],
      blobPos: {
        x1: 15 + r(hash + 1) * 30,
        y1: 20 + r(hash + 2) * 30,
        x2: 55 + r(hash + 3) * 30,
        y2: 30 + r(hash + 4) * 40,
      },
    };
  }, [machineId]);

  const isDim = status === "stopped";
  const isBuilding = status === "creating" || status === "starting";
  const isActive = status === "running";
  const uid = machineId.slice(0, 8);

  return (
    <div
      className={cn(
        "relative h-24 w-full overflow-hidden transition-all duration-700",
        isDim && "opacity-40 saturate-[0.3]",
      )}
    >
      {/* Keyframes scoped to this card */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes mc-drift-${uid} {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(8px, -6px) scale(1.05); }
          66% { transform: translate(-6px, 8px) scale(0.97); }
        }
        @keyframes mc-drift2-${uid} {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-10px, 6px) scale(1.04); }
        }
        @keyframes mc-shimmer-${uid} {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
      ` }} />

      {/* Base: dark with subtle gradient */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(135deg, ${palette.a}15 0%, transparent 50%, ${palette.b}10 100%)`,
        }}
      />

      {/* Blob 1 — primary color, soft */}
      <div
        className="absolute will-change-transform rounded-full"
        style={{
          width: "70%",
          height: "140%",
          left: `${blobPos.x1}%`,
          top: `${blobPos.y1 - 40}%`,
          background: `radial-gradient(ellipse at center, ${palette.a}30, transparent 70%)`,
          filter: "blur(24px)",
          animation: isActive || isBuilding
            ? `mc-drift-${uid} ${isBuilding ? "4s" : "10s"} ease-in-out infinite`
            : "none",
        }}
      />

      {/* Blob 2 — secondary color */}
      <div
        className="absolute will-change-transform rounded-full"
        style={{
          width: "60%",
          height: "120%",
          left: `${blobPos.x2}%`,
          top: `${blobPos.y2 - 30}%`,
          background: `radial-gradient(ellipse at center, ${palette.b}25, transparent 70%)`,
          filter: "blur(20px)",
          animation: isActive || isBuilding
            ? `mc-drift2-${uid} ${isBuilding ? "3s" : "8s"} ease-in-out infinite`
            : "none",
        }}
      />

      {/* Running: subtle shimmer sweep */}
      {isActive && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `linear-gradient(105deg, transparent 40%, ${palette.c}08 50%, transparent 60%)`,
            animation: `mc-shimmer-${uid} 6s ease-in-out infinite`,
          }}
        />
      )}

      {/* Building: scan line */}
      {isBuilding && (
        <div
          className="absolute inset-x-0 h-px pointer-events-none"
          style={{
            background: `linear-gradient(90deg, transparent 10%, ${palette.c}60 50%, transparent 90%)`,
            boxShadow: `0 0 8px 1px ${palette.c}30`,
            animation: `mc-shimmer-${uid} 2s ease-in-out infinite`,
          }}
        />
      )}

      {/* Bottom fade into card body */}
      <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent" />
    </div>
  );
}
