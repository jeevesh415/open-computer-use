"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  ShieldCheck,
  LockKey,
  Eye,
  FileText,
  Database,
  ArrowSquareOut,
} from "@phosphor-icons/react"
import { motion } from "framer-motion"
import { useTranslations } from "next-intl"

const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, delay, ease: [0.22, 1, 0.36, 1] as const },
})

const securityFeaturesMeta = [
  { icon: LockKey, key: "encryption" as const },
  { icon: Database, key: "rls" as const },
  { icon: Eye, key: "privacy" as const },
  { icon: ShieldCheck, key: "session" as const },
]

export function PrivacySection() {
  const t = useTranslations("privacySettings")

  return (
    <div className="space-y-8">

      {/* ─── Security Overview ────────────────────────────────────────── */}
      <motion.div {...fadeUp(0)}>
        <div className="rounded-xl border border-border/30 bg-card/20 p-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-foreground/40" weight="duotone" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">{t("dataProtected")}</h3>
              <p className="text-xs text-muted-foreground/50 mt-0.5">
                {t("dataProtectedDescription")}
              </p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ─── Security Features Grid ──────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {securityFeaturesMeta.map((feature, i) => {
          const Icon = feature.icon
          return (
            <motion.div
              key={feature.key}
              {...fadeUp(0.08 + i * 0.06)}
              className="rounded-xl border border-border/30 bg-card/20 p-4 space-y-3"
            >
              <div className="h-8 w-8 rounded-lg flex items-center justify-center bg-muted/50">
                <Icon className="h-4 w-4 text-foreground/40" weight="duotone" />
              </div>
              <div>
                <h4 className="text-sm font-medium">{t(`features.${feature.key}.title`)}</h4>
                <p className="text-xs text-muted-foreground/50 mt-1 leading-relaxed">
                  {t(`features.${feature.key}.description`)}
                </p>
              </div>
            </motion.div>
          )
        })}
      </div>

      {/* ─── Legal Links ─────────────────────────────────────────────── */}
      <motion.div {...fadeUp(0.35)} className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-foreground/[0.04] flex items-center justify-center">
            <FileText className="h-3 w-3 text-muted-foreground/50" weight="duotone" />
          </div>
          <h3 className="text-sm font-semibold">{t("legal")}</h3>
        </div>

        <div className="rounded-xl border border-border/30 bg-card/20 divide-y divide-border/20">
          {[
            { href: "/privacy", labelKey: "privacyPolicy" as const },
            { href: "/terms", labelKey: "termsOfService" as const },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              target="_blank"
              className="flex items-center justify-between px-5 py-4 hover:bg-muted/20 transition-colors group"
            >
              <div>
                <p className="text-sm font-medium">{t(`${link.labelKey}.title`)}</p>
                <p className="text-xs text-muted-foreground/50 mt-0.5">{t(`${link.labelKey}.description`)}</p>
              </div>
              <ArrowSquareOut className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors shrink-0" />
            </Link>
          ))}
        </div>
      </motion.div>
    </div>
  )
}
