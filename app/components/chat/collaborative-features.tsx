"use client"

import { cn } from "@/lib/utils"
import { motion } from "motion/react"
import { useTranslations } from "next-intl"

const featureKeys = [
  { key: "smartSearch", bgColor: "bg-blue-500/10" },
  { key: "collaborate", bgColor: "bg-purple-500/10" },
  { key: "globalAccess", bgColor: "bg-green-500/10" },
  { key: "aiModels", bgColor: "bg-orange-500/10" },
  { key: "freeForever", bgColor: "bg-pink-500/10" },
  { key: "privateSecure", bgColor: "bg-cyan-500/10" },
] as const

interface CollaborativeFeaturesProps {
  className?: string
  variant?: "default" | "compact"
}

export function CollaborativeFeatures({
  className,
  variant = "default"
}: CollaborativeFeaturesProps) {
  const t = useTranslations("collaborativeFeatures")

  const features = featureKeys.map((f) => ({
    label: t(`${f.key}.title`),
    description: t(`${f.key}.description`),
    bgColor: f.bgColor,
  }))

  return (
    <div className={cn("w-full", className)}>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
        {features.map((feature, index) => {
          return (
            <motion.div
              key={feature.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ 
                opacity: 1, 
                y: 0,
                transition: {
                  delay: index * 0.1,
                  duration: 0.5,
                  ease: "easeOut"
                }
              }}
              whileHover={{ scale: 1.05 }}
              className={cn(
                "group relative overflow-hidden rounded-lg border border-muted-foreground/10",
                "bg-gradient-to-br from-muted/5 to-muted/10",
                "hover:border-muted-foreground/20 transition-all duration-300",
                "backdrop-blur-sm",
                feature.bgColor
              )}
            >
              <div className={cn(
                "p-3 sm:p-4",
                variant === "compact" ? "space-y-1" : "space-y-2"
              )}>
                <h3 className={cn(
                  "font-semibold",
                  variant === "compact" ? "text-xs" : "text-sm"
                )}>
                  {feature.label}
                </h3>
                <p className={cn(
                  "text-muted-foreground",
                  variant === "compact" ? "text-[10px]" : "text-xs"
                )}>
                  {feature.description}
                </p>
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}