"use client"

/**
 * CostSection — clean side-by-side comparison.
 *
 * One card, one grid: label / manual / coasty. No center rail, no
 * eyebrow rails, no icon boxes — the contrast is carried by typography
 * alone (manual values dim, Coasty values bold). Shrinks gracefully when
 * the section is squeezed by the floating hero cards in narrow mode.
 */

import { motion } from "framer-motion"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { LandingSectionTopGlow, LandingSectionHeader } from "../section-shell"

const ROW_KEYS = ["timePerTask", "availability", "setupTime", "errorRate", "scaling", "auditTrail"] as const
type RowKey = (typeof ROW_KEYS)[number]

const EASE = [0.22, 1, 0.36, 1] as const

export function CostSection({ isMobile }: { isMobile: boolean }) {
  const t = useTranslations()
  const tc = useTranslations("common")

  return (
    <section
      id="cost"
      className="relative py-20 sm:py-24 lg:py-32 px-8 sm:px-10 lg:px-12"
    >
      <LandingSectionTopGlow />
      <div className="max-w-3xl w-full mx-auto">
        <LandingSectionHeader
          title={t("comparison.title")}
          subtitle={t("comparison.subtitle")}
          isMobile={isMobile}
        />

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0, margin: "0px 0px -80px 0px" }}
          transition={{ duration: 0.55, ease: EASE }}
          className={cn(
            "relative rounded-2xl border border-foreground/10 bg-card/40 backdrop-blur-[2px] overflow-hidden"
          )}
        >
          {/* Column header */}
          <div
            className={cn(
              "grid items-center border-b border-foreground/10",
              "grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.1fr)]",
              isMobile ? "gap-x-3 px-4 py-3" : "gap-x-5 px-6 py-4 sm:gap-x-8 sm:px-8",
              "group-data-[narrow]/feat:gap-x-3 group-data-[narrow]/feat:px-4 group-data-[narrow]/feat:py-3"
            )}
          >
            <span aria-hidden />
            <span
              className={cn(
                "font-mono uppercase tracking-[0.18em] text-foreground/45",
                isMobile ? "text-[10px]" : "text-[11px]",
                "group-data-[narrow]/feat:text-[10px]"
              )}
            >
              {t("comparison.manual.title")}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-2 font-mono uppercase tracking-[0.18em] text-foreground",
                isMobile ? "text-[10px]" : "text-[11px]",
                "group-data-[narrow]/feat:text-[10px]"
              )}
            >
              <span>{t("comparison.coasty.title")}</span>
              <span
                className={cn(
                  "inline-flex items-center rounded-full border border-foreground/20 px-1.5 py-0.5 normal-case tracking-[0.14em] text-foreground/60",
                  isMobile ? "text-[8px]" : "text-[9px]",
                  "group-data-[narrow]/feat:hidden"
                )}
              >
                {tc("recommended")}
              </span>
            </span>
          </div>

          {/* Comparison rows */}
          <div>
            {ROW_KEYS.map((key, i) => (
              <ComparisonRow
                key={key}
                rowKey={key}
                isLast={i === ROW_KEYS.length - 1}
                isMobile={isMobile}
                label={t(`comparison.rows.${key}`)}
                manual={t(`comparison.manualValues.${key}`)}
                coasty={t(`comparison.coastyValues.${key}`)}
                index={i}
              />
            ))}
          </div>
        </motion.div>

        {/* Footer line — single CTA, no chrome */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0, margin: "0px 0px -80px 0px" }}
          transition={{ duration: 0.5, ease: EASE, delay: 0.2 }}
          className={cn(
            "mt-8 flex items-center justify-center gap-4 sm:mt-10",
            isMobile ? "flex-col" : "flex-row",
            "group-data-[narrow]/feat:flex-col group-data-[narrow]/feat:gap-3"
          )}
        >
          <p
            className={cn(
              "text-foreground/60",
              isMobile ? "text-sm text-center" : "text-sm sm:text-base"
            )}
          >
            {t("comparison.bottomBar.automateTasksThat")}{" "}
            <span className="text-foreground">
              {t("comparison.bottomBar.hoursManually")}
            </span>
          </p>
          <Link
            href="/auth"
            className={cn(
              "group inline-flex items-center justify-center gap-2",
              "rounded-full bg-foreground text-background",
              "shadow-[0_1px_0_0_rgba(255,255,255,0.08)_inset,0_6px_18px_-10px_rgba(0,0,0,0.22)]",
              "dark:shadow-[0_1px_0_0_rgba(0,0,0,0.10)_inset,0_6px_18px_-10px_rgba(0,0,0,0.40)]",
              "font-medium transition-[box-shadow,transform] duration-300",
              "hover:scale-[1.012] active:scale-[0.985]",
              isMobile ? "px-5 py-2.5 text-sm w-full max-w-xs" : "px-5 py-2.5 text-sm whitespace-nowrap"
            )}
          >
            <span>Try Coasty Free</span>
            <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5" strokeWidth={2} />
          </Link>
        </motion.div>
      </div>
    </section>
  )
}

function ComparisonRow({
  rowKey,
  isLast,
  isMobile,
  label,
  manual,
  coasty,
  index,
}: {
  rowKey: RowKey
  isLast: boolean
  isMobile: boolean
  label: string
  manual: string
  coasty: string
  index: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0, margin: "0px 0px -80px 0px" }}
      transition={{ duration: 0.45, ease: EASE, delay: 0.1 + index * 0.05 }}
      className={cn(
        "grid items-center transition-colors duration-300",
        "grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.1fr)]",
        isMobile ? "gap-x-3 px-4 py-3" : "gap-x-5 px-6 py-3.5 sm:gap-x-8 sm:px-8",
        "group-data-[narrow]/feat:gap-x-3 group-data-[narrow]/feat:px-4 group-data-[narrow]/feat:py-3",
        !isLast && "border-b border-foreground/[0.06]",
        "hover:bg-foreground/[0.02]"
      )}
      data-row-key={rowKey}
    >
      <span
        className={cn(
          "text-foreground/70",
          isMobile ? "text-xs" : "text-sm",
          "group-data-[narrow]/feat:text-xs"
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "text-foreground/45",
          isMobile ? "text-xs" : "text-sm",
          "group-data-[narrow]/feat:text-xs"
        )}
      >
        {manual}
      </span>
      <span
        className={cn(
          "font-medium text-foreground",
          isMobile ? "text-xs" : "text-sm",
          "group-data-[narrow]/feat:text-xs"
        )}
      >
        {coasty}
      </span>
    </motion.div>
  )
}
