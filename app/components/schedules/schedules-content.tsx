"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useRouter } from "next/navigation"
import {
  Clock,
  Trash2,
  Pencil,
  Briefcase,
  Mail,
  Globe,
  RefreshCw,
  ShieldCheck,
  FileText,
  MoreHorizontal,
  Cpu,
  Activity,
  UserPlus,
  Users,
  Plus,
  X,
  GripVertical,
  Megaphone,
  ShoppingCart,
  Code2,
  HeadphonesIcon,
  BarChart3,
  Search,
  PenTool,
  Building2,
  Rocket,
  Target,
  TrendingUp,
  Key,
  ArrowLeft,
  Sparkles,
  Crown,
  Zap,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  BookOpen,
  Play,
  Pause,
  History,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  XCircle,
  SkipForward,
} from "lucide-react"
import Link from "next/link"
import { motion, AnimatePresence } from "framer-motion"
import { CoastyIcon } from "@/components/icons/coasty"
import { AgentIcon } from "@/components/icons/agent"
import { trackScheduleTriggered } from "@/lib/posthog/analytics"
import { ScheduleDialog } from "./schedule-dialog"
import { CreateScheduleDialog } from "./create-schedule-dialog"
import type { UserMachine } from "@/types/machines.types"
import {
  listSchedules,
  listTeams,
  createTeam,
  createSchedule,
  deleteTeam,
  addTeamMember,
  removeTeamMember,
  getDelegates,
  updateTeam,
  formatFrequency,
  formatNextRun,
  triggerScheduleNow,
  pauseSchedule,
  deleteSchedule,
  getScheduleHistory,
  type ScheduleResponse,
  type ScheduleHistoryEntry,
  type TeamResponse,
  type DelegateConfig,
} from "@/lib/services/schedules-api"
import { useUser } from "@/lib/user-store/provider"
import { toast } from "sonner"
import { SecretDialog } from "@/app/components/secrets/secret-dialog"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import * as VisuallyHidden from "@radix-ui/react-visually-hidden"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { PageLoader } from "@/components/common/page-loader"

/* ─── Team template types & data ─── */
interface TeamTemplateEmployee {
  name: string
  role: string
  roleKey: string
  frequency: string
}

interface TeamTemplateCredential {
  service: string
  purposeKey: string
}

interface TeamTemplate {
  id: string
  nameKey: string
  tier: "starter" | "plus" | "pro"
  icon: React.ComponentType<{ className?: string }>
  taglineKey: string
  descriptionKey: string
  instructions: string
  employees: TeamTemplateEmployee[]
  credentials: TeamTemplateCredential[]
}

const TEAM_TEMPLATES: TeamTemplate[] = [
  // ── STARTER (1 machine, 3 employees) ──
  {
    id: "content-ops",
    nameKey: "templates.contentOps.name",
    tier: "starter",
    icon: PenTool,
    taglineKey: "templates.contentOps.tagline",
    descriptionKey: "templates.contentOps.description",
    instructions: "You are part of the Content Operations team. Coordinate with team members via shared memory. Always write in the brand voice. Prioritize quality over quantity. Log every published piece to shared memory with its URL and performance metrics.",
    employees: [
      { name: "Atlas", role: "Content Writer — drafts blog posts, newsletters, and social copy", roleKey: "templates.contentOps.roles.atlas", frequency: "daily" },
      { name: "Echo", role: "SEO Analyst — audits pages, tracks rankings, suggests keyword opportunities", roleKey: "templates.contentOps.roles.echo", frequency: "weekly" },
      { name: "Nova", role: "Social Distributor — posts content to platforms and monitors engagement", roleKey: "templates.contentOps.roles.nova", frequency: "every_12_hours" },
    ],
    credentials: [
      { service: "wordpress.com", purposeKey: "templates.contentOps.credentials.wordpress" },
      { service: "twitter.com", purposeKey: "templates.contentOps.credentials.twitter" },
      { service: "linkedin.com", purposeKey: "templates.contentOps.credentials.linkedin" },
      { service: "search.google.com/search-console", purposeKey: "templates.contentOps.credentials.searchConsole" },
    ],
  },
  {
    id: "customer-support",
    nameKey: "templates.customerSupport.name",
    tier: "starter",
    icon: HeadphonesIcon,
    taglineKey: "templates.customerSupport.tagline",
    descriptionKey: "templates.customerSupport.description",
    instructions: "You are part of the Customer Support team. Be empathetic and solution-oriented. Escalate complex issues by logging them to shared memory with tag [ESCALATION]. Update the FAQ whenever you resolve a new type of issue. Track response times and customer satisfaction signals.",
    employees: [
      { name: "Sage", role: "Inbox Monitor — checks support emails, categorizes and responds to common queries", roleKey: "templates.customerSupport.roles.sage", frequency: "every_30_minutes" },
      { name: "Iris", role: "Knowledge Base Manager — updates help docs and FAQs based on recurring issues", roleKey: "templates.customerSupport.roles.iris", frequency: "weekly" },
      { name: "Milo", role: "Feedback Analyst — aggregates reviews and support trends into weekly reports", roleKey: "templates.customerSupport.roles.milo", frequency: "daily" },
    ],
    credentials: [
      { service: "gmail.com", purposeKey: "templates.customerSupport.credentials.gmail" },
      { service: "zendesk.com", purposeKey: "templates.customerSupport.credentials.zendesk" },
      { service: "notion.so", purposeKey: "templates.customerSupport.credentials.notion" },
    ],
  },
  {
    id: "research-intel",
    nameKey: "templates.researchIntel.name",
    tier: "starter",
    icon: Search,
    taglineKey: "templates.researchIntel.tagline",
    descriptionKey: "templates.researchIntel.description",
    instructions: "You are part of the Research & Intelligence team. Focus on actionable insights, not information dumps. Always cite sources with URLs. Use shared memory to maintain a running competitive landscape. Flag urgent competitive moves with [ALERT] tag.",
    employees: [
      { name: "Scout", role: "Competitor Monitor — tracks competitor websites, pricing, and feature changes", roleKey: "templates.researchIntel.roles.scout", frequency: "daily" },
      { name: "Wren", role: "Trend Researcher — scans industry news, publications, and social media for trends", roleKey: "templates.researchIntel.roles.wren", frequency: "daily" },
      { name: "Quinn", role: "Brief Compiler — synthesizes findings into structured weekly intelligence reports", roleKey: "templates.researchIntel.roles.quinn", frequency: "weekly" },
    ],
    credentials: [
      { service: "google.com", purposeKey: "templates.researchIntel.credentials.google" },
      { service: "linkedin.com", purposeKey: "templates.researchIntel.credentials.linkedin" },
      { service: "notion.so", purposeKey: "templates.researchIntel.credentials.notion" },
    ],
  },

  // ── PLUS (2 machines, 10 employees) ──
  {
    id: "marketing-agency",
    nameKey: "templates.marketing.name",
    tier: "plus",
    icon: Megaphone,
    taglineKey: "templates.marketing.tagline",
    descriptionKey: "templates.marketing.description",
    instructions: "You are part of the Marketing Department. Content team creates and publishes. Analytics team tracks and optimizes. Share insights via shared memory. Always align content with current campaign themes stored in shared memory under [CAMPAIGN]. Report metrics weekly.",
    employees: [
      { name: "Atlas", role: "Content Strategist — plans content calendar, writes long-form pieces", roleKey: "templates.marketing.roles.atlas", frequency: "daily" },
      { name: "Nova", role: "Social Media Manager — posts, engages, and grows social channels", roleKey: "templates.marketing.roles.nova", frequency: "every_6_hours" },
      { name: "Echo", role: "SEO Specialist — optimizes pages, builds internal links, tracks keywords", roleKey: "templates.marketing.roles.echo", frequency: "daily" },
      { name: "Pixel", role: "Email Campaign Manager — writes and sends newsletters, tracks opens/clicks", roleKey: "templates.marketing.roles.pixel", frequency: "daily" },
      { name: "Scout", role: "Competitor Analyst — monitors competitor marketing moves and reports insights", roleKey: "templates.marketing.roles.scout", frequency: "daily" },
      { name: "Dash", role: "Ad Campaign Monitor — tracks ad spend, ROAS, and optimization opportunities", roleKey: "templates.marketing.roles.dash", frequency: "every_12_hours" },
      { name: "Iris", role: "Analytics Reporter — compiles cross-channel performance dashboards", roleKey: "templates.marketing.roles.iris", frequency: "weekly" },
    ],
    credentials: [
      { service: "wordpress.com", purposeKey: "templates.marketing.credentials.wordpress" },
      { service: "twitter.com", purposeKey: "templates.marketing.credentials.twitter" },
      { service: "linkedin.com", purposeKey: "templates.marketing.credentials.linkedin" },
      { service: "mailchimp.com", purposeKey: "templates.marketing.credentials.mailchimp" },
      { service: "analytics.google.com", purposeKey: "templates.marketing.credentials.analytics" },
      { service: "ads.google.com", purposeKey: "templates.marketing.credentials.googleAds" },
      { service: "business.facebook.com", purposeKey: "templates.marketing.credentials.metaAds" },
    ],
  },
  {
    id: "ecommerce-ops",
    nameKey: "templates.ecommerce.name",
    tier: "plus",
    icon: ShoppingCart,
    taglineKey: "templates.ecommerce.tagline",
    descriptionKey: "templates.ecommerce.description",
    instructions: "You are part of E-Commerce Operations. Storefront team maintains listings and customer experience. Growth team drives traffic and conversions. Log all price changes and inventory alerts to shared memory with [PRICE] and [INVENTORY] tags. Never make pricing changes without logging the before/after.",
    employees: [
      { name: "Cleo", role: "Product Lister — creates and updates product descriptions, images, and metadata", roleKey: "templates.ecommerce.roles.cleo", frequency: "daily" },
      { name: "Onyx", role: "Price Monitor — tracks competitor prices and flags opportunities for adjustments", roleKey: "templates.ecommerce.roles.onyx", frequency: "every_6_hours" },
      { name: "Luna", role: "Inventory Tracker — monitors stock levels and alerts on low inventory", roleKey: "templates.ecommerce.roles.luna", frequency: "every_12_hours" },
      { name: "Sage", role: "Review Manager — responds to customer reviews and aggregates sentiment", roleKey: "templates.ecommerce.roles.sage", frequency: "daily" },
      { name: "Dash", role: "Ad Campaign Optimizer — manages product ads and shopping campaigns", roleKey: "templates.ecommerce.roles.dash", frequency: "every_12_hours" },
      { name: "Flux", role: "Email Marketer — sends abandoned cart, promo, and post-purchase sequences", roleKey: "templates.ecommerce.roles.flux", frequency: "daily" },
      { name: "Wren", role: "Analytics Reporter — tracks revenue, conversion rates, and growth metrics", roleKey: "templates.ecommerce.roles.wren", frequency: "weekly" },
    ],
    credentials: [
      { service: "shopify.com", purposeKey: "templates.ecommerce.credentials.shopify" },
      { service: "amazon.com/seller", purposeKey: "templates.ecommerce.credentials.amazon" },
      { service: "ads.google.com", purposeKey: "templates.ecommerce.credentials.googleAds" },
      { service: "mailchimp.com", purposeKey: "templates.ecommerce.credentials.mailchimp" },
      { service: "analytics.google.com", purposeKey: "templates.ecommerce.credentials.analytics" },
    ],
  },
  {
    id: "dev-team",
    nameKey: "templates.engineering.name",
    tier: "plus",
    icon: Code2,
    taglineKey: "templates.engineering.tagline",
    descriptionKey: "templates.engineering.description",
    instructions: "You are part of the Engineering Team. Engineering squad handles code quality and documentation. DevOps squad monitors infrastructure. Log all incidents to shared memory with [INCIDENT] tag and severity level. Never auto-merge PRs — only review and comment. Flag security issues with [SECURITY] tag immediately.",
    employees: [
      { name: "Rune", role: "Code Reviewer — reviews open PRs, suggests improvements, checks for security issues", roleKey: "templates.engineering.roles.rune", frequency: "every_6_hours" },
      { name: "Koda", role: "Dependency Monitor — tracks outdated packages, security advisories, and breaking changes", roleKey: "templates.engineering.roles.koda", frequency: "daily" },
      { name: "Aria", role: "Doc Writer — keeps API docs, READMEs, and changelogs up to date with latest code", roleKey: "templates.engineering.roles.aria", frequency: "daily" },
      { name: "Blaze", role: "Test Monitor — runs test suites, tracks flaky tests, reports coverage trends", roleKey: "templates.engineering.roles.blaze", frequency: "every_12_hours" },
      { name: "Frost", role: "Deploy Monitor — watches CI/CD pipelines, alerts on failures, tracks deploy frequency", roleKey: "templates.engineering.roles.frost", frequency: "every_6_hours" },
      { name: "Neon", role: "Uptime & Log Watcher — monitors services, scans logs for errors, creates incident reports", roleKey: "templates.engineering.roles.neon", frequency: "every_30_minutes" },
    ],
    credentials: [
      { service: "github.com", purposeKey: "templates.engineering.credentials.github" },
      { service: "vercel.com", purposeKey: "templates.engineering.credentials.vercel" },
      { service: "sentry.io", purposeKey: "templates.engineering.credentials.sentry" },
      { service: "npmjs.com", purposeKey: "templates.engineering.credentials.npm" },
    ],
  },

  // ── PRO (3 machines, 50 employees) ──
  {
    id: "full-business",
    nameKey: "templates.fullBusiness.name",
    tier: "pro",
    icon: Building2,
    taglineKey: "templates.fullBusiness.tagline",
    descriptionKey: "templates.fullBusiness.description",
    instructions: "You are part of Full Business Operations. Sales drives revenue, Marketing builds pipeline, Support retains customers, and Admin keeps everything running. Cross-department updates go to shared memory with department tags: [SALES], [MARKETING], [SUPPORT], [ADMIN]. Weekly all-hands summary compiled every Monday. Escalations tagged [URGENT] get priority across all departments.",
    employees: [
      { name: "Atlas", role: "Lead Generator — finds and qualifies potential customers from online sources", roleKey: "templates.fullBusiness.roles.atlas", frequency: "daily" },
      { name: "Dash", role: "CRM Manager — updates deals, tracks pipeline, and sends follow-up sequences", roleKey: "templates.fullBusiness.roles.dash", frequency: "every_6_hours" },
      { name: "Scout", role: "Proposal Writer — drafts sales proposals and pitch decks from templates", roleKey: "templates.fullBusiness.roles.scout", frequency: "daily" },
      { name: "Nova", role: "Content Marketer — writes blog posts, case studies, and marketing copy", roleKey: "templates.fullBusiness.roles.nova", frequency: "daily" },
      { name: "Echo", role: "Social Media Manager — posts content and engages with audience", roleKey: "templates.fullBusiness.roles.echo", frequency: "every_6_hours" },
      { name: "Pixel", role: "Email Campaign Manager — runs drip campaigns and newsletter sequences", roleKey: "templates.fullBusiness.roles.pixel", frequency: "daily" },
      { name: "Sage", role: "Support Lead — handles customer inquiries and resolves issues", roleKey: "templates.fullBusiness.roles.sage", frequency: "every_30_minutes" },
      { name: "Iris", role: "Knowledge Manager — maintains help docs, FAQs, and internal wiki", roleKey: "templates.fullBusiness.roles.iris", frequency: "weekly" },
      { name: "Milo", role: "Data Analyst — compiles cross-department reports and KPI dashboards", roleKey: "templates.fullBusiness.roles.milo", frequency: "daily" },
      { name: "Wren", role: "Market Researcher — tracks industry trends and competitive intelligence", roleKey: "templates.fullBusiness.roles.wren", frequency: "daily" },
      { name: "Quinn", role: "Operations Coordinator — runs weekly summaries and cross-team syncs", roleKey: "templates.fullBusiness.roles.quinn", frequency: "weekly" },
    ],
    credentials: [
      { service: "gmail.com", purposeKey: "templates.fullBusiness.credentials.gmail" },
      { service: "hubspot.com", purposeKey: "templates.fullBusiness.credentials.hubspot" },
      { service: "linkedin.com", purposeKey: "templates.fullBusiness.credentials.linkedin" },
      { service: "mailchimp.com", purposeKey: "templates.fullBusiness.credentials.mailchimp" },
      { service: "notion.so", purposeKey: "templates.fullBusiness.credentials.notion" },
      { service: "analytics.google.com", purposeKey: "templates.fullBusiness.credentials.analytics" },
      { service: "twitter.com", purposeKey: "templates.fullBusiness.credentials.twitter" },
      { service: "zendesk.com", purposeKey: "templates.fullBusiness.credentials.zendesk" },
    ],
  },
  {
    id: "growth-agency",
    nameKey: "templates.growth.name",
    tier: "pro",
    icon: Rocket,
    taglineKey: "templates.growth.tagline",
    descriptionKey: "templates.growth.description",
    instructions: "You are part of the Growth & Acquisition team. Outbound finds leads, Inbound captures demand, and Analytics optimizes the funnel. Log all qualified leads to shared memory with [LEAD] tag including source and score. Track conversion rates at every funnel stage. A/B test results logged with [EXPERIMENT] tag. Weekly growth metrics compiled automatically.",
    employees: [
      { name: "Blaze", role: "Outbound Prospector — finds decision-makers, researches companies, builds lead lists", roleKey: "templates.growth.roles.blaze", frequency: "daily" },
      { name: "Flux", role: "Email Outreach — sends personalized cold emails, manages follow-up sequences", roleKey: "templates.growth.roles.flux", frequency: "every_6_hours" },
      { name: "Orion", role: "LinkedIn Outreach — connects with prospects and sends personalized messages", roleKey: "templates.growth.roles.orion", frequency: "daily" },
      { name: "Coral", role: "Content Creator — produces SEO content, landing page copy, and lead magnets", roleKey: "templates.growth.roles.coral", frequency: "daily" },
      { name: "Taro", role: "Landing Page Optimizer — monitors conversion rates, suggests and tests improvements", roleKey: "templates.growth.roles.taro", frequency: "daily" },
      { name: "Vale", role: "Ad Campaign Manager — manages Google and Meta ad campaigns end-to-end", roleKey: "templates.growth.roles.vale", frequency: "every_12_hours" },
      { name: "Ember", role: "Lead Scorer — qualifies inbound leads and routes to appropriate follow-up", roleKey: "templates.growth.roles.ember", frequency: "every_6_hours" },
      { name: "Haze", role: "Funnel Analyst — tracks conversion metrics at every stage, identifies bottlenecks", roleKey: "templates.growth.roles.haze", frequency: "daily" },
      { name: "Dune", role: "Competitor Intel — monitors competitor campaigns, pricing, and positioning changes", roleKey: "templates.growth.roles.dune", frequency: "daily" },
      { name: "Kit", role: "Growth Reporter — compiles daily/weekly growth metrics and experiment results", roleKey: "templates.growth.roles.kit", frequency: "daily" },
    ],
    credentials: [
      { service: "linkedin.com", purposeKey: "templates.growth.credentials.linkedin" },
      { service: "gmail.com", purposeKey: "templates.growth.credentials.gmail" },
      { service: "hubspot.com", purposeKey: "templates.growth.credentials.hubspot" },
      { service: "ads.google.com", purposeKey: "templates.growth.credentials.googleAds" },
      { service: "business.facebook.com", purposeKey: "templates.growth.credentials.metaAds" },
      { service: "analytics.google.com", purposeKey: "templates.growth.credentials.analytics" },
      { service: "ahrefs.com", purposeKey: "templates.growth.credentials.ahrefs" },
    ],
  },
  {
    id: "saas-operations",
    nameKey: "templates.saas.name",
    tier: "pro",
    icon: Target,
    taglineKey: "templates.saas.tagline",
    descriptionKey: "templates.saas.description",
    instructions: "You are part of SaaS Operations. Success team ensures retention, Product team tracks usage, and Growth team expands revenue. Log churn risks to shared memory with [CHURN_RISK] tag and risk score. Feature requests tracked with [FEATURE_REQUEST] tag. MRR changes logged with [REVENUE] tag. Health scores updated daily for all accounts.",
    employees: [
      { name: "Luna", role: "Customer Success Monitor — tracks user engagement, identifies at-risk accounts", roleKey: "templates.saas.roles.luna", frequency: "daily" },
      { name: "Sage", role: "Onboarding Assistant — guides new users through setup, monitors activation rates", roleKey: "templates.saas.roles.sage", frequency: "every_6_hours" },
      { name: "Ivy", role: "Churn Preventer — reaches out to disengaging users with re-activation campaigns", roleKey: "templates.saas.roles.ivy", frequency: "daily" },
      { name: "Rune", role: "Feature Request Tracker — aggregates user feedback and feature requests from all channels", roleKey: "templates.saas.roles.rune", frequency: "daily" },
      { name: "Koda", role: "Product Analytics — tracks feature adoption, user journeys, and engagement metrics", roleKey: "templates.saas.roles.koda", frequency: "daily" },
      { name: "Neon", role: "Bug & Issue Monitor — watches error logs, user reports, and status page incidents", roleKey: "templates.saas.roles.neon", frequency: "every_30_minutes" },
      { name: "Aria", role: "Changelog Writer — documents releases, updates knowledge base and help center", roleKey: "templates.saas.roles.aria", frequency: "weekly" },
      { name: "Frost", role: "Revenue Analyst — tracks MRR, churn rate, LTV, and expansion revenue", roleKey: "templates.saas.roles.frost", frequency: "daily" },
      { name: "Zara", role: "Competitor Tracker — monitors competitor features, pricing, and market positioning", roleKey: "templates.saas.roles.zara", frequency: "weekly" },
    ],
    credentials: [
      { service: "stripe.com", purposeKey: "templates.saas.credentials.stripe" },
      { service: "intercom.io", purposeKey: "templates.saas.credentials.intercom" },
      { service: "mixpanel.com", purposeKey: "templates.saas.credentials.mixpanel" },
      { service: "gmail.com", purposeKey: "templates.saas.credentials.gmail" },
      { service: "notion.so", purposeKey: "templates.saas.credentials.notion" },
      { service: "sentry.io", purposeKey: "templates.saas.credentials.sentry" },
      { service: "github.com", purposeKey: "templates.saas.credentials.github" },
    ],
  },
]

const TIER_META: Record<string, { labelKey: string; icon: React.ComponentType<{ className?: string }>; color: string; badgeBg: string; accentHex: string; machines: number; employeesKey: string; priceKey: string }> = {
  starter: { labelKey: "tiers.starter.label", icon: Zap, color: "text-emerald-500", badgeBg: "bg-emerald-500/10 dark:bg-emerald-500/15", accentHex: "#10b981", machines: 1, employeesKey: "tiers.starter.employees", priceKey: "tiers.starter.price" },
  plus: { labelKey: "tiers.plus.label", icon: Sparkles, color: "text-blue-500", badgeBg: "bg-blue-500/10 dark:bg-blue-500/15", accentHex: "#3b82f6", machines: 2, employeesKey: "tiers.plus.employees", priceKey: "tiers.plus.price" },
  pro: { labelKey: "tiers.pro.label", icon: Crown, color: "text-amber-500", badgeBg: "bg-amber-500/10 dark:bg-amber-500/15", accentHex: "#f59e0b", machines: 3, employeesKey: "tiers.pro.employees", priceKey: "tiers.pro.price" },
}

/* ─── types ─── */
type Tab = "teams" | "employees"

/* ═══════════════════════════════════════════════════════
   Inline: ScheduleCard
   ═══════════════════════════════════════════════════════ */

function ScheduleCard({
  schedule,
  onUpdate,
  onViewHistory,
  onEdit,
}: {
  schedule: ScheduleResponse
  onUpdate: () => void
  onViewHistory: (chatId: string) => void
  onEdit?: (chatId: string) => void
}) {
  const router = useRouter()
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  async function handleRunNow() {
    setActionLoading("run")
    try { await triggerScheduleNow(schedule.chat_id); onUpdate() } catch {} finally { setActionLoading(null) }
  }
  async function handleTogglePause() {
    setActionLoading("pause")
    try { await pauseSchedule(schedule.chat_id); onUpdate() } catch {} finally { setActionLoading(null) }
  }
  async function handleDelete() {
    setActionLoading("delete")
    try { await deleteSchedule(schedule.chat_id); onUpdate() } catch {} finally { setActionLoading(null) }
  }

  const isActive = schedule.enabled && !schedule.paused_reason
  const isFailed = schedule.paused_reason === "too_many_failures"
  const statusLabel = isActive ? "On Duty"
    : schedule.paused_reason === "too_many_failures" ? "Needs Attention"
    : schedule.paused_reason === "insufficient_credits" ? "No Credits"
    : schedule.paused_reason === "machine_unavailable" ? "Offline"
    : "Standby"

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn(
        "group relative flex flex-col rounded-xl overflow-hidden h-full",
        "border border-border/30 bg-card/50",
        "hover:border-border/50 hover:shadow-lg hover:shadow-black/[0.04] dark:hover:shadow-black/[0.15]",
        "transition-[border-color,box-shadow] duration-300",
        !isActive && !isFailed && "opacity-80 hover:opacity-100",
      )}
    >
      <div className="flex flex-col h-full">
        <div className="px-5 pt-5 pb-4 flex-1 space-y-4">
          <div className="flex items-start gap-3">
            <div className="relative shrink-0">
              <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center transition-colors duration-300", "bg-muted/50 group-hover:bg-muted/80")}>
                <CoastyIcon className="h-4 w-4 text-foreground/50 group-hover:text-foreground/70 transition-colors duration-300" />
              </div>
              <div className={cn("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card transition-all duration-500", isActive ? "bg-emerald-500" : isFailed ? "bg-amber-500" : "bg-muted-foreground/30")} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground truncate cursor-pointer group-hover:text-foreground/80 transition-colors inline-flex items-center gap-1" onClick={() => router.push(`/c/${schedule.chat_id}`)}>
                {schedule.title || "Untitled Employee"}
                <ArrowUpRight className="h-3 w-3 text-muted-foreground/0 group-hover:text-muted-foreground/50 transition-all duration-300 -translate-y-px" />
              </h3>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={cn("text-[11px] font-medium", isActive ? "text-emerald-600 dark:text-emerald-400" : isFailed ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground/60")}>{statusLabel}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60">
            <span className="flex items-center gap-1.5 bg-muted/40 px-2 py-1 rounded-md"><Clock className="h-3 w-3 text-muted-foreground/40" />{formatFrequency(schedule.frequency)}</span>
            <span className="bg-muted/40 px-2 py-1 rounded-md tabular-nums">{schedule.run_count} runs</span>
            {schedule.consecutive_failures > 0 && <span className="bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-1 rounded-md tabular-nums">{schedule.consecutive_failures} failed</span>}
          </div>

          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground/50">Next shift</span>
              <span className="text-[11px] text-foreground/80 font-medium tabular-nums">{formatNextRun(schedule.next_run_at)}</span>
            </div>
            {schedule.last_run_at && (
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground/50">Last active</span>
                <span className="text-[11px] text-muted-foreground/70 tabular-nums">{new Date(schedule.last_run_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            )}
          </div>

          {schedule.paused_reason && schedule.paused_reason !== "deleted" && (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-muted/30 border border-border/30">
              <AlertTriangle className="h-3 w-3 shrink-0 text-muted-foreground/50" />
              <span className="text-[11px] text-muted-foreground/70 truncate">
                {schedule.paused_reason === "insufficient_credits" ? "Insufficient credits" : schedule.paused_reason === "too_many_failures" ? `${schedule.consecutive_failures} consecutive failures` : schedule.paused_reason === "machine_unavailable" ? "Workstation unavailable" : schedule.paused_reason}
              </span>
            </div>
          )}
        </div>

        <div className={cn("px-4 py-2.5 flex items-center gap-1.5 border-t border-border/20", "translate-y-0 opacity-100", "sm:translate-y-1 sm:opacity-0 sm:group-hover:translate-y-0 sm:group-hover:opacity-100", "transition-all duration-300 ease-out")}>
          <motion.button onClick={handleRunNow} disabled={!!actionLoading} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} className={cn("h-7 px-3 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 transition-colors", "bg-muted/50 hover:bg-muted text-foreground/60 hover:text-foreground", "disabled:opacity-40")}>
            <CoastyIcon className="h-3 w-3" />{actionLoading === "run" ? "\u2026" : "Run"}
          </motion.button>
          <motion.button onClick={handleTogglePause} disabled={!!actionLoading} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} className="h-7 px-2.5 rounded-lg text-[11px] flex items-center gap-1.5 text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40">
            {schedule.enabled ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            {actionLoading === "pause" ? "\u2026" : schedule.enabled ? "Pause" : "Resume"}
          </motion.button>
          <div className="flex-1" />
          {[
            { icon: History, action: () => onViewHistory(schedule.chat_id), title: "Work Log" },
            ...(onEdit ? [{ icon: Pencil, action: () => onEdit(schedule.chat_id), title: "Edit" }] : []),
            { icon: Trash2, action: handleDelete, title: "Delete" },
          ].map(({ icon: Icon, action, title }) => (
            <motion.button key={title} onClick={action} disabled={!!actionLoading} whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground/30 hover:text-muted-foreground hover:bg-muted/50 transition-colors disabled:opacity-40" title={title}>
              <Icon className="h-3.5 w-3.5" />
            </motion.button>
          ))}
        </div>
      </div>
    </motion.div>
  )
}

/* ═══════════════════════════════════════════════════════
   Inline: ScheduleCalendar (day slider)
   ═══════════════════════════════════════════════════════ */

function parseCronField(field: string, max: number, min = 0): number[] {
  const vals = new Set<number>()
  for (const part of field.split(",")) {
    const step = part.match(/^(\*|\d+(?:-\d+)?)\/(\d+)$/)
    if (step) {
      const s = parseInt(step[2])
      let lo = min, hi = max
      if (step[1] !== "*") { const [a, b] = step[1].split("-"); lo = parseInt(a); if (b !== undefined) hi = parseInt(b) }
      for (let i = lo; i <= hi; i += s) vals.add(i)
      continue
    }
    const range = part.match(/^(\d+)-(\d+)$/)
    if (range) { for (let i = parseInt(range[1]); i <= parseInt(range[2]); i++) vals.add(i); continue }
    if (part === "*") { for (let i = min; i <= max; i++) vals.add(i); continue }
    const n = parseInt(part)
    if (!isNaN(n)) vals.add(n)
  }
  return [...vals].sort((a, b) => a - b)
}

function getOccurrencesForMonth(schedule: ScheduleResponse, year: number, month: number): Map<number, { times: string[]; runsPerDay: number }> {
  const result = new Map<number, { times: string[]; runsPerDay: number }>()
  const dim = new Date(year, month + 1, 0).getDate()
  if (!schedule.cron) return result
  try {
    const p = schedule.cron.trim().split(/\s+/)
    if (p.length !== 5) return result
    const [minF, hrF, domF, monF, dowF] = p
    if (monF !== "*" && !parseCronField(monF, 12, 1).includes(month + 1)) return result
    const hrs = parseCronField(hrF, 23)
    const mins = parseCronField(minF, 59)
    const allTimes: string[] = []
    for (const h of hrs) for (const m of mins) allTimes.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`)
    const rpd = allTimes.length
    const show = rpd > 6 ? allTimes.slice(0, 3) : allTimes
    const vDom = domF !== "*" ? parseCronField(domF, dim, 1) : null
    const vDow = dowF !== "*" ? parseCronField(dowF, 6, 0) : null
    for (let d = 1; d <= dim; d++) {
      const dow = new Date(year, month, d).getDay()
      let ok = !vDom && !vDow ? true : vDom && vDow ? vDom.includes(d) || vDow.includes(dow) : vDom ? vDom.includes(d) : vDow ? vDow.includes(dow) : false
      if (ok) result.set(d, { times: show, runsPerDay: rpd })
    }
  } catch { for (let d = 1; d <= dim; d++) result.set(d, { times: [], runsPerDay: 1 }) }
  return result
}

function getTasksForDate(schedules: ScheduleResponse[], date: Date) {
  const y = date.getFullYear(), m = date.getMonth()
  return schedules.flatMap((s) => {
    const occ = getOccurrencesForMonth(s, y, m)
    const info = occ.get(date.getDate())
    return info ? [{ schedule: s, times: info.times, runsPerDay: info.runsPerDay }] : []
  })
}

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const TINY_DAYS = ["S", "M", "T", "W", "T", "F", "S"]

function ScheduleCalendar({ schedules, selectedDate, onSelectDate, onRun, onPause, onEdit }: { schedules: ScheduleResponse[]; selectedDate: Date; onSelectDate: (d: Date) => void; onRun?: (chatId: string) => void; onPause?: (chatId: string) => void; onEdit?: (chatId: string) => void }) {
  const today = new Date()
  const [month, setMonth] = useState(selectedDate.getMonth())
  const [year, setYear] = useState(selectedDate.getFullYear())
  const [direction, setDirection] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  const days = useMemo(() => {
    const total = new Date(year, month + 1, 0).getDate()
    return Array.from({ length: total }, (_, i) => new Date(year, month, i + 1))
  }, [year, month])

  const taskMap = useMemo(() => {
    const map = new Map<number, number>()
    for (const s of schedules) { const occ = getOccurrencesForMonth(s, year, month); for (const [day] of occ) map.set(day, (map.get(day) || 0) + 1) }
    return map
  }, [schedules, year, month])

  const selectedTasks = useMemo(() => getTasksForDate(schedules, selectedDate), [schedules, selectedDate])

  const isThisMonth = month === today.getMonth() && year === today.getFullYear()
  const selDay = selectedDate.getDate(), selMonth = selectedDate.getMonth(), selYear = selectedDate.getFullYear()
  const isSel = (d: Date) => d.getDate() === selDay && month === selMonth && year === selYear
  const isTod = (d: Date) => d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear()
  const isTodaySelected = selDay === today.getDate() && selMonth === today.getMonth() && selYear === today.getFullYear()

  function nav(delta: number) {
    setDirection(delta)
    let m = month + delta, y = year
    if (m > 11) { m = 0; y++ } if (m < 0) { m = 11; y-- }
    setMonth(m); setYear(y); onSelectDate(new Date(y, m, 1))
  }

  useEffect(() => {
    const el = scrollRef.current; if (!el) return
    const target = el.querySelector('[data-selected="true"]') as HTMLElement
    if (target) el.scrollTo({ left: target.offsetLeft - el.offsetWidth / 2 + target.offsetWidth / 2, behavior: "smooth" })
  }, [month, year])

  useEffect(() => {
    const el = scrollRef.current; if (!el) return
    requestAnimationFrame(() => {
      const target = el.querySelector('[data-today="true"]') as HTMLElement
      if (target) el.scrollTo({ left: target.offsetLeft - el.offsetWidth / 2 + target.offsetWidth / 2, behavior: "instant" })
    })
  }, [])

  const monthSlide = {
    enter: (dir: number) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? -40 : 40, opacity: 0 }),
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => nav(-1)} className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground/50 hover:text-foreground transition-all"><ChevronLeft className="h-4 w-4" /></button>
          <div className="relative overflow-hidden w-[160px] h-7">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.h2 key={`${year}-${month}`} custom={direction} variants={monthSlide} initial="enter" animate="center" exit="exit" transition={{ duration: 0.25, ease: "easeOut" }} className="absolute inset-0 flex items-center text-base font-semibold tracking-tight text-foreground">
                {new Date(year, month).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
              </motion.h2>
            </AnimatePresence>
          </div>
          <button onClick={() => nav(1)} className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground/50 hover:text-foreground transition-all"><ChevronRight className="h-4 w-4" /></button>
        </div>
        {!isThisMonth && (
          <motion.button initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} onClick={() => { setDirection(0); setMonth(today.getMonth()); setYear(today.getFullYear()); onSelectDate(today) }} className="text-[11px] px-3 py-1 rounded-lg bg-muted/40 hover:bg-muted/60 text-muted-foreground/60 hover:text-foreground transition-all">
            Today
          </motion.button>
        )}
      </div>

      <div className="relative">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div key={`${year}-${month}`} custom={direction} initial={{ x: direction > 0 ? 60 : -60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: direction > 0 ? -60 : 60, opacity: 0 }} transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}>
            <div ref={scrollRef} className="flex gap-1.5 sm:gap-2 overflow-x-auto scrollbar-invisible py-1 px-3" style={{ scrollSnapType: "x mandatory" }}>
              {days.map((day) => {
                const sel = isSel(day), tod = isTod(day), taskCount = taskMap.get(day.getDate()) || 0
                return (
                  <motion.button key={day.getDate()} data-selected={sel ? "true" : undefined} data-today={tod ? "true" : undefined} onClick={() => onSelectDate(day)} whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }}
                    className={cn("relative flex flex-col items-center gap-1 px-2.5 sm:px-3 py-2.5 sm:py-3 rounded-xl shrink-0 transition-all duration-200 min-w-[44px] sm:min-w-[52px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", sel ? "bg-muted ring-1 ring-border shadow-sm" : "hover:bg-muted/40")}
                    style={{ scrollSnapAlign: "center" }}
                  >
                    <span className={cn("text-[10px] font-medium uppercase tracking-wider leading-none", sel ? "text-foreground/60" : "text-muted-foreground/40")}>
                      <span className="sm:hidden">{TINY_DAYS[day.getDay()]}</span><span className="hidden sm:inline">{SHORT_DAYS[day.getDay()]}</span>
                    </span>
                    <span className={cn("text-lg sm:text-xl font-bold leading-none tabular-nums", sel ? "text-foreground" : tod ? "text-foreground/80" : "text-foreground/50")}>{day.getDate()}</span>
                    <div className="h-1.5 flex items-center justify-center gap-0.5 mt-0.5">
                      {taskCount > 0 ? (
                        <>{Array.from({ length: Math.min(taskCount, 3) }, (_, i) => <div key={i} className={cn("w-1 h-1 rounded-full transition-colors duration-300", sel ? "bg-emerald-500" : "bg-muted-foreground/25")} />)}{taskCount > 3 && <span className={cn("text-[8px] leading-none font-bold", sel ? "text-emerald-500" : "text-muted-foreground/25")}>+</span>}</>
                      ) : <div className="w-1 h-1" />}
                    </div>
                    {tod && !sel && <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-muted-foreground/40" />}
                  </motion.button>
                )
              })}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={`${selYear}-${selMonth}-${selDay}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2, ease: "easeOut" }} className="rounded-xl border border-border/20 bg-muted/20 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50"><CalendarDays className="h-3.5 w-3.5 text-muted-foreground/50" /></div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">{selectedDate.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</h3>
                <p className="text-[11px] text-muted-foreground/50">{selectedTasks.length === 0 ? "No employees scheduled" : `${selectedTasks.length} employee${selectedTasks.length > 1 ? "s" : ""} scheduled`}</p>
              </div>
            </div>
            {isTodaySelected && <span className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground/40 bg-muted/50 px-2 py-0.5 rounded-md">Today</span>}
          </div>
          {selectedTasks.length > 0 ? (
            <div className="px-2 pb-2 space-y-0.5">
              {selectedTasks.map((task, i) => {
                const s = task.schedule, isAct = s.enabled && !s.paused_reason, isFail = s.paused_reason === "too_many_failures"
                return (
                  <motion.div key={s.chat_id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05, duration: 0.2 }} className="group flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/30 transition-all">
                    {/* Status dot */}
                    <div className={cn("w-2 h-2 rounded-full shrink-0", isAct ? "bg-emerald-500" : isFail ? "bg-amber-500" : "bg-muted-foreground/25")} />
                    {/* Info — clickable */}
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onEdit?.(s.chat_id)}>
                      <div className="flex items-center gap-2">
                        <p className="text-[13px] font-semibold text-foreground/70 truncate group-hover:text-foreground transition-colors">{s.title || "Untitled"}</p>
                        <span className={cn("text-[10px] font-medium shrink-0", isAct ? "text-emerald-600 dark:text-emerald-400" : isFail ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground/30")}>{isAct ? "On Duty" : isFail ? "Attention" : "Standby"}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground/35 mt-0.5 tabular-nums">
                        {task.runsPerDay > 6 ? `${task.runsPerDay}x/day` : task.times.length > 0 ? task.times[0] : formatFrequency(s.frequency)}
                        {s.run_count > 0 ? ` · ${s.run_count} runs` : ""}
                        {s.next_run_at ? ` · Next ${formatNextRun(s.next_run_at)}` : ""}
                      </p>
                    </div>
                    {/* Actions */}
                    <div className="flex items-center gap-0.5 shrink-0 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      {onRun && <ActionButton icon={CoastyIcon} label="Run" onClick={() => onRun(s.chat_id)} />}
                      {onPause && <ActionButton icon={s.enabled ? Pause : Play} onClick={() => onPause(s.chat_id)} />}
                      {onEdit && <ActionButton icon={Pencil} onClick={() => onEdit(s.chat_id)} />}
                    </div>
                  </motion.div>
                )
              })}
            </div>
          ) : (
            <div className="pb-6 pt-2 text-center"><CoastyIcon className="h-5 w-5 text-muted-foreground/15 mx-auto mb-1.5" /><p className="text-[11px] text-muted-foreground/30">No employees on this day</p></div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════
   Inline: ScheduleHistory
   ═══════════════════════════════════════════════════════ */

function historyStatusConfig(status: string) {
  switch (status) {
    case "completed": return { dotColor: "bg-emerald-500", label: "Completed", labelColor: "text-emerald-600 dark:text-emerald-400" }
    case "failed": return { dotColor: "bg-rose-500", label: "Failed", labelColor: "text-rose-600 dark:text-rose-400" }
    case "skipped": return { dotColor: "bg-muted-foreground/40", label: "Skipped", labelColor: "text-muted-foreground" }
    case "cancelled": return { dotColor: "bg-muted-foreground/40", label: "Cancelled", labelColor: "text-muted-foreground" }
    case "triggered": return { dotColor: "bg-sky-500", label: "Triggered", labelColor: "text-sky-600 dark:text-sky-400" }
    default: return { dotColor: "bg-muted-foreground/40", label: status, labelColor: "text-muted-foreground" }
  }
}

function formatHistoryDate(iso: string) {
  const d = new Date(iso), now = new Date(), diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000), diffHrs = Math.floor(diffMs / 3600000), diffDays = Math.floor(diffMs / 86400000)
  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHrs < 24) return `${diffHrs}h ago`
  if (diffDays === 1) return "yesterday"
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function ScheduleHistory({ chatId, limit = 20 }: { chatId?: string; limit?: number }) {
  const [history, setHistory] = useState<ScheduleHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getScheduleHistory(chatId, limit).then(setHistory).catch(() => setHistory([])).finally(() => setLoading(false))
  }, [chatId, limit])

  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <div className="relative h-8 w-8"><div className="absolute inset-0 rounded-full border-2 border-border/20" /><div className="absolute inset-0 rounded-full border-2 border-transparent border-t-muted-foreground/50 animate-spin" /></div>
    </div>
  )

  if (history.length === 0) return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted/40 mb-3"><History className="h-5 w-5 text-muted-foreground/25" /></div>
      <p className="text-sm font-medium text-muted-foreground/50">No activity yet</p>
      <p className="text-[11px] text-muted-foreground/30 mt-1 max-w-[220px]">Logs will appear here once your employees start working</p>
    </div>
  )

  return (
    <div className="divide-y divide-border/10">
      {history.map((entry, idx) => {
        const cfg = historyStatusConfig(entry.status)
        return (
          <motion.div key={entry.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.03 }} className="group flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors duration-200">
            <div className={cn("w-2 h-2 rounded-full shrink-0", cfg.dotColor)} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={cn("text-xs font-semibold", cfg.labelColor)}>{cfg.label}</span>
                {entry.trigger === "manual" && <span className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground/30 bg-muted/40 px-1.5 py-px rounded">manual</span>}
              </div>
              {entry.error && <p className="text-[11px] text-muted-foreground/40 truncate mt-0.5" title={entry.error}>{entry.error}</p>}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {entry.duration_seconds != null && <span className="hidden sm:inline text-[11px] text-muted-foreground/30 tabular-nums font-medium">{entry.duration_seconds}s</span>}
              {entry.credits_charged != null && entry.credits_charged > 0 && <span className="hidden sm:inline text-[11px] text-muted-foreground/30 tabular-nums">{entry.credits_charged} cr</span>}
              <span className="text-[11px] text-muted-foreground/30 tabular-nums min-w-[48px] text-right" title={new Date(entry.executed_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}>{formatHistoryDate(entry.executed_at)}</span>
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}

/* ═══ Full Org Chart — Company → Teams → Employees with delegation arrows ═══ */
function OrgChart({ teams, schedules, onRefresh, onEdit }: { teams: TeamResponse[]; schedules: ScheduleResponse[]; onRefresh: () => void; onEdit: (chatId: string) => void }) {
  const t = useTranslations("schedulesPage")
  const chartRef = useRef<HTMLDivElement>(null)
  const companyRef = useRef<HTMLDivElement>(null)
  const teamRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const memberRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [connectors, setConnectors] = useState<{ d: string; type: "tree" | "delegation" }[]>([])
  const [delegations, setDelegations] = useState<Map<string, DelegateConfig[]>>(new Map())
  const [busy, setBusy] = useState<string | null>(null)
  const [showAddMenu, setShowAddMenu] = useState<string | null>(null)
  const [editingTeam, setEditingTeam] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [editInstructions, setEditInstructions] = useState("")
  const [dragOverTeam, setDragOverTeam] = useState<string | null>(null)
  const dragCounter = useRef<Map<string, number>>(new Map())

  // All employees in any team
  const allMemberIds = useMemo(() => {
    const ids = new Set<string>()
    teams.forEach(tm => tm.members.forEach(m => ids.add(m.chat_id)))
    return ids
  }, [teams])

  // Unassigned employees (not in any team)
  const unassigned = useMemo(() => schedules.filter(s => !allMemberIds.has(s.chat_id)), [schedules, allMemberIds])

  // Build set of all delegate target IDs (employees that are delegated TO)
  const delegateTargetIds = useMemo(() => {
    const targets = new Set<string>()
    delegations.forEach(dels => dels.forEach(d => targets.add(d.chat_id)))
    return targets
  }, [delegations])

  // Load delegations for ALL employees across all teams
  useEffect(() => {
    async function load() {
      const map = new Map<string, DelegateConfig[]>()
      const allIds = new Set<string>()
      teams.forEach(tm => tm.members.forEach(m => allIds.add(m.chat_id)))
      await Promise.all(Array.from(allIds).map(async (chatId) => {
        try {
          const dels = await getDelegates(chatId)
          // Keep delegates that exist in the org chart
          const visible = dels.filter(d => allIds.has(d.chat_id))
          if (visible.length > 0) map.set(chatId, visible)
        } catch {}
      }))
      setDelegations(map)
    }
    if (allMemberIds.size > 0) load()
    else setDelegations(new Map())
  }, [allMemberIds.size, teams])

  // Calculate all connector lines: tree hierarchy + delegation arrows
  const recalcConnectors = useCallback(() => {
    if (!chartRef.current) return
    const cr = chartRef.current.getBoundingClientRect()
    const paths: { d: string; type: "tree" | "delegation" }[] = []

    // Company → Team connectors
    const companyEl = companyRef.current
    if (companyEl && teams.length > 0) {
      const cb = companyEl.getBoundingClientRect()
      const cx = cb.left + cb.width / 2 - cr.left
      const cy = cb.bottom - cr.top

      teams.forEach(tm => {
        const te = teamRefs.current.get(tm.hub_id)
        if (!te) return
        const tb = te.getBoundingClientRect()
        const tx = tb.left + tb.width / 2 - cr.left
        const ty = tb.top - cr.top
        const midY = (cy + ty) / 2
        paths.push({ d: `M ${cx} ${cy} C ${cx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`, type: "tree" })
      })
    }

    // Team → top-tier Employee connectors (skip delegates — they connect via delegation arrows)
    teams.forEach(tm => {
      const te = teamRefs.current.get(tm.hub_id)
      if (!te) return
      const tb = te.getBoundingClientRect()
      const tx = tb.left + tb.width / 2 - cr.left
      const ty = tb.bottom - cr.top

      tm.members.forEach(m => {
        if (delegateTargetIds.has(m.chat_id)) return // skip — connected via delegation arrow
        const me = memberRefs.current.get(m.chat_id)
        if (!me) return
        const mb = me.getBoundingClientRect()
        const mx = mb.left + mb.width / 2 - cr.left
        const my = mb.top - cr.top
        const midY = (ty + my) / 2
        paths.push({ d: `M ${tx} ${ty} C ${tx} ${midY}, ${mx} ${midY}, ${mx} ${my}`, type: "tree" })
      })
    })

    // Delegation arrows (employee → employee)
    delegations.forEach((dels, fromId) => {
      const fe = memberRefs.current.get(fromId)
      if (!fe) return
      const fr = fe.getBoundingClientRect()
      for (const d of dels) {
        const te = memberRefs.current.get(d.chat_id)
        if (!te) continue
        const tr = te.getBoundingClientRect()
        // From bottom-center of source to top-center of target
        const sx = fr.left + fr.width / 2 - cr.left
        const sy = fr.bottom - cr.top
        const ex = tr.left + tr.width / 2 - cr.left
        const ey = tr.top - cr.top
        // If same row, use side-to-side
        if (Math.abs(fr.top - tr.top) < 20) {
          const fromRight = fr.left < tr.left
          const sxH = (fromRight ? fr.right : fr.left) - cr.left
          const syH = fr.top + fr.height / 2 - cr.top
          const exH = (fromRight ? tr.left : tr.right) - cr.left
          const eyH = tr.top + tr.height / 2 - cr.top
          const mx = (sxH + exH) / 2
          paths.push({ d: `M ${sxH} ${syH} C ${mx} ${syH}, ${mx} ${eyH}, ${exH} ${eyH}`, type: "delegation" })
        } else {
          const cp = Math.max(20, Math.abs(ey - sy) * 0.4)
          paths.push({ d: `M ${sx} ${sy} C ${sx} ${sy + cp}, ${ex} ${ey - cp}, ${ex} ${ey}`, type: "delegation" })
        }
      }
    })

    setConnectors(paths)
  }, [teams, delegations, delegateTargetIds])

  useEffect(() => {
    const raf = requestAnimationFrame(recalcConnectors)
    const ro = new ResizeObserver(recalcConnectors)
    if (chartRef.current) ro.observe(chartRef.current)
    window.addEventListener("resize", recalcConnectors)
    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener("resize", recalcConnectors) }
  }, [recalcConnectors])

  // Team actions
  async function addMember(teamId: string, chatId: string) {
    setBusy(`add-${chatId}`); try { await addTeamMember(teamId, chatId); onRefresh() } catch {} setBusy(null)
    setShowAddMenu(null)
  }
  async function removeMember(teamId: string, chatId: string) {
    setBusy(`rm-${chatId}`); try { await removeTeamMember(teamId, chatId); onRefresh() } catch {} setBusy(null)
  }
  async function disband(teamId: string) {
    setBusy(`del-${teamId}`); try { await deleteTeam(teamId); onRefresh() } catch {} setBusy(null)
  }
  function startEdit(team: TeamResponse) {
    setEditingTeam(team.hub_id); setEditName(team.name); setEditInstructions(team.instructions || "")
  }
  async function saveEdit(teamId: string, origName: string, origInstructions: string) {
    const n = editName.trim(); if (!n) return
    setBusy("edit")
    try { await updateTeam(teamId, { name: n !== origName ? n : undefined, instructions: editInstructions.trim() !== origInstructions ? editInstructions.trim() : undefined }); onRefresh() } catch {}
    setBusy(null); setEditingTeam(null)
  }
  function cancelEdit() { setEditingTeam(null) }

  // Drag & drop handlers for team nodes
  function handleDragEnter(teamId: string, e: React.DragEvent) {
    e.preventDefault()
    const count = (dragCounter.current.get(teamId) || 0) + 1
    dragCounter.current.set(teamId, count)
    if (count === 1) setDragOverTeam(teamId)
  }
  function handleDragLeave(teamId: string) {
    const count = (dragCounter.current.get(teamId) || 0) - 1
    dragCounter.current.set(teamId, Math.max(0, count))
    if (count <= 0) {
      dragCounter.current.delete(teamId)
      setDragOverTeam(prev => prev === teamId ? null : prev)
    }
  }
  function handleDrop(teamId: string, e: React.DragEvent) {
    e.preventDefault()
    dragCounter.current.delete(teamId)
    setDragOverTeam(null)
    const id = e.dataTransfer.getData("application/x-employee-id")
    if (id) addMember(teamId, id)
  }

  return (
    <div ref={chartRef} className="relative w-full">
      {/* SVG layer for all connectors */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ overflow: "visible", zIndex: 1 }}>
        <defs>
          <marker id="deleg-arrow" markerWidth="7" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0.5, 7 3, 0 5.5" fill="#94a3b8" />
          </marker>
        </defs>
        {/* Tree connectors first (behind) */}
        {connectors.filter(c => c.type === "tree").map((c, i) => (
          <path key={`t${i}`} d={c.d} fill="none" className="stroke-border/50" strokeWidth="1.5" />
        ))}
        {/* Delegation arrows on top — subtle dashed lines */}
        {connectors.filter(c => c.type === "delegation").map((c, i) => (
          <path key={`d${i}`} d={c.d} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="5 4" strokeOpacity="0.5" markerEnd="url(#deleg-arrow)" />
        ))}
      </svg>

      {/* Tree layout */}
      <div className="relative flex flex-col items-center" style={{ zIndex: 2 }}>

        {/* ─ Company node ─ */}
        <div
          ref={companyRef}
          className="flex items-center gap-2 sm:gap-3 rounded-xl sm:rounded-2xl border border-border/30 bg-card/50 backdrop-blur-sm px-3 sm:px-5 py-2.5 sm:py-3.5 shadow-sm"
        >
          <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-lg sm:rounded-xl bg-muted/60 flex items-center justify-center ring-1 ring-border/30">
            <CoastyIcon className="h-4 w-4 sm:h-5 sm:w-5 text-foreground/60" />
          </div>
          <div>
            <h3 className="text-xs sm:text-sm font-bold text-foreground tracking-tight">{t("company")}</h3>
            <p className="text-[10px] sm:text-[11px] text-muted-foreground/50">{t("teams", { count: teams.length })} &middot; {t("employees", { count: allMemberIds.size })}</p>
          </div>
        </div>

        {/* ─ Teams row ─ */}
        {teams.length > 0 && (
          <div className="flex flex-wrap justify-center gap-x-5 sm:gap-x-10 gap-y-10 sm:gap-y-14 mt-8 sm:mt-14 w-full">
            {teams.map(team => {
              const avail = schedules.filter(s => !team.members.some(m => m.chat_id === s.chat_id))
              const isEditing = editingTeam === team.hub_id
              return (
                <div key={team.hub_id} className="flex flex-col items-center">
                  {/* Team node */}
                  <div
                    ref={el => { if (el) teamRefs.current.set(team.hub_id, el); else teamRefs.current.delete(team.hub_id) }}
                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "copy" }}
                    onDragEnter={e => handleDragEnter(team.hub_id, e)}
                    onDragLeave={() => handleDragLeave(team.hub_id)}
                    onDrop={e => handleDrop(team.hub_id, e)}
                    className={cn(
                      "group relative flex items-center gap-2 sm:gap-2.5 rounded-lg sm:rounded-xl border px-3 sm:px-4 py-2.5 sm:py-3 shadow-sm dark:shadow-none transition-all duration-200",
                      dragOverTeam === team.hub_id
                        ? "border-emerald-400 dark:border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 ring-2 ring-emerald-400/30 dark:ring-emerald-500/20 scale-[1.02]"
                        : "border-border/30 bg-card/50 backdrop-blur-sm hover:border-border/50"
                    )}
                  >
                    <div className={cn(
                      "h-7 w-7 sm:h-8 sm:w-8 rounded-md sm:rounded-lg flex items-center justify-center ring-1 shrink-0 transition-colors duration-200",
                      dragOverTeam === team.hub_id
                        ? "bg-emerald-100 dark:bg-emerald-900/40 ring-emerald-300/60 dark:ring-emerald-600/40"
                        : "bg-muted/60 ring-border/30"
                    )}>
                      <Users className={cn("h-3 w-3 sm:h-3.5 sm:w-3.5 transition-colors duration-200", dragOverTeam === team.hub_id ? "text-emerald-500" : "text-foreground/40")} />
                    </div>
                    {isEditing ? (
                      <div className="space-y-1.5 min-w-[160px]">
                        <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") saveEdit(team.hub_id, team.name, team.instructions || ""); if (e.key === "Escape") cancelEdit() }}
                          autoFocus
                          className="w-full h-7 rounded-md px-2 text-xs font-semibold bg-muted/60 border border-border/50 text-foreground focus:outline-none focus:border-border transition-all" />
                        <textarea value={editInstructions} onChange={e => setEditInstructions(e.target.value)} rows={1}
                          className="w-full rounded-md px-2 py-1 text-[10px] resize-none bg-muted/60 border border-border/50 text-foreground focus:outline-none focus:border-border transition-all"
                          placeholder={t("guidelinesPlaceholder")} />
                        <div className="flex gap-1.5">
                          <button onClick={() => saveEdit(team.hub_id, team.name, team.instructions || "")} className="h-6 px-2.5 rounded-md text-[10px] font-semibold text-foreground bg-muted hover:bg-muted/80 ring-1 ring-border/50 transition-all">{busy === "edit" ? "\u2026" : t("save")}</button>
                          <button onClick={cancelEdit} className="h-6 px-2 rounded-md text-[10px] text-muted-foreground hover:text-foreground transition-all">{t("cancel")}</button>
                        </div>
                      </div>
                    ) : (
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-foreground truncate">{team.name}</p>
                        <p className="text-[10px] text-muted-foreground/40 leading-tight">{t("members", { count: team.members.length })}</p>
                      </div>
                    )}
                    {!isEditing && (
                      <div className="flex items-center gap-0.5 ml-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0">
                        <button onClick={() => startEdit(team)} className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground/30 hover:text-muted-foreground hover:bg-muted/60 transition-all" title="Edit">
                          <Pencil className="h-2.5 w-2.5" />
                        </button>
                        <button onClick={() => disband(team.hub_id)} disabled={!!busy} className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground/30 hover:text-muted-foreground hover:bg-muted/60 transition-all" title="Disband">
                          <Trash2 className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Employee nodes — split into tiers: managers on top, delegates below */}
                  {(() => {
                    const topTier = team.members.filter(m => !delegateTargetIds.has(m.chat_id))
                    const bottomTier = team.members.filter(m => delegateTargetIds.has(m.chat_id))

                    const renderNode = (m: typeof team.members[0]) => {
                      const sched = schedules.find(s => s.chat_id === m.chat_id)
                      const isActive = sched?.enabled && !sched?.paused_reason
                      const isDelegate = delegateTargetIds.has(m.chat_id)
                      return (
                        <div
                          key={m.chat_id}
                          ref={el => { if (el) memberRefs.current.set(m.chat_id, el); else memberRefs.current.delete(m.chat_id) }}
                          className="group/emp relative flex flex-col items-center cursor-pointer"
                          onClick={() => onEdit(m.chat_id)}
                        >
                          <div className="relative">
                            <div className={cn(
                              "h-10 w-10 rounded-full flex items-center justify-center transition-all sm:h-10 sm:w-10",
                              isDelegate
                                ? "bg-muted/40 ring-1.5 ring-border/40 group-hover/emp:ring-border/60"
                                : "bg-muted/60 ring-1 ring-border/30 group-hover/emp:ring-border/50",
                            )}>
                              <CoastyIcon className={cn("h-4 w-4", isDelegate ? "text-slate-400" : "text-foreground/40")} />
                            </div>
                            <div className={cn(
                              "absolute -bottom-px -right-px h-2.5 w-2.5 rounded-full border-2 border-background",
                              isActive ? "bg-emerald-500" : "bg-muted-foreground/30",
                            )} />
                          </div>
                          <p className="text-[10px] sm:text-[11px] font-semibold text-foreground mt-1.5 sm:mt-2 text-center max-w-[80px] sm:max-w-[100px] truncate leading-tight">{m.title || t("untitled")}</p>
                          {sched && <p className="text-[8px] sm:text-[9px] text-muted-foreground/40 leading-tight mt-0.5">{formatFrequency(sched.frequency)}</p>}
                          {isDelegate && <span className="text-[8px] font-medium text-muted-foreground/50 mt-0.5 uppercase tracking-wider">{t("delegate")}</span>}
                          <button
                            onClick={e => { e.stopPropagation(); removeMember(team.hub_id, m.chat_id) }}
                            disabled={!!busy}
                            className="absolute -top-1 -right-1 h-4 w-4 flex items-center justify-center rounded-full bg-muted opacity-0 group-hover/emp:opacity-100 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-500 text-muted-foreground/40 transition-all ring-1 ring-border/50"
                          >
                            <X className="h-2 w-2" />
                          </button>
                        </div>
                      )
                    }

                    return (
                      <div className="flex flex-col items-center">
                        {/* Top tier — managers / non-delegates */}
                        <div className="flex flex-wrap justify-center gap-x-4 sm:gap-x-6 gap-y-6 sm:gap-y-10 mt-6 sm:mt-10">
                          {topTier.map(renderNode)}
                          {/* Add member button */}
                          <div className="relative flex flex-col items-center">
                            <button
                              onClick={() => setShowAddMenu(showAddMenu === team.hub_id ? null : team.hub_id)}
                              disabled={avail.length === 0}
                              className={cn(
                                "h-10 w-10 rounded-full border border-dashed flex items-center justify-center transition-all",
                                avail.length === 0
                                  ? "border-border/20 text-muted-foreground/15 cursor-not-allowed"
                                  : "border-border/40 text-muted-foreground/30 hover:text-muted-foreground hover:border-border/60 hover:bg-muted/40",
                              )}
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                            <p className="text-[9px] text-muted-foreground/30 mt-2">{t("add")}</p>
                            {showAddMenu === team.hub_id && avail.length > 0 && (
                              <>
                                <div className="fixed inset-0 z-40" onClick={() => setShowAddMenu(null)} />
                                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 w-52 max-h-48 overflow-y-auto rounded-xl bg-background border border-border/50 shadow-xl py-1 scrollbar-invisible">
                                  {avail.map(s => (
                                    <button key={s.chat_id} onClick={() => addMember(team.hub_id, s.chat_id)} disabled={busy === `add-${s.chat_id}`}
                                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/60 transition-colors disabled:opacity-40">
                                      <div className="h-5 w-5 rounded-full flex items-center justify-center shrink-0 bg-muted/60">
                                        <CoastyIcon className="h-2.5 w-2.5 text-foreground/60" />
                                      </div>
                                      <div className="min-w-0">
                                        <p className="text-xs font-medium text-foreground truncate">{s.title || t("untitled")}</p>
                                        <p className="text-[10px] text-muted-foreground/60">{formatFrequency(s.frequency)}</p>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                        {/* Bottom tier — delegates (shown lower) */}
                        {bottomTier.length > 0 && (
                          <div className="flex flex-wrap justify-center gap-x-4 sm:gap-x-6 gap-y-6 sm:gap-y-10 mt-8 sm:mt-12">
                            {bottomTier.map(renderNode)}
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              )
            })}
          </div>
        )}

        {/* ─ Unassigned employees ─ */}
        {unassigned.length > 0 && teams.length > 0 && (
          <div className="mt-8 sm:mt-14 w-full">
            <div className="flex items-center gap-3 mb-3 sm:mb-4">
              <div className="h-px flex-1 bg-border/30" />
              <span className="text-[9px] sm:text-[10px] font-medium text-muted-foreground/40 uppercase tracking-widest">{t("unassigned")}</span>
              <div className="h-px flex-1 bg-border/30" />
            </div>
            <div className="flex flex-wrap justify-center gap-2 sm:gap-4">
              {unassigned.map(s => {
                const isActive = s.enabled && !s.paused_reason
                return (
                  <div
                    key={s.chat_id}
                    draggable
                    onDragStart={e => {
                      e.dataTransfer.setData("application/x-employee-id", s.chat_id)
                      e.dataTransfer.effectAllowed = "copy"
                    }}
                    className="flex items-center gap-2 sm:gap-2.5 rounded-lg sm:rounded-xl border border-dashed border-border/40 px-2.5 sm:px-3 py-1.5 sm:py-2 cursor-grab active:cursor-grabbing hover:border-border/60 hover:bg-muted/40 transition-all select-none"
                  >
                    <div className="relative shrink-0">
                      <div className="h-7 w-7 rounded-full bg-muted/60 flex items-center justify-center ring-1 ring-border/30">
                        <CoastyIcon className="h-3 w-3 text-foreground/30" />
                      </div>
                      <div className={cn(
                        "absolute -bottom-px -right-px h-2 w-2 rounded-full border-[1.5px] border-background",
                        isActive ? "bg-emerald-500" : "bg-muted-foreground/30",
                      )} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-foreground truncate leading-tight">{s.title || t("untitled")}</p>
                      <p className="text-[10px] text-muted-foreground/40 leading-tight">{formatFrequency(s.frequency)}</p>
                    </div>
                    <GripVertical className="h-3 w-3 text-muted-foreground/20 shrink-0 ml-1" />
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Tiny action button ── */
function ActionButton({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ className?: string }>; label?: string; onClick: () => void }) {
  return (
    <motion.button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.92 }}
      className={cn(
        "flex items-center gap-1 rounded-md transition-colors",
        label ? "h-7 px-2 text-[11px] font-medium text-muted-foreground/50 hover:text-foreground hover:bg-muted/50" : "h-7 w-7 justify-center text-muted-foreground/30 hover:text-muted-foreground hover:bg-muted/40",
      )}
    >
      <Icon className="h-3 w-3" />
      {label && <span>{label}</span>}
    </motion.button>
  )
}

/* ═══ Main ═══ */
export function SchedulesContent() {
  const t = useTranslations("schedulesPage")
  const router = useRouter()
  const { user } = useUser()
  const [schedules, setSchedules] = useState<ScheduleResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>("teams")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [machines, setMachines] = useState<UserMachine[]>([])
  const [editChatId, setEditChatId] = useState<string | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [historyChat, setHistoryChat] = useState<string | undefined>(undefined)
  const [showHistory, setShowHistory] = useState(false)
  const [teams, setTeams] = useState<TeamResponse[]>([])
  const [showCreateTeam, setShowCreateTeam] = useState(false)
  const [newTeamName, setNewTeamName] = useState("")
  const [newTeamInstructions, setNewTeamInstructions] = useState("")
  const [selectedTemplate, setSelectedTemplate] = useState<TeamTemplate | null>(null)
  const [createStep, setCreateStep] = useState<"templates" | "form">("templates")
  const [credDialogOpen, setCredDialogOpen] = useState(false)
  const [credDialogService, setCredDialogService] = useState("")
  const [addedCredentials, setAddedCredentials] = useState<Set<string>>(new Set())
  const [customCredentials, setCustomCredentials] = useState<{ service: string; name: string }[]>([])
  const [provisioning, setProvisioning] = useState(false)
  const [provisionStatus, setProvisionStatus] = useState("")
  const [limitError, setLimitError] = useState<{ message: string; needsMachines?: number; needsSchedules?: number } | null>(null)

  const loadSchedules = useCallback(async () => {
    try { setSchedules(await listSchedules()) } catch { setSchedules([]) } finally { setLoading(false) }
  }, [])

  const loadTeams = useCallback(async () => {
    try { setTeams(await listTeams()) } catch { setTeams([]) }
  }, [])

  const refreshAll = useCallback(() => { loadSchedules(); loadTeams() }, [loadSchedules, loadTeams])

  useEffect(() => {
    loadSchedules(); loadTeams()
    fetch("/api/machines").then((r) => r.json()).then((d) => setMachines(d.machines ?? [])).catch(() => {})
  }, [loadSchedules, loadTeams])

  const activeCount = schedules.filter((s) => s.enabled && !s.paused_reason).length
  const pausedCount = schedules.filter((s) => !s.enabled || s.paused_reason).length

  const filteredSchedules = useMemo(() =>
    statusFilter === "all" ? schedules
      : statusFilter === "active" ? schedules.filter((s) => s.enabled && !s.paused_reason)
      : schedules.filter((s) => !s.enabled || s.paused_reason),
    [schedules, statusFilter]
  )

  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }>; count?: number }[] = [
    { id: "teams", label: t("teamsTab"), icon: Users, count: teams.length },
    { id: "employees", label: t("title"), icon: AgentIcon, count: schedules.length },
  ]

  function resetCreateTeam() {
    setNewTeamName(""); setNewTeamInstructions(""); setSelectedTemplate(null); setCreateStep("templates")
    setShowCreateTeam(false); setAddedCredentials(new Set()); setCustomCredentials([])
    setProvisioning(false); setProvisionStatus(""); setLimitError(null)
  }

  function pickTemplate(tmpl: TeamTemplate) {
    setSelectedTemplate(tmpl); setNewTeamName(t(tmpl.nameKey)); setNewTeamInstructions(tmpl.instructions); setCreateStep("form")
  }

  function buildInstructions(): string {
    let instructions = newTeamInstructions.trim()
    const allCreds = [
      ...[...addedCredentials],
      ...customCredentials.map(c => c.service),
    ]
    if (allCreds.length > 0) {
      const credList = allCreds.map(s => `- ${s}`).join("\n")
      instructions = (instructions || "") + `\n\n[AVAILABLE CREDENTIALS]\nThe following service credentials have been configured and are available for use:\n${credList}\nUse these credentials when you need to log in to these services to complete your tasks.`
    }
    return instructions
  }

  async function handleCreateTeam() {
    if (!newTeamName.trim()) return
    const instructions = buildInstructions()

    // If no template, just create the team shell
    if (!selectedTemplate) {
      try { await createTeam(newTeamName.trim(), instructions || undefined) } catch {}
      resetCreateTeam(); refreshAll()
      return
    }

    // ── Template provisioning flow ──
    setLimitError(null)
    setProvisioning(true)

    try {
      // 1. Check current limits & machines
      setProvisionStatus(t("provisioning.checking"))
      const machineRes = await fetch("/api/machines")
      const machineData = await machineRes.json()
      const currentMachines: UserMachine[] = machineData.machines ?? []
      const limits = machineData.limits ?? { max_machines: 1 }

      // Only cloud machines count — exclude electron/local/docker
      const isCloudMachine = (m: UserMachine) => {
        const p = m.settings?.provider
        return p === "aws" || p === "azure"
      }
      const cloudMachines = currentMachines.filter(m => isCloudMachine(m) && m.status !== "error" && m.status !== "deleting")
      const usableCloudMachines = cloudMachines.filter(m => m.status === "running" || m.status === "stopped" || m.status === "creating" || m.status === "starting")
      const machineSlots = limits.max_machines - cloudMachines.length

      if (usableCloudMachines.length === 0 && machineSlots <= 0) {
        setProvisioning(false)
        setLimitError({
          message: t("limits.machineLimit", { max: limits.max_machines }),
          needsMachines: 1,
        })
        return
      }

      // Check schedule limits — current employees + template employees
      const neededEmployees = selectedTemplate.employees.length
      const currentScheduleCount = schedules.filter(s => s.enabled && !s.paused_reason).length
      const tier = machineData.subscriptionTier || "free"
      const scheduleLimits: Record<string, number> = { free: 3, starter: 3, basic: 3, professional: 10, pro: 10, enterprise: 50 }
      const maxSchedules = scheduleLimits[tier] ?? 3
      const availableSlots = maxSchedules - currentScheduleCount

      if (availableSlots < neededEmployees) {
        setProvisioning(false)
        setLimitError({
          message: availableSlots <= 0
            ? t("limits.employeeLimit", { max: maxSchedules, tier })
            : t("limits.templateLimit", { needed: neededEmployees, available: availableSlots, max: maxSchedules, tier }),
          needsSchedules: neededEmployees - availableSlots,
        })
        return
      }

      // 2. Pick or create a cloud machine
      let targetMachineId: string
      const runningCloud = usableCloudMachines.find(m => m.status === "running")

      if (runningCloud) {
        targetMachineId = runningCloud.id
        setProvisionStatus(t("provisioning.usingMachine", { name: runningCloud.displayName }))
      } else if (usableCloudMachines.length > 0) {
        // There's a cloud machine but it's stopped/creating/starting — use it anyway
        // The schedule will run once the machine is available
        targetMachineId = usableCloudMachines[0].id
        setProvisionStatus(t("provisioning.assigningMachine", { name: usableCloudMachines[0].displayName }))
      } else {
        // No cloud machines at all — create one
        setProvisionStatus(t("provisioning.creatingMachine"))
        const createRes = await fetch("/api/machines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName: `${newTeamName.trim()} Machine`,
            provider: "aws",
            storageGb: 16,
            desktopEnabled: true,
          }),
        })
        if (!createRes.ok) {
          const err = await createRes.json().catch(() => ({ error: "Failed to create machine" }))
          throw new Error(err.error || "Failed to create machine")
        }
        const createData = await createRes.json()
        targetMachineId = createData.machine?.id
        if (!targetMachineId) throw new Error("Machine creation returned no ID")
        setProvisionStatus(t("provisioning.machineStarted"))
      }

      // 3. Create employee chats + schedules
      const employeeChatIds: string[] = []
      const failedEmployees: string[] = []
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"

      for (let i = 0; i < selectedTemplate.employees.length; i++) {
        const emp = selectedTemplate.employees[i]
        setProvisionStatus(t("provisioning.hiring", { name: emp.name, current: i + 1, total: selectedTemplate.employees.length }))

        try {
          // Create chat
          const chatRes = await fetch("/api/create-chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: emp.name, model: null }),
          })
          if (!chatRes.ok) {
            const errData = await chatRes.json().catch(() => ({}))
            throw new Error(errData.error || `Chat creation failed (${chatRes.status})`)
          }
          const chatData = await chatRes.json()
          const chatId = chatData.chat?.id
          if (!chatId) throw new Error("Chat creation returned no ID")
          employeeChatIds.push(chatId)

          // Create schedule — assign to machine
          const scheduleRes = await createSchedule(chatId, {
            frequency: emp.frequency,
            timezone: tz,
            machineId: targetMachineId,
            taskPrompt: emp.role,
          })
          if (!scheduleRes?.chat_id) {
            console.warn(`Schedule may not have been created for ${emp.name}`)
          }
        } catch (e) {
          console.error(`Failed to set up ${emp.name}:`, e)
          failedEmployees.push(emp.name)
        }
      }

      if (employeeChatIds.length === 0) {
        throw new Error(t("limits.createFailed"))
      }

      // 4. Create team with all members
      setProvisionStatus(t("provisioning.creatingTeam"))
      await createTeam(newTeamName.trim(), instructions || undefined, employeeChatIds)

      if (failedEmployees.length > 0) {
        toast.success(t("toasts.teamCreatedPartial", { count: employeeChatIds.length, failedCount: failedEmployees.length, names: failedEmployees.join(", ") }))
      } else {
        toast.success(t("toasts.teamCreated", { name: t(selectedTemplate.nameKey), count: employeeChatIds.length }))
      }
      resetCreateTeam()
      // Refresh machine list too
      fetch("/api/machines").then(r => r.json()).then(d => setMachines(d.machines ?? [])).catch(() => {})
      refreshAll()
    } catch (e) {
      console.error("Template provisioning failed:", e)
      toast.error(e instanceof Error ? e.message : t("limits.teamFailed"))
      setProvisioning(false)
    }
  }

  return (
    <PageLoader
      isLoading={loading}
      title="Schedules"
      description="Right on time, every time. Syncing your automations."
    >
    <div className="h-full overflow-y-auto scrollbar-invisible relative bg-transparent">
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-1/4 -right-1/4 h-[600px] w-[600px] rounded-full bg-foreground/[0.02] dark:bg-foreground/[0.04] blur-3xl" />
        <div className="absolute -bottom-1/4 -left-1/4 h-[500px] w-[500px] rounded-full bg-foreground/[0.02] dark:bg-foreground/[0.04] blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.015] dark:opacity-[0.03]"
          style={{
            backgroundImage: "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
            backgroundSize: "80px 80px",
          }}
        />
      </div>

      <div className="container mx-auto p-4 sm:p-6 lg:p-8 max-w-7xl space-y-6 relative">

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
        >
          <div>
            <h1 className="text-2xl sm:text-3xl font-medium tracking-tight">{t("title")}</h1>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
              <Link
                href="/guide?tab=workforce"
                className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-foreground/[0.05] px-2.5 py-1 text-xs font-medium text-foreground/70 hover:text-foreground hover:border-border hover:bg-foreground/[0.08] transition-all"
              >
                <BookOpen className="h-3.5 w-3.5" />
                {t("guide")}
              </Link>
              {schedules.length > 0 && (
                <>
                  <span className="h-3.5 w-px bg-border/30 hidden sm:block" />
                  <div className="flex items-center gap-3 text-xs">
                    <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(52,211,153,0.4)]" />{t("onDuty", { count: activeCount })}
                    </span>
                    {pausedCount > 0 && (
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />{t("standby", { count: pausedCount })}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
          <button onClick={() => setShowCreateDialog(true)} className={cn("inline-flex h-9 items-center justify-center rounded-xl px-5 text-sm font-medium gap-2 transition-all bg-muted hover:bg-muted/80 text-foreground ring-1 ring-border/50 hover:ring-border shadow-sm hover:shadow-md")}>
            <UserPlus className="h-4 w-4" />{t("hireEmployee")}
          </button>
        </motion.div>

        {/* Banner */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
          className={cn("relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl px-3 sm:px-4 py-3 border border-border/30 bg-card/50 backdrop-blur-sm overflow-hidden")}
        >
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent" />
          <div className="flex items-start sm:items-center gap-2 sm:gap-3 min-w-0">
            <AgentIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5 sm:mt-0" />
            <p className="text-xs sm:text-sm text-muted-foreground">
              {t("emptyState.openChat")} <span className="inline-flex items-center gap-1 font-bold text-foreground"><AgentIcon className="h-3 w-3" />{t("emptyState.assignEmployee")}</span> {t("emptyState.onThe")} <span className="font-bold text-foreground">{t("emptyState.topRight")}</span> {t("emptyState.toPutOnAutopilot")}
            </p>
          </div>
          <Link href="/" className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all bg-muted/60 hover:bg-muted text-foreground/70 hover:text-foreground")}>
            <CoastyIcon className="h-3 w-3" />{t("emptyState.newChat")}
          </Link>
        </motion.div>

        {/* Tabs */}
        {schedules.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="inline-flex items-center rounded-xl bg-foreground/[0.04] p-1"
          >
            {tabs.map((tab) => {
              const Icon = tab.icon
              const active = activeTab === tab.id
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={cn(
                  "relative flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all duration-200 rounded-lg",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground/80",
                )}>
                  <Icon className={cn("h-3.5 w-3.5", active ? "text-foreground/70" : "text-muted-foreground/50")} />
                  <span>{tab.label}</span>
                  {tab.count !== undefined && tab.count > 0 && (
                    <span className={cn(
                      "text-[11px] min-w-[18px] text-center px-1.5 py-px rounded-md tabular-nums font-semibold",
                      active ? "bg-muted/60 text-foreground/60" : "text-muted-foreground/40",
                    )}>{tab.count}</span>
                  )}
                </button>
              )
            })}
          </motion.div>
        )}

        {/* ═══ Empty state ═══ */}
        {schedules.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className={cn("relative rounded-2xl overflow-hidden border border-border/30 bg-card/50 backdrop-blur-sm")}
          >
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute -top-12 right-1/4 h-56 w-56 rounded-full bg-foreground/[0.02] blur-3xl" />
              <div className="absolute -bottom-12 left-1/4 h-48 w-48 rounded-full bg-foreground/[0.02] blur-3xl" />
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.08] to-transparent" />
            </div>
            <div className="relative flex flex-col items-center py-10 sm:py-14 px-4 sm:px-6 text-center">
              <div className="flex items-center gap-2 sm:gap-2.5 mb-6 sm:mb-8 flex-wrap justify-center">
                {[Briefcase, Mail, Globe, RefreshCw, ShieldCheck, FileText].map((Icon, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3, delay: 0.15 + i * 0.04, ease: [0.22, 1, 0.36, 1] }}
                    className={cn("flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg sm:rounded-xl bg-card/80 border border-border/30 shadow-sm")}
                  >
                    <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                  </motion.div>
                ))}
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3, delay: 0.39, ease: [0.22, 1, 0.36, 1] }}
                  className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg sm:rounded-xl bg-muted/40 border border-border/20"
                >
                  <MoreHorizontal className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-muted-foreground/60" />
                </motion.div>
              </div>
              <h3 className="text-xl font-bold mb-2 text-foreground">{t("emptyWorkforce.title")}</h3>
              <p className="text-sm text-muted-foreground max-w-sm mb-10">{t("emptyWorkforce.description")}</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10 text-left w-full max-w-xl">
                {[
                  { icon: Clock, title: t("emptyWorkforce.flexibleShifts.title"), desc: t("emptyWorkforce.flexibleShifts.desc") },
                  { icon: Cpu, title: t("emptyWorkforce.fullAutonomy.title"), desc: t("emptyWorkforce.fullAutonomy.desc") },
                  { icon: Activity, title: t("emptyWorkforce.activityLogs.title"), desc: t("emptyWorkforce.activityLogs.desc") },
                ].map(({ icon: Icon, title, desc }, i) => (
                  <motion.div
                    key={title}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.2 + i * 0.06, ease: [0.22, 1, 0.36, 1] }}
                    className={cn("relative flex flex-col gap-2 rounded-xl p-4 overflow-hidden border border-border/30 bg-card/50 backdrop-blur-sm")}
                  >
                    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.08] to-transparent" />
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted/60"><Icon className="h-3.5 w-3.5 text-muted-foreground" /></div>
                    <p className="text-xs font-semibold text-foreground/80">{title}</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{desc}</p>
                  </motion.div>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => setShowCreateDialog(true)} className={cn("inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all duration-300 text-foreground bg-muted hover:bg-muted/80 ring-1 ring-border/50 hover:ring-border shadow-sm hover:shadow-md hover:scale-[1.02] active:scale-[0.98]")}>
                  <UserPlus className="h-3.5 w-3.5" />{t("hireEmployee")}
                </button>
                <Link href="/" className={cn("inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all border border-border/30 bg-card/50 text-foreground/80 hover:bg-card/80 hover:border-border/50")}>
                  <CoastyIcon className="h-3.5 w-3.5" />{t("emptyWorkforce.startFromChat")}
                </Link>
              </div>
            </div>
          </motion.div>
        )}

        {/* ═══ TEAMS TAB ═══ */}
        {schedules.length > 0 && activeTab === "teams" && (
          <div className="space-y-5">

            {/* Create Team Dialog — template picker + form */}
            <Dialog open={showCreateTeam} onOpenChange={(open) => { if (!open) resetCreateTeam() }}>
              <DialogContent hasCloseButton={false} className={cn(
                "p-0 gap-0 overflow-hidden rounded-2xl border-border/30 shadow-2xl transition-all duration-300",
                createStep === "templates" ? "sm:max-w-2xl" : "sm:max-w-md"
              )}>
                <VisuallyHidden.Root><DialogTitle>Create a new team</DialogTitle></VisuallyHidden.Root>

                {createStep === "templates" ? (
                  <>
                    {/* ── Template Picker ── */}
                    <div className="relative px-5 sm:px-7 pt-6 sm:pt-7 pb-4">
                      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent" />
                      <div className="relative">
                        <div className="flex items-center gap-2.5 mb-1.5">
                          <div className="h-8 w-8 rounded-xl bg-foreground/[0.06] dark:bg-foreground/[0.08] flex items-center justify-center">
                            <Users className="h-4 w-4 text-foreground/50" />
                          </div>
                          <h2 className="text-[16px] sm:text-[18px] font-bold text-foreground tracking-tight">{t("createTeam.title")}</h2>
                        </div>
                        <p className="text-[12px] sm:text-[13px] text-muted-foreground/50 pl-[42px]">{t("createTeam.subtitle")}</p>
                      </div>
                    </div>

                    <div className="px-5 sm:px-7 pb-5 sm:pb-6 max-h-[60vh] overflow-y-auto space-y-5 sm:space-y-7 scrollbar-thin">
                      {(["starter", "plus", "pro"] as const).map(tier => {
                        const meta = TIER_META[tier]
                        const TierIcon = meta.icon
                        const tierTemplates = TEAM_TEMPLATES.filter(tmpl => tmpl.tier === tier)
                        return (
                          <div key={tier}>
                            {/* Tier header — pill badge with details */}
                            <div className="flex items-center gap-2.5 mb-3">
                              <div className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] sm:text-[11px] font-bold uppercase tracking-wider shrink-0", meta.color, meta.badgeBg)}>
                                <TierIcon className="h-3 w-3" />
                                {t(meta.labelKey)}
                              </div>
                              <div className="h-px flex-1 bg-border/20" />
                              <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-muted-foreground/40 font-medium tabular-nums shrink-0">
                                <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md", meta.badgeBg, meta.color)}>
                                  {meta.machines} {meta.machines === 1 ? "machine" : "machines"}
                                </span>
                                <span>&middot;</span>
                                <span>{t(meta.employeesKey)}</span>
                                <span>&middot;</span>
                                <span className="font-semibold text-foreground/50">{t(meta.priceKey)}</span>
                              </div>
                              <span className={cn("sm:hidden text-[10px] font-semibold shrink-0", meta.color)}>
                                {t(meta.priceKey)}
                              </span>
                            </div>

                            {/* Template cards */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                              {tierTemplates.map(tmpl => {
                                const Icon = tmpl.icon
                                return (
                                  <button
                                    key={tmpl.id}
                                    onClick={() => pickTemplate(tmpl)}
                                    className="group relative text-left rounded-xl border border-border/30 bg-card/50 p-3.5 sm:p-4 overflow-hidden transition-all duration-200 hover:shadow-lg hover:scale-[1.01]"
                                    style={{ "--accent": meta.accentHex } as React.CSSProperties}
                                  >
                                    {/* Top accent line on hover */}
                                    <div className="absolute inset-x-0 top-0 h-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-300" style={{ background: `linear-gradient(to right, transparent, ${meta.accentHex}60, transparent)` }} />
                                    {/* Hover gradient wash */}
                                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" style={{ background: `linear-gradient(to bottom right, ${meta.accentHex}08, transparent)` }} />

                                    <div className="relative flex sm:block items-center gap-3 sm:gap-0">
                                      <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl flex items-center justify-center sm:mb-3 shrink-0 transition-all duration-200 bg-muted/60 group-hover:scale-110" style={{ ['--tw-group-hover-bg' as string]: `${meta.accentHex}15` }}>
                                        <Icon className="h-4 w-4 sm:h-[18px] sm:w-[18px] text-foreground/40 transition-colors duration-200 group-hover:text-foreground/70" />
                                      </div>
                                      <div className="min-w-0 flex-1 sm:flex-initial">
                                        <h3 className="text-[12px] sm:text-[13px] font-bold text-foreground/90 mb-0.5 leading-tight group-hover:text-foreground transition-colors">{t(tmpl.nameKey)}</h3>
                                        <p className="text-[10px] sm:text-[11px] text-muted-foreground/45 leading-relaxed line-clamp-1 sm:line-clamp-2">{t(tmpl.taglineKey)}</p>
                                        <div className="flex items-center gap-1.5 mt-2 sm:mt-3">
                                          <span className="text-[9px] sm:text-[10px] text-muted-foreground/30 font-semibold tabular-nums bg-muted/60 px-1.5 py-0.5 rounded-md">{t("employees", { count: tmpl.employees.length })}</span>
                                          <span className="text-[9px] sm:text-[10px] text-muted-foreground/30 font-semibold tabular-nums bg-muted/60 px-1.5 py-0.5 rounded-md">{tmpl.credentials.length} creds</span>
                                        </div>
                                      </div>
                                    </div>
                                    <ChevronRight className="absolute top-1/2 -translate-y-1/2 right-3 h-3.5 w-3.5 text-muted-foreground/15 group-hover:text-muted-foreground/50 group-hover:translate-x-0.5 transition-all" />
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {/* Footer — custom option */}
                    <div className="px-5 sm:px-7 py-3.5 sm:py-4 flex items-center justify-between border-t border-border/20 bg-muted/20">
                      <button onClick={resetCreateTeam} className="h-8 sm:h-9 px-3 sm:px-4 rounded-lg text-[12px] sm:text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all">
                        {t("cancel")}
                      </button>
                      <button
                        onClick={() => { setSelectedTemplate(null); setNewTeamName(""); setNewTeamInstructions(""); setCreateStep("form") }}
                        className="h-8 sm:h-9 px-4 sm:px-5 rounded-lg text-[12px] sm:text-[13px] font-medium text-foreground/70 hover:text-foreground border border-border/30 hover:border-border/50 hover:bg-muted/40 transition-all"
                      >
                        {t("createTeam.customTeam")}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {/* ── Form Step (template detail or custom) ── */}
                    <div className="relative px-4 sm:px-7 pt-5 sm:pt-6 pb-3 sm:pb-4">
                      <div className="relative">
                        <button
                          onClick={() => setCreateStep("templates")}
                          className="inline-flex items-center gap-1 text-[11px] sm:text-[12px] text-muted-foreground/50 hover:text-foreground/70 transition-colors mb-2 sm:mb-3"
                        >
                          <ArrowLeft className="h-3 w-3" />{t("createTeam.backToTemplates")}
                        </button>
                        {selectedTemplate ? (
                          <div className="flex items-start gap-3">
                            <div className="h-10 w-10 rounded-xl bg-foreground/[0.06] dark:bg-foreground/[0.08] flex items-center justify-center shrink-0">
                              {(() => { const Icon = selectedTemplate.icon; return <Icon className="h-4.5 w-4.5 text-foreground/60" /> })()}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <h2 className="text-[17px] font-semibold text-foreground tracking-tight">{t(selectedTemplate.nameKey)}</h2>
                                {(() => { const meta = TIER_META[selectedTemplate.tier]; const TierIcon = meta.icon; return (
                                  <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider", meta.color)}>
                                    <TierIcon className="h-3 w-3" />{t(meta.labelKey)}
                                  </span>
                                ) })()}
                              </div>
                              <p className="text-[12px] text-muted-foreground/50 mt-0.5">{t(selectedTemplate.descriptionKey)}</p>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="h-10 w-10 rounded-xl bg-foreground/[0.06] dark:bg-foreground/[0.08] flex items-center justify-center mb-3">
                              <Users className="h-4.5 w-4.5 text-foreground/60" />
                            </div>
                            <h2 className="text-[17px] font-semibold text-foreground tracking-tight">{t("createTeam.customTeam")}</h2>
                            <p className="text-[13px] text-muted-foreground/60 mt-1">{t("createTeam.customDescription")}</p>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Form fields */}
                    <div className="px-4 sm:px-7 pb-2 space-y-3 sm:space-y-4 max-h-[50vh] overflow-y-auto">
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-medium text-foreground/40 uppercase tracking-widest">{t("createTeam.teamNameLabel")}</label>
                        <input
                          type="text"
                          placeholder={t("createTeam.teamNamePlaceholder")}
                          value={newTeamName}
                          onChange={(e) => setNewTeamName(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleCreateTeam()}
                          autoFocus
                          className="w-full h-10 sm:h-11 rounded-lg sm:rounded-xl px-3 sm:px-4 text-[13px] sm:text-sm bg-muted/40 border border-border/40 text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-border transition-all"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-medium text-foreground/40 uppercase tracking-widest">{t("createTeam.guidelinesLabel")} <span className="text-muted-foreground/30 normal-case tracking-normal font-normal">{t("createTeam.optional")}</span></label>
                        <textarea
                          placeholder={t("createTeam.guidelinesPlaceholder")}
                          value={newTeamInstructions}
                          onChange={(e) => setNewTeamInstructions(e.target.value)}
                          rows={3}
                          className="w-full rounded-lg sm:rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 text-[13px] sm:text-sm resize-none bg-muted/40 border border-border/40 text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-border transition-all"
                        />
                      </div>

                      {/* Template details — employees & credentials */}
                      {selectedTemplate && (
                        <>
                          {/* Suggested employees */}
                          <div className="space-y-2">
                            <label className="text-[11px] font-medium text-foreground/40 uppercase tracking-widest flex items-center gap-1.5">
                              <AgentIcon className="h-3 w-3" />{t("createTeam.suggestedEmployees")}
                            </label>
                            <div className="space-y-1">
                              {selectedTemplate.employees.map((emp, i) => (
                                <div key={i} className="flex items-start gap-3 rounded-lg bg-muted/30 border border-border/20 px-3 py-2.5">
                                  <div className="h-6 w-6 rounded-md bg-foreground/[0.05] flex items-center justify-center shrink-0 mt-0.5">
                                    <span className="text-[10px] font-bold text-foreground/30">{emp.name.charAt(0)}</span>
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-[12px] font-semibold text-foreground/80">{emp.name}</span>
                                      <span className="text-[10px] text-muted-foreground/35 font-medium bg-muted/60 px-1.5 py-0.5 rounded">{formatFrequency(emp.frequency)}</span>
                                    </div>
                                    <p className="text-[11px] text-muted-foreground/45 leading-relaxed mt-0.5">{t(emp.roleKey)}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Required credentials (template) */}
                          <div className="space-y-2">
                            <label className="text-[11px] font-medium text-foreground/40 uppercase tracking-widest flex items-center gap-1.5">
                              <Key className="h-3 w-3" />{t("createTeam.suggestedCredentials")}
                            </label>
                            <div className="rounded-xl border border-border/30 overflow-hidden divide-y divide-border/20">
                              {selectedTemplate.credentials.map((cred, i) => {
                                const isAdded = addedCredentials.has(cred.service)
                                return (
                                  <div key={i} className="flex items-center gap-3 px-3 py-2.5 bg-card/30">
                                    <div className={cn(
                                      "h-6 w-6 rounded-md flex items-center justify-center shrink-0 transition-colors",
                                      isAdded ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-muted/60"
                                    )}>
                                      {isAdded
                                        ? <ShieldCheck className="h-3 w-3 text-emerald-500" />
                                        : <Globe className="h-3 w-3 text-muted-foreground/40" />
                                      }
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <span className={cn("text-[12px] font-medium", isAdded ? "text-foreground/50 line-through decoration-foreground/15" : "text-foreground/70")}>{cred.service}</span>
                                      <p className="text-[10px] text-muted-foreground/40 leading-snug">{t(cred.purposeKey)}</p>
                                    </div>
                                    {isAdded ? (
                                      <span className="text-[10px] font-medium text-emerald-500 shrink-0">{t("createTeam.added")}</span>
                                    ) : (
                                      <button
                                        onClick={() => { setCredDialogService(cred.service); setCredDialogOpen(true) }}
                                        className="text-[10px] font-semibold text-foreground/50 hover:text-foreground bg-muted/60 hover:bg-muted px-2.5 py-1 rounded-md transition-all shrink-0"
                                      >
                                        {t("createTeam.addButton")}
                                      </button>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        </>
                      )}

                      {/* Custom credentials — always visible */}
                      <div className="space-y-2">
                        <label className="text-[11px] font-medium text-foreground/40 uppercase tracking-widest flex items-center gap-1.5">
                          <Key className="h-3 w-3" />{selectedTemplate ? t("createTeam.suggestedCredentials") : t("createTeam.credentials")}
                        </label>

                        {customCredentials.length > 0 && (
                          <div className="rounded-xl border border-border/30 overflow-hidden divide-y divide-border/20">
                            {customCredentials.map((cred, i) => (
                              <div key={i} className="flex items-center gap-3 px-3 py-2.5 bg-card/30">
                                <div className="h-6 w-6 rounded-md bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                                  <ShieldCheck className="h-3 w-3 text-emerald-500" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <span className="text-[12px] font-medium text-foreground/70">{cred.service}</span>
                                  <p className="text-[10px] text-muted-foreground/40">{cred.name}</p>
                                </div>
                                <button
                                  onClick={() => setCustomCredentials(prev => prev.filter((_, j) => j !== i))}
                                  className="text-[10px] font-medium text-muted-foreground/30 hover:text-red-500 transition-colors shrink-0"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        <button
                          onClick={() => { setCredDialogService(""); setCredDialogOpen(true) }}
                          className="w-full flex items-center justify-center gap-1.5 h-9 rounded-xl border border-dashed border-border/40 text-[12px] font-medium text-muted-foreground/50 hover:text-foreground/70 hover:border-border/60 hover:bg-muted/40 transition-all"
                        >
                          <Plus className="h-3 w-3" />{t("createTeam.addCredential")}
                        </button>

                        <p className="text-[10px] text-muted-foreground/30 flex items-center gap-1">
                          <ShieldCheck className="h-3 w-3" />{t("createTeam.credentialHint")}
                        </p>
                      </div>

                      {/* Inline credential dialog */}
                      <SecretDialog
                        open={credDialogOpen}
                        onOpenChange={setCredDialogOpen}
                        initialService={credDialogService}
                        onSaved={(info) => {
                          if (credDialogService) {
                            // Template credential — mark as added
                            setAddedCredentials(prev => new Set(prev).add(credDialogService))
                          } else if (info) {
                            // Custom credential — track it
                            setCustomCredentials(prev => [...prev, { service: info.service, name: info.name }])
                          }
                          setCredDialogOpen(false)
                        }}
                      />
                    </div>

                    {/* Limit error banner */}
                    {limitError && (
                      <div className="mx-4 sm:mx-7 mb-2 rounded-lg sm:rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/30 p-3 sm:p-4">
                        <p className="text-[11px] sm:text-[12px] font-medium text-amber-800 dark:text-amber-300 mb-2">{limitError.message}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href="/billing"
                            className="inline-flex items-center gap-1.5 h-8 px-4 rounded-lg text-[12px] font-semibold bg-amber-600 hover:bg-amber-700 text-white transition-colors"
                          >
                            <TrendingUp className="h-3 w-3" />{t("limits.upgradePlan")}
                          </Link>
                          {limitError.needsMachines ? (
                            <Link
                              href="/machines"
                              onClick={() => resetCreateTeam()}
                              className="inline-flex items-center gap-1.5 h-8 px-4 rounded-lg text-[12px] font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
                            >
                              <Cpu className="h-3 w-3" />{t("limits.manageMachines")}
                            </Link>
                          ) : (
                            <button
                              onClick={() => { resetCreateTeam(); setActiveTab("employees") }}
                              className="inline-flex items-center gap-1.5 h-8 px-4 rounded-lg text-[12px] font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
                            >
                              <AgentIcon className="h-3 w-3" />{t("limits.manageEmployees")}
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Provisioning progress */}
                    {provisioning && (
                      <div className="mx-4 sm:mx-7 mb-2 rounded-lg sm:rounded-xl border border-border/30 bg-muted/30 p-3 sm:p-4">
                        <div className="flex items-center gap-3">
                          <div className="relative h-5 w-5 shrink-0">
                            <div className="absolute inset-0 rounded-full border-2 border-foreground/[0.08]" />
                            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-foreground/60 animate-spin" />
                          </div>
                          <p className="text-[12px] font-medium text-foreground/70">{provisionStatus}</p>
                        </div>
                      </div>
                    )}

                    {/* Footer */}
                    <div className="px-4 sm:px-7 py-4 sm:py-5 flex items-center justify-end gap-2 sm:gap-2.5 border-t border-border/20 bg-muted/20">
                      <button onClick={resetCreateTeam} disabled={provisioning} className="h-8 sm:h-9 px-3 sm:px-4 rounded-lg text-[12px] sm:text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all disabled:opacity-40">
                        {t("cancel")}
                      </button>
                      <button
                        onClick={handleCreateTeam}
                        disabled={!newTeamName.trim() || provisioning}
                        className={cn(
                          "h-8 sm:h-9 px-4 sm:px-5 rounded-lg text-[12px] sm:text-[13px] font-semibold transition-all",
                          newTeamName.trim() && !provisioning
                            ? "text-foreground bg-muted hover:bg-muted/80 ring-1 ring-border/50 shadow-sm"
                            : "text-muted-foreground/40 bg-muted/60 cursor-not-allowed"
                        )}
                      >
                        {provisioning ? t("createTeam.settingUp") : selectedTemplate ? t("createTeam.createEmployees", { count: selectedTemplate.employees.length }) : t("createTeam.createTeamButton")}
                      </button>
                    </div>
                  </>
                )}
              </DialogContent>
            </Dialog>

            {/* No teams yet — simple prompt */}
            {teams.length === 0 && (
              <div className="rounded-2xl border border-border/30 bg-card/50 backdrop-blur-sm py-14 text-center">
                <Users className="h-8 w-8 text-muted-foreground/20 mx-auto mb-3" />
                <p className="text-sm font-medium text-foreground/70 mb-1">{t("noTeams.title")}</p>
                <p className="text-xs text-muted-foreground/50 max-w-xs mx-auto mb-5">
                  {t("noTeams.description")}
                </p>
                <button onClick={() => setShowCreateTeam(true)} className={cn("inline-flex items-center gap-2 h-9 px-5 rounded-xl text-sm font-medium transition-all text-foreground bg-muted hover:bg-muted/80 ring-1 ring-border/50 shadow-sm")}>
                  <Plus className="h-3.5 w-3.5" />{t("noTeams.newTeam")}
                </button>
              </div>
            )}

            {/* Org chart */}
            {teams.length > 0 && (
              <>
                {/* Inactive employees warning */}
                {(() => {
                  const inactiveInTeams = schedules.filter(s => {
                    const inTeam = teams.some(tm => tm.members.some(m => m.chat_id === s.chat_id))
                    return inTeam && (!s.enabled || s.paused_reason)
                  })
                  if (inactiveInTeams.length === 0) return null
                  const noMachine = inactiveInTeams.filter(s => !s.machine_id || s.paused_reason === "machine_unavailable")
                  return (
                    <div className={cn(
                      "relative overflow-hidden rounded-xl sm:rounded-2xl",
                      "bg-gradient-to-r from-amber-50 via-amber-50/80 to-orange-50/60",
                      "dark:from-amber-950/30 dark:via-amber-950/20 dark:to-orange-950/10",
                      "border border-amber-200/60 dark:border-amber-800/30",
                      "shadow-[0_1px_3px_rgba(245,158,11,0.08)] dark:shadow-none",
                    )}>
                      {/* Subtle top accent line */}
                      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/50 to-transparent" />

                      <div className="relative flex items-center gap-3 sm:gap-3.5 px-3.5 sm:px-5 py-3 sm:py-3.5">
                        {/* Icon container */}
                        <div className={cn(
                          "flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg sm:rounded-xl",
                          "bg-gradient-to-br from-amber-100 to-amber-50 dark:from-amber-900/40 dark:to-amber-900/20",
                          "ring-1 ring-amber-200/80 dark:ring-amber-700/40",
                          "shadow-sm dark:shadow-none",
                        )}>
                          <AlertTriangle className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-amber-500 dark:text-amber-400" />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-4">
                          <div>
                            <p className="text-[12px] sm:text-[13px] font-semibold text-amber-900 dark:text-amber-200 leading-snug">
                              {t("inactive.title", { count: inactiveInTeams.length })}
                            </p>
                            <p className="text-[10px] sm:text-[11px] text-amber-700/70 dark:text-amber-400/60 mt-0.5 leading-relaxed">
                              {noMachine.length > 0
                                ? t("inactive.missingMachine", { count: noMachine.length })
                                : t("inactive.wontRun")}
                            </p>
                          </div>

                          <button
                            onClick={() => setActiveTab("employees")}
                            className={cn(
                              "inline-flex items-center gap-1.5 shrink-0",
                              "text-[10px] sm:text-[11px] font-semibold",
                              "text-amber-700 dark:text-amber-300",
                              "bg-amber-100/80 dark:bg-amber-800/30",
                              "hover:bg-amber-200/80 dark:hover:bg-amber-800/50",
                              "border border-amber-200/60 dark:border-amber-700/40",
                              "rounded-lg px-2.5 sm:px-3 py-1.5",
                              "transition-all duration-200",
                              "shadow-sm dark:shadow-none",
                            )}
                          >
                            {t("inactive.fixInEmployees")}
                            <ChevronRight className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })()}

                <div className="flex items-center justify-between">
                  <p className="text-[11px] sm:text-xs text-muted-foreground/50">{t("dragHint")}</p>
                  <button onClick={() => setShowCreateTeam(true)} className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                    <Plus className="h-3 w-3" />{t("noTeams.newTeam")}
                  </button>
                </div>
                <div className="relative rounded-xl sm:rounded-2xl border border-border/30 bg-card/50 backdrop-blur-sm p-4 sm:p-6 md:p-10 overflow-x-auto">
                  <div className="relative">
                    <OrgChart teams={teams} schedules={schedules} onRefresh={refreshAll} onEdit={setEditChatId} />
                  </div>

                  {/* How it works — bottom-left corner (hidden on very small screens) */}
                  <div className="hidden sm:block absolute bottom-4 left-4 md:bottom-5 md:left-5 z-10 max-w-[190px]">
                    <div className="space-y-1.5 text-[9px] sm:text-[10px] leading-relaxed text-muted-foreground/35">
                      <p className="text-[8px] sm:text-[9px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/25 mb-1">{t("howItWorks.title")}</p>
                      <div className="flex items-start gap-1.5">
                        <div className="h-3.5 w-3.5 rounded-[4px] bg-muted/60 flex items-center justify-center shrink-0 mt-px">
                          <GripVertical className="h-2 w-2 text-muted-foreground/30" />
                        </div>
                        <span>{t("howItWorks.dragEmployees")}</span>
                      </div>
                      <div className="flex items-start gap-1.5">
                        <div className="h-3.5 w-3.5 rounded-[4px] bg-muted/60 flex items-center justify-center shrink-0 mt-px">
                          <Pencil className="h-2 w-2 text-muted-foreground/30" />
                        </div>
                        <span>{t("howItWorks.clickToEdit")}</span>
                      </div>
                      <div className="flex items-start gap-1.5">
                        <div className="h-3.5 w-3.5 rounded-[4px] bg-muted/60 flex items-center justify-center shrink-0 mt-px">
                          <Users className="h-2 w-2 text-muted-foreground/30" />
                        </div>
                        <span>{t("howItWorks.teamsShare")}</span>
                      </div>
                      <div className="flex items-start gap-1.5">
                        <div className="h-3.5 w-3.5 rounded-[4px] bg-muted/60 flex items-center justify-center shrink-0 mt-px">
                          <Activity className="h-2 w-2 text-muted-foreground/30" />
                        </div>
                        <span>{t("howItWorks.dashedLines")}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ═══ EMPLOYEES TAB ═══ */}
        {schedules.length > 0 && activeTab === "employees" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.35 }}
          >
            {/* Filters */}
            <div className="flex items-center gap-1 mb-5">
              {[
                { id: "all", label: t("filters.all"), count: schedules.length },
                { id: "active", label: t("filters.onDuty"), count: activeCount },
                { id: "paused", label: t("filters.standby"), count: pausedCount },
              ].map((f) => (
                <button key={f.id} onClick={() => setStatusFilter(f.id)} className={cn(
                  "relative h-8 px-3 text-[13px] font-medium transition-all duration-200",
                  statusFilter === f.id ? "text-foreground" : "text-muted-foreground/40 hover:text-muted-foreground",
                )}>
                  {f.label}
                  <span className={cn("ml-1 text-[11px] tabular-nums", statusFilter === f.id ? "text-muted-foreground/50" : "text-muted-foreground/20")}>{f.count}</span>
                  {statusFilter === f.id && (
                    <motion.div layoutId="emp-filter" className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-foreground/40" transition={{ type: "spring", stiffness: 400, damping: 30 }} />
                  )}
                </button>
              ))}
            </div>

            {/* 2-column layout: left = calendar (employees inside), right = activity */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] xl:grid-cols-[1fr_340px] gap-6">

              {/* ── Left column: Calendar with interactive employee rows ── */}
              <div className="min-w-0">
                <ScheduleCalendar
                  schedules={filteredSchedules}
                  selectedDate={selectedDate}
                  onSelectDate={setSelectedDate}
                  onRun={async (chatId) => { trackScheduleTriggered(chatId); await triggerScheduleNow(chatId); loadSchedules() }}
                  onPause={async (chatId) => { await pauseSchedule(chatId); loadSchedules() }}
                  onEdit={setEditChatId}
                />

                {/* Empty state */}
                {filteredSchedules.length === 0 && (
                  <div className="flex flex-col items-center py-12">
                    <AgentIcon className="h-6 w-6 text-muted-foreground/10 mb-2" />
                    <p className="text-[13px] text-muted-foreground/25">{t("noMatch")}</p>
                  </div>
                )}
              </div>

              {/* ── Right column: Activity ── */}
              <div className="min-w-0 lg:border-l lg:border-border/15 lg:pl-6">
                <p className="text-[11px] font-medium text-muted-foreground/30 uppercase tracking-widest mb-2">{t("recentActivity")}</p>
                <ScheduleHistory chatId={showHistory ? historyChat : undefined} limit={10} />
              </div>
            </div>
          </motion.div>
        )}
      </div>

      <CreateScheduleDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} machines={machines} onScheduleCreated={() => { setShowCreateDialog(false); loadSchedules() }} />
      {editChatId && (
        <ScheduleDialog open={!!editChatId} onOpenChange={(open) => { if (!open) setEditChatId(null) }} chatId={editChatId} chatTitle={schedules.find((s) => s.chat_id === editChatId)?.title ?? undefined} machines={machines} defaultMachineId={schedules.find((s) => s.chat_id === editChatId)?.machine_id} onScheduleCreated={() => { setEditChatId(null); loadSchedules() }} onScheduleDeleted={() => { setEditChatId(null); loadSchedules() }} />
      )}
    </div>
    </PageLoader>
  )
}
