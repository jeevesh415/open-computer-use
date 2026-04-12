"use client"

import { CoastyIcon } from "@/components/icons/coasty"
import { GithubLogoIcon } from "@phosphor-icons/react"
import { motion } from "framer-motion"

const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, delay, ease: [0.22, 1, 0.36, 1] as const },
})

export function AppInfoContent() {
  return (
    <div className="space-y-8">

      {/* ─── Brand Header ────────────────────────────────────────────── */}
      <motion.div {...fadeUp(0)} className="flex flex-col items-center text-center pt-4 pb-2">
        <div className="h-14 w-14 rounded-2xl bg-primary/[0.08] flex items-center justify-center mb-4 ring-1 ring-primary/10">
          <CoastyIcon className="h-7 w-7 text-primary" />
        </div>
        <h2 className="text-lg font-bold tracking-tight">Coasty</h2>
        <p className="text-xs text-muted-foreground/40 mt-1 font-medium">
          AI Collaboration Platform
        </p>
      </motion.div>

      {/* ─── Description ─────────────────────────────────────────────── */}
      <motion.div {...fadeUp(0.1)} className="rounded-xl border border-border/30 bg-card/20 p-5">
        <p className="text-sm text-muted-foreground/70 leading-relaxed">
          Coasty transforms how you work with AI — from browser automation and terminal operations
          to multi-agent swarms that run in parallel across cloud VMs or right on your desktop.
          Build, automate, and scale complex workflows with natural language.
        </p>
      </motion.div>

      {/* ─── Stats / Info ────────────────────────────────────────────── */}
      <motion.div {...fadeUp(0.2)} className="grid grid-cols-3 gap-3">
        {[
          { label: "Agents", value: "50+", sub: "Commands" },
          { label: "Models", value: "5+", sub: "AI providers" },
          { label: "Platforms", value: "3", sub: "Win/Mac/Linux" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border/30 bg-card/20 p-4 text-center">
            <div className="text-xl font-bold tracking-tight text-foreground">{stat.value}</div>
            <div className="text-[10px] text-muted-foreground/40 font-medium uppercase tracking-wider mt-1">
              {stat.sub}
            </div>
          </div>
        ))}
      </motion.div>

      {/* ─── Links ───────────────────────────────────────────────────── */}
      <motion.div {...fadeUp(0.3)}>
        <a
          href="https://github.com/coasty-ai"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-xl border border-border/30 bg-card/20 px-5 py-4 hover:bg-muted/20 transition-colors group"
        >
          <div className="h-8 w-8 rounded-lg bg-foreground/[0.04] flex items-center justify-center">
            <GithubLogoIcon className="h-4 w-4 text-muted-foreground/60" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">Open Source</p>
            <p className="text-xs text-muted-foreground/40 mt-0.5">View our repos on GitHub</p>
          </div>
          <span className="text-xs text-muted-foreground/30 group-hover:text-muted-foreground/50 transition-colors">
            coasty-ai
          </span>
        </a>
      </motion.div>
    </div>
  )
}
