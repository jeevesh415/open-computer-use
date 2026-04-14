"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { MachineStatus } from "@/types/machines.types";

interface MachineCardThumbnailProps {
  machineId: string;
  status: MachineStatus;
  platform?: string;
}

// Curated color palettes — ensures every card looks gorgeous
const PALETTES = [
  { from: "#6366f1", via: "#8b5cf6", to: "#a78bfa", accent: "#c4b5fd" }, // Indigo → Violet
  { from: "#3b82f6", via: "#6366f1", to: "#8b5cf6", accent: "#a5b4fc" }, // Blue → Indigo
  { from: "#06b6d4", via: "#3b82f6", to: "#6366f1", accent: "#67e8f9" }, // Cyan → Blue
  { from: "#8b5cf6", via: "#d946ef", to: "#f472b6", accent: "#e879f9" }, // Violet → Pink
  { from: "#f43f5e", via: "#e11d48", to: "#be123c", accent: "#fb7185" }, // Rose
  { from: "#10b981", via: "#14b8a6", to: "#06b6d4", accent: "#5eead4" }, // Emerald → Cyan
  { from: "#f59e0b", via: "#f97316", to: "#ef4444", accent: "#fbbf24" }, // Amber → Red
  { from: "#ec4899", via: "#8b5cf6", to: "#6366f1", accent: "#f9a8d4" }, // Pink → Indigo
  { from: "#14b8a6", via: "#0ea5e9", to: "#6366f1", accent: "#2dd4bf" }, // Teal → Indigo
  { from: "#a855f7", via: "#ec4899", to: "#f43f5e", accent: "#d946ef" }, // Purple → Rose
];

export function MachineCardThumbnail({ machineId, status, platform }: MachineCardThumbnailProps) {
  const generated = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < machineId.length; i++) {
      hash = machineId.charCodeAt(i) + ((hash << 5) - hash);
    }

    const rand = (seed: number) => {
      const x = Math.sin(seed * 9301 + 49297) * 49297;
      return x - Math.floor(x);
    };

    const palette = PALETTES[Math.abs(hash) % PALETTES.length];

    // Floating orbs — larger, visible, with glow
    const orbs = Array.from({ length: 5 }, (_, i) => ({
      x: rand(hash + i * 17) * 75 + 10,
      y: rand(hash + i * 31) * 55 + 15,
      size: rand(hash + i * 7) * 6 + 4,
      delay: rand(hash + i * 23) * 6,
      duration: 6 + rand(hash + i * 11) * 6,
      colorKey: i % 3 as 0 | 1 | 2,
    }));

    // Wave offsets for aurora bands
    const waveOffset = Math.abs(hash % 40);
    const waveAngle = 110 + (hash % 40);

    return { palette, orbs, waveOffset, waveAngle };
  }, [machineId]);

  const isActive = status === "running";
  const isDim = status === "stopped";
  const isBuilding = status === "creating" || status === "starting";
  const { palette, orbs, waveAngle } = generated;

  const orbColor = (key: 0 | 1 | 2) =>
    key === 0 ? palette.from : key === 1 ? palette.via : palette.to;

  return (
    <div
      className={cn(
        "relative h-[100px] w-full overflow-hidden transition-all duration-700",
        isDim && "opacity-50 saturate-50",
      )}
    >
      {/* Rich gradient base */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(${waveAngle}deg, ${palette.from}40, ${palette.via}30, ${palette.to}25)`,
        }}
      />

      {/* Aurora band 1 — large sweeping gradient wave */}
      <div
        className="absolute will-change-transform"
        style={{
          width: "140%",
          height: "120%",
          top: "-40%",
          left: "-20%",
          background: `radial-gradient(ellipse 50% 60% at 30% 50%, ${palette.from}55, transparent 70%)`,
          filter: "blur(16px)",
          animation: isActive
            ? "thumbBlob1 8s ease-in-out infinite"
            : isBuilding
              ? "thumbBlob1 4s ease-in-out infinite"
              : "none",
        }}
      />

      {/* Aurora band 2 */}
      <div
        className="absolute will-change-transform"
        style={{
          width: "130%",
          height: "130%",
          bottom: "-50%",
          right: "-15%",
          background: `radial-gradient(ellipse 45% 55% at 70% 50%, ${palette.to}50, transparent 70%)`,
          filter: "blur(20px)",
          animation: isActive
            ? "thumbBlob2 10s ease-in-out infinite"
            : isBuilding
              ? "thumbBlob2 5s ease-in-out infinite"
              : "none",
        }}
      />

      {/* Aurora band 3 — accent highlight */}
      <div
        className="absolute will-change-transform"
        style={{
          width: "80%",
          height: "80%",
          top: "10%",
          left: "30%",
          background: `radial-gradient(ellipse 50% 50% at 50% 50%, ${palette.via}35, transparent 70%)`,
          filter: "blur(14px)",
          animation: isActive
            ? "thumbBlob3 7s ease-in-out infinite"
            : isBuilding
              ? "thumbBlob3 3.5s ease-in-out infinite"
              : "none",
        }}
      />

      {/* Noise/grain texture overlay for depth */}
      <svg className="absolute inset-0 w-full h-full opacity-[0.15] mix-blend-overlay pointer-events-none">
        <filter id={`grain-${machineId.slice(0, 8)}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#grain-${machineId.slice(0, 8)})`} />
      </svg>

      {/* Subtle grid lines */}
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)
          `,
          backgroundSize: "24px 24px",
        }}
      />

      {/* Floating orbs with glow */}
      {orbs.map((orb, i) => (
        <div
          key={i}
          className="absolute rounded-full will-change-transform"
          style={{
            width: orb.size,
            height: orb.size,
            left: `${orb.x}%`,
            top: `${orb.y}%`,
            backgroundColor: orbColor(orb.colorKey),
            opacity: isActive ? 0.7 : isBuilding ? 0.5 : 0.2,
            boxShadow: `0 0 ${orb.size * 2}px ${orb.size}px ${orbColor(orb.colorKey)}50`,
            animation: isActive
              ? `thumbFloat ${orb.duration}s ease-in-out ${orb.delay}s infinite`
              : isBuilding
                ? `thumbAssemble ${orb.duration * 0.5}s ease-in-out ${orb.delay}s infinite`
                : "none",
            transition: "opacity 0.7s ease",
          }}
        />
      ))}

      {/* Building scan line */}
      {isBuilding && (
        <div
          className="absolute inset-x-0 h-[2px]"
          style={{
            background: `linear-gradient(90deg, transparent 5%, ${palette.accent}, transparent 95%)`,
            boxShadow: `0 0 12px 2px ${palette.accent}60`,
            animation: "thumbScan 2.5s ease-in-out infinite",
          }}
        />
      )}

      {/* Running: breathing glow at center */}
      {isActive && (
        <div
          className="absolute rounded-full"
          style={{
            width: 50,
            height: 50,
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            background: `radial-gradient(circle, ${palette.accent}30, transparent 70%)`,
            animation: "thumbPulseRing 4s ease-out infinite",
          }}
        />
      )}

      {/* Platform watermark — frosted pill in bottom-right */}
      {platform && (
        <div
          className="absolute bottom-2 right-2.5 flex items-center gap-1 rounded-md px-1.5 py-0.5"
          style={{
            background: "rgba(255,255,255,0.1)",
            backdropFilter: "blur(8px)",
          }}
        >
          <span className="text-[9px] font-medium text-white/60 tracking-wide uppercase">
            {platform === "win32" ? "WIN" : platform === "darwin" ? "MAC" : "LNX"}
          </span>
        </div>
      )}

      {/* Bottom fade */}
      <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-card via-card/60 to-transparent" />
    </div>
  );
}
