"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CoastyIcon } from "@/components/icons/coasty"
import { cn } from "@/lib/utils"
import {
  ArrowRight,
  Check,
  User,
  Building2,
  Globe,
  Sparkles,
  Briefcase,
  Megaphone,
  Code,
  PenTool,
  BarChart3,
  Zap,
  Bot,
  FileText,
  Mail,
  Search,
  ShoppingCart,
  TestTubes,
  Monitor,
  BookOpen,
  Clock,
  Network,
  MousePointer2,
  Workflow,
  Cpu,
  Eye,
} from "lucide-react"
import { useTranslations } from "next-intl"

interface ExistingData {
  role: string
  company: string
  website: string
  team_size: string
  referral_source: string
  use_case: string
}

interface OnboardingFlowProps {
  userId: string
  initialName: string
  initialEmail: string
  isExistingUser?: boolean
  existingData?: ExistingData
}

const ROLES = [
  { value: "founder", labelKey: "founder", icon: Sparkles },
  { value: "developer", labelKey: "developer", icon: Code },
  { value: "marketer", labelKey: "marketer", icon: Megaphone },
  { value: "designer", labelKey: "designer", icon: PenTool },
  { value: "product_manager", labelKey: "product_manager", icon: Briefcase },
  { value: "data_analyst", labelKey: "data_analyst", icon: BarChart3 },
  { value: "operations", labelKey: "operations", icon: Zap },
  { value: "other", labelKey: "other", icon: User },
]

const TEAM_SIZES = [
  { value: "solo", labelKey: "solo" },
  { value: "2-5", labelKey: "2-5" },
  { value: "6-20", labelKey: "6-20" },
  { value: "21-50", labelKey: "21-50" },
  { value: "51-200", labelKey: "51-200" },
  { value: "200+", labelKey: "200+" },
]

const REFERRAL_SOURCES = [
  { value: "twitter", labelKey: "twitter" },
  { value: "linkedin", labelKey: "linkedin" },
  { value: "google", labelKey: "google" },
  { value: "youtube", labelKey: "youtube" },
  { value: "friend", labelKey: "friend" },
  { value: "producthunt", labelKey: "producthunt" },
  { value: "reddit", labelKey: "reddit" },
  { value: "other", labelKey: "other" },
]

const USE_CASES = [
  { value: "web_scraping", labelKey: "web_scraping", icon: Search },
  { value: "browser_automation", labelKey: "browser_automation", icon: Globe },
  { value: "data_entry", labelKey: "data_entry", icon: FileText },
  { value: "email_outreach", labelKey: "email_outreach", icon: Mail },
  { value: "testing", labelKey: "testing", icon: TestTubes },
  { value: "ecommerce", labelKey: "ecommerce", icon: ShoppingCart },
  { value: "social_media", labelKey: "social_media", icon: Megaphone },
  { value: "general_automation", labelKey: "general_automation", icon: Bot },
]

const TOTAL_STEPS = 5

export function OnboardingFlow({
  userId,
  initialName,
  initialEmail,
  isExistingUser = false,
  existingData,
}: OnboardingFlowProps) {
  const t = useTranslations("onboarding")
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Form state — pre-fill from existing data if available
  const [displayName, setDisplayName] = useState(initialName)
  const [company, setCompany] = useState(existingData?.company || "")
  const [website, setWebsite] = useState(existingData?.website || "")
  const [roles, setRoles] = useState<string[]>(
    existingData?.role ? existingData.role.split(",") : []
  )
  const [teamSize, setTeamSize] = useState(existingData?.team_size || "")
  const [referralSource, setReferralSource] = useState(existingData?.referral_source || "")
  const [useCases, setUseCases] = useState<string[]>(
    existingData?.use_case ? existingData.use_case.split(",") : []
  )

  const canProceed = () => {
    switch (step) {
      case 0:
        return displayName.trim().length > 0 && website.trim().length > 0
      case 1:
        return roles.length > 0 && teamSize.length > 0
      case 2:
        return referralSource.length > 0
      case 3:
        return useCases.length > 0
      case 4:
        return true
      default:
        return true
    }
  }

  const handleNext = () => {
    if (step < TOTAL_STEPS - 1) {
      setStep(step + 1)
    } else {
      handleSubmit()
    }
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: displayName.trim(),
          role: roles.join(","),
          company: company.trim() || null,
          website: website.trim() || null,
          team_size: teamSize || null,
          referral_source: referralSource,
          use_case: useCases.join(",") || null,
        }),
      })

      if (res.ok) {
        // Hard navigation, not router.push + router.refresh.
        //
        // The onboarding completion flips users.onboarding_completed
        // from false → true server-side. The home page's RSC reads
        // that flag (app/page.tsx) to decide whether to bounce the
        // user back to /onboarding. router.push("/") + router.refresh()
        // races: push starts the nav using the still-cached "/" RSC
        // payload (where the flag was false), refresh invalidates the
        // SOURCE route's data, and we end up on / with stale auth
        // state — the LandingPage cinematic flashes before the next
        // tick reconciles. window.location.replace forces a full
        // request that re-runs every server component with the
        // updated DB row and lands directly in the chat.
        if (typeof window !== "undefined") {
          window.location.replace("/")
        }
        return
      } else {
        console.error("Onboarding save failed")
        setIsSubmitting(false)
      }
    } catch (err) {
      console.error("Onboarding error:", err)
      setIsSubmitting(false)
    }
  }

  const handleSkip = () => {
    handleSubmit()
  }

  return (
    <div className="relative flex h-dvh w-full flex-col bg-background overflow-hidden">
      {/* 3D Computer background animation */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* Subtle grid */}
        <div
          className="absolute inset-0 opacity-[0.012] dark:opacity-[0.025]"
          style={{
            backgroundImage: `linear-gradient(rgba(128,128,128,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(128,128,128,0.3) 1px, transparent 1px)`,
            backgroundSize: "80px 80px",
          }}
        />

        {/* 3D Desktop setup — bottom on mobile, left side on desktop */}
        <div
          className="absolute left-1/2 -translate-x-1/2 bottom-[-60px] scale-[0.55] origin-bottom lg:left-[-80px] lg:translate-x-0 lg:top-[50%] lg:bottom-auto lg:-translate-y-1/2 lg:scale-100 lg:origin-center"
          style={{ perspective: "800px" }}
        >
          <motion.div
            className="relative"
            initial={false}
            animate={{
              rotateX: 6 - step * 1,
              rotateY: 25 - step * 2,
            }}
            transition={{ duration: 1.4, ease: [0.25, 0.46, 0.45, 0.94] }}
            style={{ transformStyle: "preserve-3d" }}
          >
            {/* Monitor */}
            <div
              className="w-[420px] h-[270px] rounded-2xl"
              style={{
                border: "1.5px solid rgba(128,128,128,0.15)",
                background: "linear-gradient(145deg, rgba(128,128,128,0.08) 0%, rgba(128,128,128,0.02) 100%)",
                boxShadow: "0 40px 120px -30px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.04)",
              }}
            >
              {/* Screen */}
              <div
                className="m-2.5 h-[calc(100%-20px)] rounded-xl overflow-hidden relative"
                style={{
                  background: "rgba(0,0,0,0.04)",
                  border: "1px solid rgba(128,128,128,0.08)",
                }}
              >
                {/* Traffic lights + address bar */}
                <div className="flex items-center gap-[5px] px-3 py-2 border-b" style={{ borderColor: "rgba(128,128,128,0.05)" }}>
                  <div className="w-2 h-2 rounded-full" style={{ background: "rgba(255,95,87,0.3)" }} />
                  <div className="w-2 h-2 rounded-full" style={{ background: "rgba(255,189,46,0.3)" }} />
                  <div className="w-2 h-2 rounded-full" style={{ background: "rgba(39,201,63,0.3)" }} />
                  <div className="ml-3 h-[5px] w-28 rounded-full" style={{ background: "rgba(128,128,128,0.07)" }} />
                </div>

                {/* Code lines */}
                <div className="px-3 pt-2.5 pb-3 space-y-[7px]">
                  {[
                    { w: "72%", indent: 0 },
                    { w: "48%", indent: 14 },
                    { w: "85%", indent: 14 },
                    { w: "36%", indent: 28 },
                    { w: "60%", indent: 28 },
                    { w: "52%", indent: 14 },
                    { w: "78%", indent: 0 },
                    { w: "44%", indent: 14 },
                    { w: "68%", indent: 14 },
                    { w: "56%", indent: 0 },
                  ].map((line, i) => (
                    <motion.div
                      key={i}
                      className="h-[5px] rounded-full"
                      style={{ marginLeft: line.indent }}
                      initial={{ width: 0, opacity: 0 }}
                      animate={{
                        width: i <= step * 2 + 1 ? line.w : 0,
                        opacity: i <= step * 2 + 1 ? 1 : 0,
                        backgroundColor: i <= step * 2 + 1
                          ? `rgba(128,128,128,${0.12 + (step * 0.025)})`
                          : "rgba(128,128,128,0)",
                      }}
                      transition={{
                        duration: 1,
                        delay: i * 0.08,
                        ease: [0.25, 0.46, 0.45, 0.94],
                      }}
                    />
                  ))}
                </div>

                {/* Cursor */}
                <motion.div
                  className="absolute rounded-full"
                  style={{ width: 2, height: 11, backgroundColor: "rgba(128,128,128,0.2)", left: 14 }}
                  animate={{
                    opacity: [0.1, 0.3, 0.1],
                    top: 34 + Math.min(step * 2 + 1, 9) * 12,
                  }}
                  transition={{
                    opacity: { duration: 1.2, repeat: Infinity, ease: "easeInOut" },
                    top: { duration: 1, ease: [0.25, 0.46, 0.45, 0.94] },
                  }}
                />
              </div>
            </div>

            {/* Stand */}
            <div className="flex flex-col items-center">
              <div className="w-[3px] h-7 rounded-full" style={{ background: "rgba(128,128,128,0.1)" }} />
              <div className="w-16 h-[3px] rounded-full" style={{ background: "rgba(128,128,128,0.1)" }} />
            </div>

            {/* Keyboard — below monitor */}
            <motion.div
              className="mt-4 ml-8"
              key={`kb-${step}`}
              initial={{ y: 0 }}
              animate={{ y: [0, -2, 0, -1, 0] }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            >
              <div
                className="w-[320px] h-[90px] rounded-xl"
                style={{
                  border: "1px solid rgba(128,128,128,0.12)",
                  background: "linear-gradient(180deg, rgba(128,128,128,0.06) 0%, rgba(128,128,128,0.02) 100%)",
                }}
              >
                {/* Key rows */}
                <div className="p-2.5 space-y-[5px]">
                  {[
                    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
                    [1.4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.6],
                    [1.7, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.3],
                    [2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2],
                  ].map((row, ri) => (
                    <div key={ri} className="flex gap-[3px]">
                      {row.map((w, ki) => {
                        // Typing sequence: different keys light up per step
                        const typingKeys = [
                          [[1,3],[1,5],[2,2],[2,7],[1,8]],
                          [[0,2],[1,4],[2,5],[0,9],[1,6]],
                          [[2,3],[0,5],[1,7],[2,8],[0,11]],
                          [[1,2],[2,6],[0,7],[1,9],[2,4]],
                          [[0,4],[2,1],[1,8],[0,6],[2,9]],
                        ]
                        const activeKeys = typingKeys[step] || typingKeys[0]
                        const isTyping = activeKeys.some(([r, k]) => r === ri && k === ki)

                        return (
                          <motion.div
                            key={`${ki}-${step}`}
                            className="h-[14px] rounded-[3px]"
                            style={{
                              flex: w,
                              background: "rgba(128,128,128,0.08)",
                            }}
                            animate={isTyping ? {
                              backgroundColor: [
                                "rgba(128,128,128,0.08)",
                                "rgba(128,128,128,0.28)",
                                "rgba(128,128,128,0.08)",
                              ],
                              y: [0, -1.5, 0],
                            } : {
                              backgroundColor: "rgba(128,128,128,0.08)",
                            }}
                            transition={isTyping ? {
                              duration: 0.25,
                              delay: activeKeys.findIndex(([r, k]) => r === ri && k === ki) * 0.12,
                              ease: "easeOut",
                            } : {}}
                          />
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>

            {/* Mouse — to the right of keyboard */}
            <div className="absolute" style={{ right: -30, bottom: 20 }}>
              <motion.div
                animate={{
                  y: [0, -3, 0],
                  x: [0, 2, 0],
                }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              >
                {/* Mouse click animation on step change */}
                <motion.div
                  key={`mouse-${step}`}
                  initial={{ scale: 1 }}
                  animate={{ scale: [1, 0.92, 1] }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                >
                  {/* Mouse body */}
                  <div
                    className="w-[40px] h-[60px] rounded-[20px] relative"
                    style={{
                      border: "1px solid rgba(128,128,128,0.15)",
                      background: "linear-gradient(180deg, rgba(128,128,128,0.08) 0%, rgba(128,128,128,0.03) 100%)",
                    }}
                  >
                    {/* Left click flash on step change */}
                    <motion.div
                      key={`click-${step}`}
                      className="absolute top-0 left-0 w-1/2 h-[28px] rounded-tl-[20px]"
                      initial={{ backgroundColor: "rgba(128,128,128,0)" }}
                      animate={{
                        backgroundColor: [
                          "rgba(128,128,128,0)",
                          "rgba(128,128,128,0.2)",
                          "rgba(128,128,128,0)",
                        ],
                      }}
                      transition={{ duration: 0.4, ease: "easeOut" }}
                    />
                    {/* Scroll wheel */}
                    <div className="flex justify-center pt-3">
                      <motion.div
                        className="w-[4px] h-[10px] rounded-full"
                        style={{ background: "rgba(128,128,128,0.15)" }}
                        animate={{
                          backgroundColor: [`rgba(128,128,128,0.15)`, `rgba(128,128,128,0.3)`, `rgba(128,128,128,0.15)`],
                        }}
                        transition={{ duration: 2, repeat: Infinity, repeatDelay: 2 }}
                      />
                    </div>
                    {/* Divider line */}
                    <div className="mt-1.5 mx-2 h-[1px]" style={{ background: "rgba(128,128,128,0.08)" }} />
                  </div>
                </motion.div>

                {/* Click ripple */}
                <motion.div
                  key={`ripple-${step}`}
                  className="absolute top-[12px] left-[8px] w-[10px] h-[10px] rounded-full"
                  style={{ border: "1px solid rgba(128,128,128,0.2)" }}
                  initial={{ scale: 0.5, opacity: 0.4 }}
                  animate={{ scale: 2.5, opacity: 0 }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              </motion.div>
            </div>
          </motion.div>
        </div>

        {/* Ambient glow */}
        <motion.div
          className="absolute rounded-full blur-[120px]"
          style={{
            width: "50%",
            height: "50%",
            background: "radial-gradient(circle, currentColor, transparent 70%)",
          }}
          initial={false}
          animate={{
            opacity: 0.03 + step * 0.007,
            left: `${-20 + step * 5}%`,
            top: `${-20 + step * 4}%`,
          }}
          transition={{ duration: 1.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        />
      </div>

      {/* Top bar with logo and progress */}
      <div className="relative z-10 flex items-center justify-between px-6 py-4 sm:px-8">
        <div className="flex items-center gap-2.5">
          <CoastyIcon className="size-7" />
          <span className="text-sm font-medium text-foreground/80">
            Coasty
          </span>
        </div>
        <button
          onClick={handleSkip}
          className="text-sm text-muted-foreground/60 hover:text-muted-foreground transition-colors"
        >
          {t("skipForNow")}
        </button>
      </div>

      {/* Progress bar */}
      <div className="relative z-10 px-6 sm:px-8 mt-1">
        <div className="mx-auto max-w-lg">
          <div className="relative h-[3px] rounded-full bg-foreground/[0.07] overflow-hidden">
            <motion.div
              className="absolute inset-y-0 left-0 rounded-full bg-foreground/60"
              initial={false}
              animate={{
                width: `${((step + 1) / TOTAL_STEPS) * 100}%`,
              }}
              transition={{
                duration: 0.8,
                ease: [0.25, 0.46, 0.45, 0.94],
              }}
            />
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 sm:px-6">
        <div className="w-full max-w-lg">
          <AnimatePresence mode="wait">
            {/* Step 0: Welcome + Name */}
            {step === 0 && (
              <motion.div
                key="step-0"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="space-y-8"
              >
                <div className="text-center space-y-4">
                  {/* Eyebrow — quiet uppercase label that sets the tone
                      before the heading lands. The single signature
                      element on this surface. Tracking-widest reads as
                      "editorial caps" rather than "shouty caps". */}
                  <span className="inline-block text-[10.5px] font-semibold uppercase tracking-[0.22em] text-foreground/45">
                    {isExistingUser
                      ? t("welcome.eyebrowReturning")
                      : t("welcome.eyebrowNew")}
                  </span>
                  <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-[-0.02em] text-foreground leading-[1.1]">
                    {isExistingUser
                      ? t("welcome.titleReturning", { name: initialName ? `, ${initialName.split(" ")[0]}` : "" })
                      : t("welcome.titleNew")}
                  </h1>
                  {/* max-w-md (was -sm) gives the longer, value-prop
                      description room to breathe in two lines on
                      desktop instead of three on phone. */}
                  <p className="text-muted-foreground text-[14.5px] sm:text-[15px] leading-relaxed max-w-md mx-auto">
                    {isExistingUser
                      ? t("welcome.descriptionReturning")
                      : t("welcome.descriptionNew")}
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label
                      htmlFor="name"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      {t("nameLabel")}
                    </Label>
                    <Input
                      id="name"
                      type="text"
                      placeholder={t("namePlaceholder")}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="h-12 rounded-xl bg-background/50 text-base"
                      autoFocus
                      onKeyDown={(e) =>
                        e.key === "Enter" && canProceed() && handleNext()
                      }
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label className="text-xs font-medium text-muted-foreground">
                        {t("companyLabel")}
                        <span className="text-muted-foreground/50 ml-1">
                          {t("optional")}
                        </span>
                      </Label>
                      <div className="relative">
                        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/40" />
                        <Input
                          type="text"
                          placeholder={t("companyPlaceholder")}
                          value={company}
                          onChange={(e) => setCompany(e.target.value)}
                          className="h-11 rounded-xl bg-background/50 pl-10"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-medium text-muted-foreground">
                        {t("websiteLabel")}
                      </Label>
                      <div className="relative">
                        <Globe className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/40" />
                        <Input
                          type="text"
                          placeholder={t("websitePlaceholder")}
                          value={website}
                          onChange={(e) => setWebsite(e.target.value)}
                          className="h-11 rounded-xl bg-background/50 pl-10"
                          onKeyDown={(e) =>
                            e.key === "Enter" && canProceed() && handleNext()
                          }
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Reassurance footer — quiet, hairline-divided. Sets the
                    expectation that nothing here is permanent and that
                    the wizard is short. Anchors the form so the eye
                    has somewhere to land before the Continue button. */}
                <div className="pt-1">
                  <p className="text-[12px] leading-relaxed text-muted-foreground/55 text-center">
                    {t("welcome.footerNote")}
                  </p>
                </div>
              </motion.div>
            )}

            {/* Step 1: Role + Team Size */}
            {step === 1 && (
              <motion.div
                key="step-1"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="space-y-8"
              >
                <div className="text-center space-y-2">
                  <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-foreground">
                    {t("roleStep.title")}
                  </h1>
                  <p className="text-muted-foreground text-sm sm:text-base">
                    {t("roleStep.subtitle")}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  {ROLES.map(({ value, labelKey, icon: Icon }) => {
                    const isSelected = roles.includes(value)
                    return (
                      <button
                        key={value}
                        onClick={() =>
                          setRoles((prev) =>
                            isSelected
                              ? prev.filter((r) => r !== value)
                              : [...prev, value]
                          )
                        }
                        className={cn(
                          "flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-all duration-200",
                          isSelected
                            ? "border-foreground/30 bg-foreground/[0.04] ring-1 ring-foreground/10"
                            : "border-border/50 bg-card/30 hover:border-border hover:bg-card/60"
                        )}
                      >
                        <Icon
                          className={cn(
                            "size-4 shrink-0",
                            isSelected
                              ? "text-foreground"
                              : "text-muted-foreground/60"
                          )}
                        />
                        <span
                          className={cn(
                            "text-sm font-medium",
                            isSelected
                              ? "text-foreground"
                              : "text-muted-foreground"
                          )}
                        >
                          {t(`roles.${labelKey}`)}
                        </span>
                        {isSelected && (
                          <Check className="size-3.5 ml-auto text-foreground/70" />
                        )}
                      </button>
                    )
                  })}
                </div>

                {/* Team size */}
                <div className="space-y-3">
                  <p className="text-xs font-medium text-muted-foreground text-center">
                    {t("teamSizeLabel")}
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {TEAM_SIZES.map(({ value, labelKey }) => (
                      <button
                        key={value}
                        onClick={() =>
                          setTeamSize(teamSize === value ? "" : value)
                        }
                        className={cn(
                          "rounded-lg border px-4 py-2 text-sm font-medium transition-all duration-200",
                          teamSize === value
                            ? "border-foreground/30 bg-foreground/[0.04] text-foreground ring-1 ring-foreground/10"
                            : "border-border/50 bg-card/30 text-muted-foreground hover:border-border hover:bg-card/60"
                        )}
                      >
                        {t(`teamSizes.${labelKey}`)}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {/* Step 2: How did you hear about us */}
            {step === 2 && (
              <motion.div
                key="step-2"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="space-y-8"
              >
                <div className="text-center space-y-2">
                  <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-foreground">
                    {t("referralStep.title")}
                  </h1>
                  <p className="text-muted-foreground text-sm sm:text-base">
                    {t("referralStep.subtitle")}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  {REFERRAL_SOURCES.map(({ value, labelKey }) => (
                    <button
                      key={value}
                      onClick={() => setReferralSource(value)}
                      className={cn(
                        "rounded-xl border px-4 py-3.5 text-sm font-medium text-left transition-all duration-200",
                        referralSource === value
                          ? "border-foreground/30 bg-foreground/[0.04] text-foreground ring-1 ring-foreground/10"
                          : "border-border/50 bg-card/30 text-muted-foreground hover:border-border hover:bg-card/60"
                      )}
                    >
                      <span className="flex items-center justify-between">
                        {t(`referralSources.${labelKey}`)}
                        {referralSource === value && (
                          <Check className="size-3.5 text-foreground/70" />
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Step 3: Primary use case */}
            {step === 3 && (
              <motion.div
                key="step-3"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="space-y-8"
              >
                <div className="text-center space-y-2">
                  <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-foreground">
                    {t("useCaseStep.title")}
                  </h1>
                  <p className="text-muted-foreground text-sm sm:text-base">
                    {t("useCaseStep.subtitle")}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  {USE_CASES.map(({ value, labelKey, icon: Icon }) => {
                    const isSelected = useCases.includes(value)
                    return (
                      <button
                        key={value}
                        onClick={() =>
                          setUseCases((prev) =>
                            isSelected
                              ? prev.filter((u) => u !== value)
                              : [...prev, value]
                          )
                        }
                        className={cn(
                          "flex items-start gap-3 rounded-xl border px-4 py-3.5 text-left transition-all duration-200",
                          isSelected
                            ? "border-foreground/30 bg-foreground/[0.04] ring-1 ring-foreground/10"
                            : "border-border/50 bg-card/30 hover:border-border hover:bg-card/60"
                        )}
                      >
                        <Icon
                          className={cn(
                            "size-4 shrink-0 mt-0.5",
                            isSelected
                              ? "text-foreground"
                              : "text-muted-foreground/60"
                          )}
                        />
                        <span
                          className={cn(
                            "text-sm font-medium leading-snug",
                            isSelected
                              ? "text-foreground"
                              : "text-muted-foreground"
                          )}
                        >
                          {t(`useCases.${labelKey}`)}
                        </span>
                        {isSelected && (
                          <Check className="size-3.5 ml-auto mt-0.5 text-foreground/70" />
                        )}
                      </button>
                    )
                  })}
                </div>
              </motion.div>
            )}

            {/* Step 4: Product showcase — bento collage */}
            {step === 4 && (
              <motion.div
                key="step-4"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="space-y-6"
              >
                <div className="text-center space-y-2">
                  <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-foreground">
                    {t("showcase.title")}{" "}
                    <span className="text-muted-foreground">{t("showcase.titleHighlight")}</span>
                  </h1>
                  <p className="text-muted-foreground text-sm sm:text-base max-w-sm mx-auto">
                    {t("showcase.subtitle")}
                  </p>
                </div>

                {/* Bento grid */}
                <div className="grid grid-cols-6 gap-2 auto-rows-[76px]">
                  {/* No Code (spans 4 cols) */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4, delay: 0.05 }}
                    className="col-span-4 rounded-xl border border-border/40 bg-gradient-to-br from-card/80 to-card/30 px-3.5 py-3 flex flex-col justify-between overflow-hidden relative group"
                  >
                    <div className="absolute -right-3 -bottom-3 opacity-[0.04] dark:opacity-[0.07] group-hover:opacity-[0.07] dark:group-hover:opacity-[0.12] transition-opacity duration-500">
                      <MousePointer2 className="size-24" />
                    </div>
                    <MousePointer2 className="size-4.5 text-foreground/60" />
                    <div>
                      <p className="text-[13px] font-semibold text-foreground">{t("showcase.noCode.title")}</p>
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5">{t("showcase.noCode.description")}</p>
                    </div>
                  </motion.div>

                  {/* Agent Swarms (spans 2 cols) */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4, delay: 0.1 }}
                    className="col-span-2 rounded-xl border border-border/40 bg-gradient-to-br from-card/80 to-card/30 px-3.5 py-3 flex flex-col justify-between overflow-hidden relative group"
                  >
                    <div className="absolute -right-2 -bottom-2 opacity-[0.04] dark:opacity-[0.07] group-hover:opacity-[0.07] dark:group-hover:opacity-[0.12] transition-opacity duration-500">
                      <Network className="size-16" />
                    </div>
                    <Network className="size-4.5 text-foreground/60" />
                    <div>
                      <p className="text-[13px] font-semibold text-foreground">{t("showcase.agentSwarms.title")}</p>
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5">{t("showcase.agentSwarms.description")}</p>
                    </div>
                  </motion.div>

                  {/* Desktop Control (spans 2 cols) */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4, delay: 0.15 }}
                    className="col-span-2 rounded-xl border border-border/40 bg-gradient-to-br from-card/80 to-card/30 px-3.5 py-3 flex flex-col justify-between overflow-hidden relative group"
                  >
                    <div className="absolute -right-2 -bottom-2 opacity-[0.04] dark:opacity-[0.07] group-hover:opacity-[0.07] dark:group-hover:opacity-[0.12] transition-opacity duration-500">
                      <Monitor className="size-16" />
                    </div>
                    <Monitor className="size-4.5 text-foreground/60" />
                    <div>
                      <p className="text-[13px] font-semibold text-foreground">{t("showcase.desktopControl.title")}</p>
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5">{t("showcase.desktopControl.description")}</p>
                    </div>
                  </motion.div>

                  {/* Browser Automation (spans 4 cols) */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4, delay: 0.2 }}
                    className="col-span-4 rounded-xl border border-border/40 bg-gradient-to-br from-card/80 to-card/30 px-3.5 py-3 flex flex-col justify-between overflow-hidden relative group"
                  >
                    <div className="absolute -right-3 -bottom-3 opacity-[0.04] dark:opacity-[0.07] group-hover:opacity-[0.07] dark:group-hover:opacity-[0.12] transition-opacity duration-500">
                      <Globe className="size-24" />
                    </div>
                    <Globe className="size-4.5 text-foreground/60" />
                    <div>
                      <p className="text-[13px] font-semibold text-foreground">{t("showcase.browserAutomation.title")}</p>
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5">{t("showcase.browserAutomation.description")}</p>
                    </div>
                  </motion.div>

                  {/* Computer Vision (spans 4 cols) */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4, delay: 0.25 }}
                    className="col-span-4 rounded-xl border border-border/40 bg-gradient-to-br from-card/80 to-card/30 px-3.5 py-3 flex flex-col justify-between overflow-hidden relative group"
                  >
                    <div className="absolute -right-3 -bottom-3 opacity-[0.04] dark:opacity-[0.07] group-hover:opacity-[0.07] dark:group-hover:opacity-[0.12] transition-opacity duration-500">
                      <Eye className="size-24" />
                    </div>
                    <Eye className="size-4.5 text-foreground/60" />
                    <div>
                      <p className="text-[13px] font-semibold text-foreground">{t("showcase.computerVision.title")}</p>
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5">{t("showcase.computerVision.description")}</p>
                    </div>
                  </motion.div>

                  {/* Workflow Pipelines (spans 2 cols) */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4, delay: 0.3 }}
                    className="col-span-2 rounded-xl border border-border/40 bg-gradient-to-br from-card/80 to-card/30 px-3.5 py-3 flex flex-col justify-between overflow-hidden relative group"
                  >
                    <div className="absolute -right-2 -bottom-2 opacity-[0.04] dark:opacity-[0.07] group-hover:opacity-[0.07] dark:group-hover:opacity-[0.12] transition-opacity duration-500">
                      <Workflow className="size-16" />
                    </div>
                    <Workflow className="size-4.5 text-foreground/60" />
                    <div>
                      <p className="text-[13px] font-semibold text-foreground">{t("showcase.workflows.title")}</p>
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5">{t("showcase.workflows.description")}</p>
                    </div>
                  </motion.div>

                  {/* On-Device Execution (spans 2 cols) */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4, delay: 0.35 }}
                    className="col-span-2 rounded-xl border border-border/40 bg-gradient-to-br from-card/80 to-card/30 px-3.5 py-3 flex flex-col justify-between overflow-hidden relative group"
                  >
                    <div className="absolute -right-2 -bottom-2 opacity-[0.04] dark:opacity-[0.07] group-hover:opacity-[0.07] dark:group-hover:opacity-[0.12] transition-opacity duration-500">
                      <Cpu className="size-16" />
                    </div>
                    <Cpu className="size-4.5 text-foreground/60" />
                    <div>
                      <p className="text-[13px] font-semibold text-foreground">{t("showcase.onDevice.title")}</p>
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5">{t("showcase.onDevice.description")}</p>
                    </div>
                  </motion.div>

                  {/* 24/7 Autonomous (spans 4 cols) */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4, delay: 0.4 }}
                    className="col-span-4 rounded-xl border border-border/40 bg-gradient-to-br from-card/80 to-card/30 px-3.5 py-3 flex flex-col justify-between overflow-hidden relative group"
                  >
                    <div className="absolute -right-3 -bottom-3 opacity-[0.04] dark:opacity-[0.07] group-hover:opacity-[0.07] dark:group-hover:opacity-[0.12] transition-opacity duration-500">
                      <Clock className="size-24" />
                    </div>
                    <Clock className="size-4.5 text-foreground/60" />
                    <div>
                      <p className="text-[13px] font-semibold text-foreground">{t("showcase.autonomous.title")}</p>
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5">{t("showcase.autonomous.description")}</p>
                    </div>
                  </motion.div>
                </div>

                {/* Guide callout */}
                <motion.button
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.5 }}
                  onClick={async () => {
                    setIsSubmitting(true)
                    try {
                      const res = await fetch("/api/onboarding", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          display_name: displayName.trim(),
                          role: roles.join(","),
                          company: company.trim() || null,
                          website: website.trim() || null,
                          team_size: teamSize || null,
                          referral_source: referralSource,
                          use_case: useCases.join(",") || null,
                        }),
                      })
                      if (res.ok) {
                        // Same reasoning as the main onboarding submit
                        // above — hard nav so the destination route's
                        // server components re-run with onboarding_completed=true
                        // instead of the stale RSC cache.
                        if (typeof window !== "undefined") {
                          window.location.replace("/guide")
                        }
                        return
                      } else {
                        setIsSubmitting(false)
                      }
                    } catch {
                      setIsSubmitting(false)
                    }
                  }}
                  disabled={isSubmitting}
                  className="w-full flex items-center gap-3.5 rounded-2xl border border-border/50 bg-gradient-to-r from-foreground/[0.03] to-transparent px-4 py-3.5 group cursor-pointer hover:border-border/70 hover:from-foreground/[0.05] transition-all text-left"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.05] border border-border/40 group-hover:bg-foreground/[0.08] transition-colors">
                    <BookOpen className="size-4.5 text-foreground/60" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {t("guideCallout.title")}
                    </p>
                    <p className="text-[11px] text-muted-foreground/70 leading-relaxed mt-0.5">
                      {t("guideCallout.subtitle")}
                    </p>
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground/40 group-hover:text-muted-foreground/70 transition-colors shrink-0" />
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Navigation */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="mt-8 flex items-center justify-between"
          >
            <button
              onClick={() => step > 0 && setStep(step - 1)}
              className={cn(
                "text-sm text-muted-foreground hover:text-foreground transition-colors",
                step === 0 && "invisible"
              )}
            >
              {t("back")}
            </button>

            <Button
              onClick={handleNext}
              disabled={!canProceed() || isSubmitting}
              className="h-11 px-8 rounded-xl font-medium gap-2"
            >
              {isSubmitting ? (
                t("settingUp")
              ) : step === TOTAL_STEPS - 1 ? (
                <>
                  {t("getStarted")}
                  <Sparkles className="size-4" />
                </>
              ) : (
                <>
                  {t("continue")}
                  <ArrowRight className="size-4" />
                </>
              )}
            </Button>
          </motion.div>
        </div>
      </main>
    </div>
  )
}
