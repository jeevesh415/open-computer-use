"use client"

import { ChatInput } from "@/app/components/chat-input/chat-input"
import { Conversation } from "@/app/components/chat/conversation"
import { ToolInvocation } from "@/app/components/chat/tool-invocation"
import { useChatDraft } from "@/app/hooks/use-chat-draft"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useMessages } from "@/lib/chat-store/messages/provider"
import { useChatSession } from "@/lib/chat-store/session/provider"
import { MODEL_DEFAULT } from "@/lib/config"
import { SystemPrompts } from "@/lib/prompts/system-prompts"
import { useUserPreferences } from "@/lib/user-preference-store/provider"
import { useUser } from "@/lib/user-store/provider"
import { cn } from "@/lib/utils"
import type { Message } from "@ai-sdk/react"
import { AnimatePresence, motion } from "motion/react"
import { Caveat } from "next/font/google"
import dynamic from "next/dynamic"
import { redirect } from "next/navigation"
import React, { useEffect, useMemo, useState, useRef, useCallback } from "react"
import { createPortal } from "react-dom"
import { useTranslations } from "next-intl"
import { useChatCore } from "./use-chat-core"
import { InsufficientCreditsModal } from "@/app/components/credits/insufficient-credits-modal"
import { useChatOperations } from "./use-chat-operations"
import { useVMFileUpload } from "./use-vm-file-upload"
import { Card } from "@/components/ui/card"
import { useProjectNavigator } from "@/lib/project-navigator-store/provider"
import { useChatStreaming } from "@/lib/chat-streaming-store/provider"
// import { ResearchSuggestions } from "./research-suggestions" // Removed trending searches
import { themeConfig } from "@/lib/theme-config"
import { QuickStartGuide } from "./quick-start-guide"
import { Search, Bug, Globe, FileText, BarChart3, Mail, Zap, Sparkles, PenTool, MonitorSmartphone, Clipboard, Users, TrendingUp, Eye, FileCode, LayoutGrid, Send, ShoppingCart, MessageCircle, Bot } from "lucide-react"
import { SwarmPanel } from "./swarm-panel"
import { CinematicIntro, TaglineIntro } from "./cinematic-intro"
import { useIntroStore } from "@/lib/intro-store"
import { ActiveSwarmBanner, type ActiveSwarm } from "./active-swarm-banner"
import { RemoteApproval } from "./remote-approval"

// ── Task templates by role & use-case (activation metric: first task < 5 min) ──
// Templates use {url} and {company} tokens — replaced at runtime with onboarding data.
// Every template references both so suggestions always feel personal.
// Labels are added at runtime via useTranslations (hooks cannot be called at module level).
type TaskTemplate = { label: string; prompt: string; icon: React.ComponentType<any>; color: string }
type TaskTemplateData = { labelKey: string; prompt: string; icon: React.ComponentType<any>; color: string }

const ROLE_TEMPLATE_DATA: Record<string, TaskTemplateData[]> = {
  founder: [
    { labelKey: "competitorReport", prompt: "Find the top 5 competitors of {company}. Go to each of their websites and {url}. Compare pricing, features, positioning, and traffic estimates. Deliver a side-by-side spreadsheet I can share with my team.", icon: Search, color: "blue" },
    { labelKey: "warmLeads", prompt: "Search LinkedIn for 20 decision-makers who match {company}'s ideal customer profile. For each, grab their name, title, company, profile URL, and a personalized one-liner referencing {url}. Export as a CSV ready for outreach.", icon: Users, color: "emerald" },
    { labelKey: "pitchDeck", prompt: "Research {company}'s market, competitors, and traction visible on {url}. Draft a 10-slide investor pitch deck outline with key stats, market size, competitive advantages, and a growth narrative.", icon: FileText, color: "violet" },
  ],
  developer: [
    { labelKey: "findBugs", prompt: "Go to {url} and run through every user flow for {company} — signup, login, onboarding, core features, settings, and logout. Screenshot each step, flag any bugs, broken links, or UI glitches, and deliver a prioritized bug report.", icon: Bug, color: "rose" },
    { labelKey: "performance", prompt: "Audit {url} for {company} — check page load speed, Core Web Vitals, broken links, SEO meta tags, and accessibility issues. Deliver a scored report with specific fixes ranked by impact.", icon: TrendingUp, color: "emerald" },
    { labelKey: "apiDocs", prompt: "Go to {url}/docs and extract every API endpoint, method, parameter, and response example for {company}. Organize into a structured JSON file I can import into Postman.", icon: FileCode, color: "blue" },
  ],
  marketer: [
    { labelKey: "seoGap", prompt: "Search Google for the top 20 keywords {company} should rank for. Check where {url} appears for each. Identify the top 10 content gaps and suggest article titles that would close them.", icon: TrendingUp, color: "emerald" },
    { labelKey: "competitorAds", prompt: "Find {company}'s top 3 competitors. Visit their websites, screenshot their landing pages, pricing pages, and any visible ads. Deliver a messaging teardown comparing their strategy to {url}.", icon: Eye, color: "blue" },
    { labelKey: "trendingContent", prompt: "Search Google, Reddit, Twitter, and Hacker News for what's trending in {company}'s niche right now. Deliver 10 content ideas with hooks, angles, and how each ties back to {url}.", icon: Sparkles, color: "violet" },
  ],
  product_manager: [
    { labelKey: "reviewSummary", prompt: "Search G2, Capterra, Product Hunt, and Reddit for every review of {company} from the last 3 months. Categorize into praise, complaints, and feature requests. Deliver a summary with quotes and links, cross-referenced with {url}.", icon: MessageCircle, color: "emerald" },
    { labelKey: "featureComparison", prompt: "Find {company}'s top 3 competitors. Research their features, pricing, and integrations. Deliver a feature comparison matrix showing where {url} wins, loses, and has gaps.", icon: LayoutGrid, color: "blue" },
    { labelKey: "competitorLaunches", prompt: "Find the changelogs, blogs, and release notes of {company}'s top 3 competitors. Summarize everything they shipped in the past month and flag anything that threatens or validates what's on {url}.", icon: FileText, color: "violet" },
  ],
  data_analyst: [
    { labelKey: "exportCsv", prompt: "Go to {url} and extract all structured data from {company}'s pages — products, pricing, categories, metadata. Clean it up and deliver as a well-formatted CSV file.", icon: FileText, color: "blue" },
    { labelKey: "marketSizing", prompt: "Research the total addressable market for {company}'s industry. Find market size, growth rate, key players, and trends. Deliver a report with sources that I can reference alongside {url}.", icon: BarChart3, color: "emerald" },
    { labelKey: "benchmark", prompt: "Research industry benchmarks for companies like {company} — traffic, conversion rates, engagement, churn. Compare against what's visible on {url} and flag where we're above or below average.", icon: TrendingUp, color: "amber" },
  ],
  operations: [
    { labelKey: "enterRecords", prompt: "Go to {url} and enter the following records into {company}'s system. Confirm each entry was saved successfully and flag any errors: [paste your data or describe the source].", icon: Clipboard, color: "blue" },
    { labelKey: "cheapestVendor", prompt: "Search for the top 5 vendors that {company} could use for [service/product]. Compare pricing, reviews, and terms. Deliver a recommendation with the best deal, cross-referenced with any vendor links on {url}.", icon: ShoppingCart, color: "emerald" },
    { labelKey: "invoiceSummary", prompt: "Go to {company}'s email or billing portal and download all invoices from the past month. Extract vendor names, amounts, due dates, and payment status into a spreadsheet. Cross-reference with {url}.", icon: FileText, color: "violet" },
  ],
  designer: [
    { labelKey: "designComparison", prompt: "Find {company}'s top 3 competitors. Take full-page screenshots of their homepage, pricing, and dashboard. Put them side-by-side with {url} and write up what they do better and worse.", icon: Eye, color: "violet" },
    { labelKey: "responsiveAudit", prompt: "Go to {url} and test {company}'s site at mobile (375px), tablet (768px), and desktop (1440px). Screenshot each breakpoint, flag every layout issue, and deliver a fix-priority list.", icon: MonitorSmartphone, color: "blue" },
    { labelKey: "inspiration", prompt: "Search Dribbble, Behance, and Awwwards for the best designs in {company}'s industry. Save the top 10 screenshots with notes on what ideas could improve {url}.", icon: PenTool, color: "rose" },
  ],
}

const USE_CASE_TEMPLATE_DATA: Record<string, TaskTemplateData[]> = {
  web_scraping: [
    { labelKey: "web_scraping", prompt: "Go to {url} and extract all products, prices, descriptions, and metadata from {company}'s pages. Clean it up and deliver as a formatted CSV file.", icon: Globe, color: "blue" },
  ],
  browser_automation: [
    { labelKey: "browser_automation", prompt: "Go to {url}, log in to {company}'s platform with my saved credentials, navigate to the reports section, and export all available reports. Save them organized by date.", icon: Zap, color: "amber" },
  ],
  data_entry: [
    { labelKey: "data_entry", prompt: "Go to {url} and enter these records into {company}'s system one by one. Confirm each entry saved successfully and flag any that failed: [paste data].", icon: Clipboard, color: "emerald" },
  ],
  email_outreach: [
    { labelKey: "email_outreach", prompt: "Go to my email and send personalized outreach messages on behalf of {company} to the contacts below. Each email should mention {url} and use this template: [your template]. Confirm each was sent.", icon: Send, color: "violet" },
  ],
  testing: [
    { labelKey: "testing", prompt: "Go to {url} and test every core flow for {company} — signup, login, main features, settings, and logout. Screenshot each step, flag every bug, and deliver a prioritized QA report.", icon: Bug, color: "rose" },
  ],
  ecommerce: [
    { labelKey: "ecommerce", prompt: "Find the top 5 competitors of {company}. Check their product pricing, promotions, and availability. Deliver a comparison spreadsheet showing how {url}'s prices stack up.", icon: ShoppingCart, color: "amber" },
  ],
  social_media: [
    { labelKey: "social_media", prompt: "Log in to Twitter/X and craft a compelling post about {company} with a link to {url}. Post it, monitor replies for 5 minutes, and engage with every response to boost visibility.", icon: MessageCircle, color: "blue" },
  ],
  general_automation: [
    { labelKey: "general_automation", prompt: "Go to {url} and complete the following task for {company}: [describe what you need done and what the end result should look like].", icon: Bot, color: "violet" },
  ],
}

const TASK_COLORS: Record<string, { icon: string; iconBg: string }> = {
  blue: {
    icon: "text-blue-600 dark:text-blue-300",
    iconBg: "bg-gradient-to-b from-blue-500/[0.16] to-blue-500/[0.06] dark:from-blue-400/[0.22] dark:to-blue-400/[0.08]",
  },
  violet: {
    icon: "text-violet-600 dark:text-violet-300",
    iconBg: "bg-gradient-to-b from-violet-500/[0.16] to-violet-500/[0.06] dark:from-violet-400/[0.22] dark:to-violet-400/[0.08]",
  },
  emerald: {
    icon: "text-emerald-600 dark:text-emerald-300",
    iconBg: "bg-gradient-to-b from-emerald-500/[0.16] to-emerald-500/[0.06] dark:from-emerald-400/[0.22] dark:to-emerald-400/[0.08]",
  },
  rose: {
    icon: "text-rose-600 dark:text-rose-300",
    iconBg: "bg-gradient-to-b from-rose-500/[0.16] to-rose-500/[0.06] dark:from-rose-400/[0.22] dark:to-rose-400/[0.08]",
  },
  amber: {
    icon: "text-amber-600 dark:text-amber-300",
    iconBg: "bg-gradient-to-b from-amber-500/[0.16] to-amber-500/[0.06] dark:from-amber-400/[0.22] dark:to-amber-400/[0.08]",
  },
}


// ── Task hover visual components ─────────────────────────────────────
// Animated mini-previews shown on hover, matching the sidebar pattern

function TaskVisualSearch() {
  const results = [
    { title: "Competitor A", w: "w-14", delay: "0s" },
    { title: "Competitor B", w: "w-18", delay: "0.08s" },
    { title: "Competitor C", w: "w-12", delay: "0.16s" },
    { title: "Pricing data", w: "w-16", delay: "0.24s" },
  ]
  return (
    <div className="w-full h-full flex flex-col px-3 py-2 gap-1">
      {/* Search bar */}
      <div className="thv-row flex items-center gap-1.5 px-2 py-[4px] rounded border border-foreground/10 bg-foreground/[0.03]" style={{ animationDelay: "0s" }}>
        <svg width="7" height="7" viewBox="0 0 16 16" className="text-foreground/25 shrink-0">
          <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" fill="none" />
          <path d="M10 10l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <div className="flex items-center gap-[1px]">
          {Array.from("competitors").map((c, i) => (
            <span key={i} className="text-[5px] text-foreground/35 font-mono thv-type-char" style={{ animationDelay: `${0.2 + i * 0.03}s` }}>{c}</span>
          ))}
        </div>
      </div>
      {/* Results */}
      {results.map((r, i) => (
        <div key={i} className="thv-row flex items-center gap-2 px-2 py-[4px] rounded border border-foreground/8" style={{ animationDelay: `${0.5 + i * 0.1}s` }}>
          <div className="w-[14px] h-[14px] rounded bg-foreground/[0.06] border border-foreground/10 shrink-0" />
          <div className="flex-1 flex flex-col gap-[2px]">
            <div className={cn("h-[4px] rounded-full bg-foreground/15", r.w)} />
            <div className="h-[2px] w-20 rounded-full bg-foreground/8" />
          </div>
        </div>
      ))}
      {/* Export row */}
      <div className="flex items-center gap-1.5 self-center mt-0.5 thv-fade-up" style={{ animationDelay: "1s" }}>
        <div className="px-2 py-[2px] rounded-full border border-foreground/15 bg-foreground/[0.04] text-[5px] font-bold text-foreground/30 tracking-widest">EXPORT CSV</div>
      </div>
    </div>
  )
}

function TaskVisualBrowse() {
  return (
    <div className="w-full h-full flex flex-col px-3 py-2 gap-1.5">
      {/* Browser chrome */}
      <div className="thv-row flex flex-col rounded border border-foreground/10 overflow-hidden flex-1" style={{ animationDelay: "0s" }}>
        {/* Tab bar */}
        <div className="flex items-center gap-1 px-1.5 py-[3px] border-b border-foreground/8 bg-foreground/[0.03]">
          <div className="w-1 h-1 rounded-full bg-foreground/20" />
          <div className="w-1 h-1 rounded-full bg-foreground/20" />
          <div className="w-1 h-1 rounded-full bg-foreground/20" />
          <div className="ml-1 h-[3px] w-16 rounded-full bg-foreground/10" />
        </div>
        {/* Page content loading */}
        <div className="flex-1 p-2 flex flex-col gap-1.5">
          <div className="h-[5px] w-3/4 rounded-full bg-foreground/12 thv-row" style={{ animationDelay: "0.2s" }} />
          <div className="h-[3px] w-full rounded-full bg-foreground/8 thv-row" style={{ animationDelay: "0.3s" }} />
          <div className="h-[3px] w-5/6 rounded-full bg-foreground/8 thv-row" style={{ animationDelay: "0.4s" }} />
          <div className="h-8 w-full rounded bg-foreground/[0.04] border border-foreground/8 mt-1 thv-row" style={{ animationDelay: "0.5s" }} />
        </div>
      </div>
      {/* Click indicator */}
      <div className="flex items-center gap-2 thv-fade-up" style={{ animationDelay: "0.7s" }}>
        <svg width="8" height="8" viewBox="0 0 16 16" className="text-foreground/25">
          <path d="M4 1v10l3-3h6" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round" />
        </svg>
        <div className="flex-1 h-px bg-foreground/10" />
        <span className="text-[5px] font-bold text-foreground/25 tracking-widest">SCREENSHOT</span>
      </div>
    </div>
  )
}

function TaskVisualData() {
  const rows = [
    { cells: ["w-8", "w-6", "w-10"], delay: "0.2s" },
    { cells: ["w-10", "w-8", "w-6"], delay: "0.3s" },
    { cells: ["w-6", "w-10", "w-8"], delay: "0.4s" },
    { cells: ["w-8", "w-8", "w-10"], delay: "0.5s" },
  ]
  return (
    <div className="w-full h-full flex flex-col px-3 py-2 gap-1">
      {/* Table header */}
      <div className="thv-row flex items-center gap-3 px-1.5 py-[3px] border-b border-foreground/12" style={{ animationDelay: "0.1s" }}>
        <div className="h-[3px] w-8 rounded-full bg-foreground/20" />
        <div className="h-[3px] w-6 rounded-full bg-foreground/20" />
        <div className="h-[3px] w-10 rounded-full bg-foreground/20" />
      </div>
      {/* Rows filling in */}
      {rows.map((r, i) => (
        <div key={i} className="thv-row flex items-center gap-3 px-1.5 py-[3px]" style={{ animationDelay: r.delay }}>
          {r.cells.map((w, j) => (
            <div key={j} className={cn("h-[3px] rounded-full bg-foreground/10", w)} />
          ))}
        </div>
      ))}
      {/* Progress bar */}
      <div className="mt-auto flex items-center gap-1.5 thv-fade-up" style={{ animationDelay: "0.8s" }}>
        <div className="flex-1 h-[3px] bg-foreground/[0.06] rounded-full overflow-hidden">
          <div className="h-full bg-foreground/20 rounded-full thv-progress" style={{ ["--progress" as string]: "75%", animationDelay: "0.9s" }} />
        </div>
        <span className="text-[5px] font-bold text-foreground/25 tracking-wider">75%</span>
      </div>
    </div>
  )
}

function TaskVisualAutomate() {
  const steps = [
    { label: "Navigate", done: true, delay: "0.1s" },
    { label: "Fill form", active: true, delay: "0.3s" },
    { label: "Submit", upcoming: true, delay: "0.5s" },
  ]
  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-3 py-2 gap-2">
      {/* Steps */}
      <div className="flex items-center gap-1 w-full">
        {steps.map((s, i) => (
          <React.Fragment key={i}>
            <div
              className={cn(
                "thv-row flex-1 flex flex-col items-center gap-1 px-1 py-1.5 rounded border",
                s.done && "border-foreground/15 bg-foreground/[0.05]",
                s.active && "border-foreground/20 bg-foreground/[0.07]",
                s.upcoming && "border-dashed border-foreground/10",
              )}
              style={{ animationDelay: s.delay }}
            >
              <div className={cn(
                "w-3 h-3 rounded-full border flex items-center justify-center",
                s.done && "border-foreground/25 bg-foreground/10",
                s.active && "border-foreground/30 bg-foreground/[0.08] thv-pulse-dot",
                s.upcoming && "border-foreground/10",
              )}>
                {s.done && <svg width="5" height="5" viewBox="0 0 10 10"><path d="M2 5.5L4 7.5L8 3" stroke="currentColor" strokeWidth="1.5" fill="none" className="text-foreground/50" /></svg>}
                {s.active && <div className="w-1 h-1 rounded-full bg-foreground/40" />}
              </div>
              <span className={cn("text-[5px] font-bold tracking-wide", s.upcoming ? "text-foreground/20" : "text-foreground/35")}>{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className="w-3 h-px bg-foreground/10 shrink-0" />
            )}
          </React.Fragment>
        ))}
      </div>
      {/* Active indicator */}
      <div className="flex items-center gap-1.5 thv-fade-up" style={{ animationDelay: "0.7s" }}>
        <div className="w-1.5 h-1.5 rounded-full bg-foreground/30 thv-pulse-dot" />
        <span className="text-[5px] font-semibold text-foreground/25 tracking-widest">RUNNING</span>
      </div>
    </div>
  )
}

// Map task labels to their visual component
function getTaskVisual(label: string): React.FC {
  const l = label.toLowerCase()
  if (l.includes("competitor") || l.includes("lead") || l.includes("seo") || l.includes("review") || l.includes("comparison") || l.includes("benchmark") || l.includes("vendor") || l.includes("pricing")) return TaskVisualSearch
  if (l.includes("bug") || l.includes("performance") || l.includes("audit") || l.includes("responsive") || l.includes("qa")) return TaskVisualBrowse
  if (l.includes("export") || l.includes("data") || l.includes("scrape") || l.includes("extract") || l.includes("market") || l.includes("invoice")) return TaskVisualData
  return TaskVisualAutomate
}

// Hover preview descriptions per task type
function getTaskDescription(label: string): string {
  const l = label.toLowerCase()
  if (l.includes("competitor")) return "Opens competitor websites, compares pricing & features, builds a structured report"
  if (l.includes("lead")) return "Searches LinkedIn for prospects, grabs contact info, exports a ready-to-use CSV"
  if (l.includes("pitch")) return "Researches your market & competition, outlines a 10-slide investor deck"
  if (l.includes("bug")) return "Walks through every user flow, screenshots each step, flags issues by priority"
  if (l.includes("performance")) return "Checks page speed, SEO, accessibility & broken links, delivers a scored report"
  if (l.includes("api") || l.includes("documentation")) return "Extracts every endpoint, method & response, exports a Postman-ready JSON"
  if (l.includes("seo")) return "Searches target keywords, maps your ranking gaps, suggests content to close them"
  if (l.includes("spy") || l.includes("competitor ads")) return "Screenshots competitor pages & ads, delivers a messaging teardown"
  if (l.includes("trending") || l.includes("content idea")) return "Scans Google, Reddit & HN for trending topics, delivers 10 hooks"
  if (l.includes("export") || l.includes("data")) return "Navigates your pages, extracts structured data, cleans & formats as CSV"
  if (l.includes("market")) return "Researches TAM, growth rates & key players with sourced data"
  if (l.includes("review")) return "Gathers reviews from G2, Capterra & Reddit, categorizes praise vs complaints"
  if (l.includes("responsive") || l.includes("design")) return "Tests at mobile, tablet & desktop breakpoints, flags every layout issue"
  if (l.includes("enter") || l.includes("record")) return "Opens your app, enters each record one by one, confirms saves"
  return "Opens your site, executes the task step by step, delivers results"
}

/** Try to derive a short brand name from a domain, e.g. "acme.com" → "Acme" */
function brandFromDomain(url: string | null): string | null {
  if (!url) return null
  try {
    const host = url.includes("://") ? new URL(url).hostname : url.split("/")[0]
    // Strip www. and take the part before the TLD
    const parts = host.replace(/^www\./, "").split(".")
    if (parts.length === 0) return null
    const name = parts[0]
    if (!name || name.length < 2) return null
    // Capitalize first letter
    return name.charAt(0).toUpperCase() + name.slice(1)
  } catch {
    return null
  }
}

function getTaskTemplates(
  role: string | null | undefined,
  useCase: string | null | undefined,
  website: string | null | undefined,
  company: string | null | undefined,
  translateRole: (role: string, key: string) => string,
  translateUseCase: (key: string) => string,
): TaskTemplate[] {
  const siteUrl = website ? (website.startsWith("http") ? website : `https://${website}`) : null
  const companyName = company?.trim() || null
  // Fallback: derive a brand name from the domain if no company was provided
  const displayName = companyName || brandFromDomain(website ?? null)

  const personalize = (text: string, isLabel = false) => {
    let p = text
    if (siteUrl) {
      p = p.replace(/\{url\}/g, siteUrl)
    } else {
      p = p.replace(/\{url\}/g, isLabel ? "your site" : "[your website URL]")
    }
    if (displayName) {
      p = p.replace(/\{company\}/g, displayName)
    } else if (isLabel) {
      // No company info at all — strip "{company} " or " {company}" or " for {company}" cleanly
      p = p.replace(/\{company\}\s*/g, "")
      p = p.replace(/\s*for \{company\}/g, "")
      p = p.replace(/\s*on \{company\}/g, "")
      p = p.replace(/\s*into \{company\}/g, "")
      p = p.replace(/\s*about \{company\}/g, "")
      p = p.replace(/\s*\{company\}/g, "")
      // Capitalize first letter if it got lowered
      p = p.trim()
      if (p.length > 0) p = p.charAt(0).toUpperCase() + p.slice(1)
    } else {
      p = p.replace(/\{company\}/g, "[your company]")
    }
    return p
  }

  const templates: TaskTemplate[] = []
  const seen = new Set<string>()

  // Add role-based templates first (primary persona)
  const roles = (role || "").split(",").map(r => r.trim()).filter(Boolean)
  for (const r of roles) {
    for (const td of ROLE_TEMPLATE_DATA[r] || []) {
      const label = personalize(translateRole(r, td.labelKey), true)
      if (!seen.has(label)) {
        seen.add(label)
        templates.push({ label, prompt: personalize(td.prompt), icon: td.icon, color: td.color })
      }
    }
  }

  // Fill with use-case templates
  const useCases = (useCase || "").split(",").map(u => u.trim()).filter(Boolean)
  for (const uc of useCases) {
    for (const td of USE_CASE_TEMPLATE_DATA[uc] || []) {
      const label = personalize(translateUseCase(td.labelKey), true)
      if (!seen.has(label)) {
        seen.add(label)
        templates.push({ label, prompt: personalize(td.prompt), icon: td.icon, color: td.color })
      }
    }
  }

  // Fallback if nothing matched
  if (templates.length === 0) {
    return [
      { label: personalize(translateRole("founder", "competitorReport"), true), prompt: personalize("Find the top 5 competitors of {company}. Compare their pricing, features, and traffic to {url}. Deliver a side-by-side spreadsheet."), icon: Search, color: "blue" },
      { label: personalize(translateRole("developer", "findBugs"), true), prompt: personalize("Go to {url} and test every user flow for {company}. Screenshot each step, flag any bugs or broken UI, and deliver a prioritized bug report."), icon: Bug, color: "rose" },
      { label: personalize(translateUseCase("web_scraping"), true), prompt: personalize("Go to {url} and extract all structured data from {company}'s pages — products, pricing, metadata. Deliver as a clean CSV file."), icon: Globe, color: "violet" },
      { label: personalize(translateRole("developer", "performance"), true), prompt: personalize("Audit {url} for {company} — page speed, SEO, broken links, accessibility. Deliver a scored report with fixes ranked by impact."), icon: TrendingUp, color: "emerald" },
    ]
  }

  return templates.slice(0, 4)
}

const handwriting = Caveat({
  subsets: ["latin"],
  weight: ["600"],
})

// Rotating motivational sublines — picked once per mount.
const GREETING_TAGLINES = [
  "Think it. I'll do it.",
  "You're the strategy. I'm the hands.",
  "Describe the outcome. I'll find the way.",
  "Turn an hour of clicks into a sentence.",
  "Stop doing. Start directing.",
  "Click nothing. Ship everything.",
  "You decide. I execute.",
  "Skip the busywork. Point me at the real problem.",
  "Describe the finish line. I'll run it.",
  "Dream bigger. I'll handle the clicks.",
] as const


const DialogAuth = dynamic(
  () => import("./dialog-auth").then((mod) => mod.DialogAuth),
  { ssr: false }
)

export function Chat() {
  const { chatId } = useChatSession()
  const t = useTranslations("chat")
  const {
    createNewChat,
    getChatById,
    updateChatModel,
    bumpChat,
    isLoading: isChatsLoading,
  } = useChats()

  // Text rotation state
  const words = t.raw("roleLabels") as string[]
  const [currentWordIndex, setCurrentWordIndex] = useState(0)
  const [wordWidth, setWordWidth] = useState(150)
  const wordRef = useRef<HTMLSpanElement>(null)
  
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentWordIndex((prev) => (prev + 1) % words.length)
    }, 2500)
    return () => clearInterval(interval)
  }, [])
  
  // Measure word width
  useEffect(() => {
    if (wordRef.current) {
      const width = wordRef.current.offsetWidth
      setWordWidth(width + 16) // Add minimal padding
    }
  }, [currentWordIndex])

  // Local chat ID state to handle chat creation timing issues
  const [localChatId, setLocalChatId] = useState<string | null>(null)
  const effectiveChatId = localChatId || chatId

  // Sync local chat ID with URL-based chat ID when URL changes
  useEffect(() => {
    if (chatId && chatId !== localChatId) {
      setLocalChatId(chatId)
    } else if (!chatId && localChatId) {
      // Reset local chat ID when navigating away from a chat
      setLocalChatId(null)
    }
  }, [chatId, localChatId])

  const currentChat = useMemo(
    () => (effectiveChatId ? getChatById(effectiveChatId) : null),
    [effectiveChatId, getChatById]
  )

  // Get messages from provider for collaborative rooms
  const { 
    messages: providerMessages, 
    isCollaborativeRoom: isCollaborativeFromProvider,
    cacheAndAddMessage,
    setStreamingStatus
  } = useMessages()
  
  // Clean tool invocations from provider messages to ensure only complete ones are passed
  const cleanMessageToolInvocations = (messages: Message[]): Message[] => {
    return messages.map(message => {
      // Check if message has parts array (newer format)
      if (message.role === "assistant" && message.parts && Array.isArray(message.parts)) {
        // Filter out incomplete tool invocations from parts
        const cleanedParts = message.parts.filter(part => {
          if (part.type === "tool-invocation") {
            const toolInvocation = part.toolInvocation
            // Only keep tool invocations that have state "result" AND have a result property
            return toolInvocation?.state === "result" && 
                   'result' in toolInvocation &&
                   toolInvocation.result !== undefined
          }
          return true // Keep all non-tool content
        })
        
        // Extract text content from parts for the content field
        const textContent = cleanedParts
          .filter(part => part.type === "text")
          .map(part => part.text)
          .join("")
        
        return { 
          ...message, 
          content: textContent || message.content,
          parts: cleanedParts 
        }
      }
      
      // Check if message has content array (older format or mixed format)
      if (message.role === "assistant" && typeof message.content !== 'string' && Array.isArray((message as any).content)) {
        // Filter out incomplete tool invocations
        const cleanedContent = (message as any).content.filter((part: any) => {
          if (part.type === "tool-invocation") {
            const toolInvocation = part.toolInvocation
            // Only keep tool invocations that have state "result" AND have a result property
            return toolInvocation?.state === "result" && 
                   'result' in toolInvocation &&
                   toolInvocation.result !== undefined
          }
          return true // Keep all non-tool content
        })
        
        // Extract text content
        const textContent = cleanedContent
          .filter((part: any) => part.type === "text")
          .map((part: any) => part.text || "")
          .join("")
        
        return { 
          ...message, 
          content: textContent || "",
          parts: cleanedContent 
        } as any
      }
      
      return message
    })
  }
  
  // Use cleaned providerMessages as initialMessages for consistency
  const initialMessages = cleanMessageToolInvocations(providerMessages)

  const { user } = useUser()
  const { preferences } = useUserPreferences()
  const { draftValue, clearDraft } = useChatDraft(effectiveChatId)

  // Fetch subscription tier + machine limits for swarm gating
  const [userTier, setUserTier] = useState<string | null>(null)
  const [maxSwarmMachines, setMaxSwarmMachines] = useState(2)
  const [machinesList, setMachinesList] = useState<any[]>([])
  useEffect(() => {
    if (!user?.id) return
    fetch("/api/machines")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.subscriptionTier) setUserTier(data.subscriptionTier)
        else setUserTier("free")
        const planMax = data?.limits?.max_machines || 1
        setMaxSwarmMachines(Math.min(planMax * 3, 10))
        setMachinesList(data?.machines || [])
      })
      .catch(() => { setUserTier("free"); setMaxSwarmMachines(3) })
  }, [user?.id])
  const { 
    isOpen: isNavigatorOpen, 
    width: navigatorWidth,
    selectedVMId,
    setSelectedVMId 
  } = useProjectNavigator()
  
  // File upload functionality - VM only
  const {
    files,
    setFiles,
    handleFileUpload,
    handleFileRemove,
    createOptimisticAttachments,
    cleanupOptimisticAttachments,
    handleFileUploads: vmHandleFileUploads,
  } = useVMFileUpload()
  
  // Wrap handleFileUploads for compatibility with existing code
  const handleFileUploads = useCallback(async (uid: string, chatId: string) => {
    // Ignore uid and chatId, use VM upload with machineId
    return vmHandleFileUploads(selectedVMId)
  }, [selectedVMId, vmHandleFileUploads])

  // Always use the default model
  const selectedModel = MODEL_DEFAULT

  // State to pass between hooks
  const [hasDialogAuth, setHasDialogAuth] = useState(false)
  const isAuthenticated = useMemo(() => !!user?.id, [user?.id])
  const systemPrompt = useMemo(
    () => user?.system_prompt || SystemPrompts.main(),
    [user?.system_prompt]
  )

  // Chat operations (utils + handlers) - created first
  const { checkLimitsAndNotify, ensureChatExists, handleDelete, handleEdit } =
    useChatOperations({
      isAuthenticated,
      chatId: effectiveChatId,
      messages: initialMessages,
      initialMessages,
      selectedModel,
      systemPrompt,
      createNewChat,
      setHasDialogAuth,
      setMessages: () => {},
      setInput: () => {},
      setLocalChatId,
    })

  // Check if current chat is collaborative (always false now)
  const isCollaborativeRoom = false
  const isProject = false

  // Core chat functionality (initialization + state + actions)
  const {
    messages,
    input,
    status,
    stop,
    hasSentFirstMessageRef,
    isSubmitting,
    enableSearch,
    submit,
    handleSuggestion,
    handleReload,
    handleInputChange,
    creditsModalOpen,
    setCreditsModalOpen,
    creditsModalData,
  } = useChatCore({
    initialMessages,
    draftValue,
    cacheAndAddMessage,
    chatId: effectiveChatId,
    user,
    // File upload parameters
    files,
    createOptimisticAttachments,
    setFiles,
    checkLimitsAndNotify,
    cleanupOptimisticAttachments,
    ensureChatExists,
    handleFileUploads,
    selectedModel,
    selectedVMId,
    clearDraft,
    bumpChat,
  })

  // Inform messages provider about streaming status
  useEffect(() => {
    setStreamingStatus(status)
  }, [status, setStreamingStatus])

  // Input change handler
  const handleCollaborativeInputChange = handleInputChange

  // Keep track of recently completed messages to prevent them from disappearing
  const [recentlyCompletedMessages, setRecentlyCompletedMessages] = useState<Set<string>>(new Set())
  
  // Keep track of optimistic messages that should be hidden once real message arrives
  const [optimisticToHide, setOptimisticToHide] = useState<Set<string>>(new Set())
  
  // Track when streaming completes to preserve messages
  useEffect(() => {
    if (status === 'ready' && messages.length > 0) {
      const lastMessage = messages[messages.length - 1]
      if (lastMessage && lastMessage.role === 'assistant') {
        setRecentlyCompletedMessages(prev => new Set(prev).add(lastMessage.id))
        
        // Remove from recently completed after a delay
        setTimeout(() => {
          setRecentlyCompletedMessages(prev => {
            const next = new Set(prev)
            next.delete(lastMessage.id)
            return next
          })
        }, 3000) // Keep for 3 seconds to ensure DB sync
      }
    }
  }, [status, messages])
  
  // Detect when optimistic messages have been saved to DB
  useEffect(() => {
    if (!isCollaborativeRoom) return
    
    // Find optimistic messages in streaming messages
    const optimisticMessages = messages.filter(m => m.id.startsWith('optimistic-') && m.role === 'user')
    
    optimisticMessages.forEach(optMsg => {
      // Check if a real message exists in provider messages with similar content
      // Use a more lenient check that doesn't rely on exact timing
      const hasRealVersion = providerMessages.some(provMsg => {
        if (provMsg.role !== 'user') return false
        
        // Compare content (trimmed and normalized)
        const sameContent = provMsg.content.trim() === optMsg.content.trim()
        
        // Don't check timing at all - just match by content
        // This ensures the first message duplicate is properly detected
        return sameContent
      })
      
      if (hasRealVersion && !optimisticToHide.has(optMsg.id)) {
        setOptimisticToHide(prev => new Set(prev).add(optMsg.id))
      }
    })
  }, [messages, providerMessages, isCollaborativeRoom, optimisticToHide])

  // Merge streaming messages with provider messages for collaborative rooms
  const effectiveMessages = useMemo(() => {
    if (!isCollaborativeRoom) return messages
    
    // Debug logging for duplicate message issue
    if (messages.length > 0 || providerMessages.length > 0) {
      console.log('[Chat] Merging messages:', {
        streamingMessages: messages.map(m => ({ 
          id: m.id, 
          role: m.role,
          content: m.content.substring(0, 50) + '...',
          createdAt: m.createdAt 
        })),
        providerMessages: providerMessages.map(m => ({ 
          id: m.id, 
          role: m.role,
          content: m.content.substring(0, 50) + '...',
          createdAt: m.createdAt 
        })),
        optimisticToHide: Array.from(optimisticToHide),
        isCollaborativeRoom
      })
    }
    
    // Always merge both sources to prevent messages from disappearing
    const mergedMap = new Map<string, Message>()
    
    // Keep track of content we've already added to prevent exact duplicates
    const addedContent = new Set<string>()
    
    // Add provider messages (from database) - these are the "real" messages
    providerMessages.forEach(msg => {
      mergedMap.set(msg.id, msg)
      // Track message content to prevent duplicates (both user and assistant)
      addedContent.add(`${msg.role}:${msg.content.trim()}`)
    })
    
    // Then overlay streaming messages, but filter out duplicates
    messages.forEach(msg => {
      // Skip optimistic messages that we know have real versions
      if (msg.id.startsWith('optimistic-') && optimisticToHide.has(msg.id)) {
        return // Skip this message
      }
      
      if (msg.id.startsWith('optimistic-')) {
        // Check if we already have this content from provider messages
        const contentKey = `${msg.role}:${msg.content.trim()}`
        
        // If this exact content already exists in provider messages, skip it
        if (addedContent.has(contentKey)) {
          console.log('[Chat] Skipping duplicate optimistic message:', {
            optimisticId: msg.id, 
            role: msg.role,
            content: msg.content.substring(0, 50) + '...',
            alreadyInProvider: true
          })
          return
        }
        
        // For other optimistic messages, check if real version exists
        const hasRealVersion = Array.from(mergedMap.values()).some(existingMsg => {
          if (existingMsg.role !== msg.role) return false
          
          // Compare content exactly (trim whitespace but keep case)
          const sameContent = existingMsg.content.trim() === msg.content.trim()
          
          // For optimistic messages, just check content match
          // Don't check timing as it can vary greatly for first messages
          return sameContent
        })
        
        // Only add optimistic message if no real version exists
        if (!hasRealVersion) {
          mergedMap.set(msg.id, msg)
          addedContent.add(`${msg.role}:${msg.content.trim()}`)
        }
      } else {
        // For non-optimistic messages, check for content duplicates for all messages
        const contentKey = `${msg.role}:${msg.content.trim()}`
        
        // Check if we already have a message with this exact content
        const hasDuplicate = Array.from(mergedMap.values()).some(existing => 
          existing.role === msg.role && 
          existing.id !== msg.id &&
          existing.content.trim() === msg.content.trim()
        )
        
        if (hasDuplicate) {
          console.log('[Chat] Skipping duplicate message:', {
            messageId: msg.id,
            role: msg.role,
            content: msg.content.substring(0, 50) + '...'
          })
          return
        }
        
        // For non-optimistic messages, always prefer streaming version during active streaming
        const existingMsg = mergedMap.get(msg.id)
        if (!existingMsg || 
            status === 'streaming' || 
            status === 'submitted' ||
            recentlyCompletedMessages.has(msg.id) ||
            (msg.parts && msg.parts.length > 0)) {
          mergedMap.set(msg.id, msg)
          
          // Track message content for both user and assistant
          addedContent.add(`${msg.role}:${msg.content.trim()}`)
        }
      }
    })
    
    // Return merged messages sorted by creation time
    return Array.from(mergedMap.values()).sort((a, b) => {
      const aTime = new Date(a.createdAt || 0).getTime()
      const bTime = new Date(b.createdAt || 0).getTime()
      return aTime - bTime
    })
  }, [isCollaborativeRoom, providerMessages, messages, status, recentlyCompletedMessages, optimisticToHide])

  // Memoize the conversation props to prevent unnecessary rerenders
  const conversationProps = useMemo(
    () => ({
      messages: effectiveMessages,
      status,
      onDelete: handleDelete,
      onEdit: handleEdit,
      onReload: handleReload,
    }),
    [effectiveMessages, status, handleDelete, handleEdit, handleReload]
  )

  // Swarm mode state — only available on homepage (no active chat)
  const [swarmMode, setSwarmMode] = useState(false)
  const [swarmCount, setSwarmCount] = useState(3)
  const [swarmActive, setSwarmActive] = useState(false)
  const [swarmId, setSwarmId] = useState<string | null>(null)
  const [swarmPrompt, setSwarmPrompt] = useState("")
  // Track if an existing active swarm was detected on page load
  const [existingActiveSwarm, setExistingActiveSwarm] = useState<ActiveSwarm | null>(null)

  const handleActiveSwarmDetected = useCallback((swarm: ActiveSwarm | null) => {
    setExistingActiveSwarm(swarm)
  }, [])

  // Reset swarm mode when entering a chat
  useEffect(() => {
    if (effectiveChatId) {
      setSwarmMode(false)
    }
  }, [effectiveChatId])

  // Check if there are tool invocations to show above the chat input
  const hasToolInvocations = useMemo(() => {
    const messagesWithTools = [...effectiveMessages]
      .reverse()
      .filter(m => m.role === 'assistant' && m.parts?.some((p: any) => p.type === 'tool-invocation'))
    if (messagesWithTools.length === 0) return false
    const latestMessageWithTools = messagesWithTools[0]
    const toolInvocationParts = (latestMessageWithTools.parts?.filter(
      (part: any) => part.type === 'tool-invocation'
    ) || []) as any[]
    return toolInvocationParts.length > 0
  }, [effectiveMessages])

  // Swarm submit handler
  const handleSwarmSubmit = useCallback(() => {
    if (swarmMode && input.trim()) {
      const id = crypto.randomUUID()
      setSwarmId(id)
      setSwarmPrompt(input)
      setSwarmActive(true)
      handleCollaborativeInputChange("")
    } else {
      submit()
    }
  }, [swarmMode, input, submit, handleCollaborativeInputChange])

  const handleSwarmStop = useCallback(() => {
    // Don't dismiss the panel — it stays visible showing final state.
    // The panel itself handles showing completed/cancelled results.
  }, [])

  const handleSwarmDismiss = useCallback(() => {
    // User explicitly wants to start fresh — dismiss the panel
    setSwarmActive(false)
    setSwarmId(null)
    setSwarmPrompt("")
  }, [])

  // Memoize the chat input props
  const chatInputProps = useMemo(
    () => {
      return {
      value: input,
      onSuggestion: handleSuggestion,
        onValueChange: handleCollaborativeInputChange,
      onSend: handleSwarmSubmit,
      isSubmitting,
      // File upload props
      files,
      onFileUpload: handleFileUpload,
      onFileRemove: handleFileRemove,
      hasSuggestions: false,
      selectedVMId,
      setSelectedVMId,
      isUserAuthenticated: isAuthenticated,
      stop,
      status,
      onAuthRequired: () => setHasDialogAuth(true),
      hasToolInvocations,
      // Swarm mode only available on homepage (no active chat)
      swarmMode: !effectiveChatId ? swarmMode : false,
      onSwarmModeChange: !effectiveChatId ? setSwarmMode : undefined,
      swarmCount: !effectiveChatId ? swarmCount : undefined,
      onSwarmCountChange: !effectiveChatId ? setSwarmCount : undefined,
      userTier,
      maxSwarmMachines,
      }
    },
    [
      isCollaborativeRoom,
      providerMessages,
      messages,
      input,
      handleSuggestion,
      handleCollaborativeInputChange,
      handleSwarmSubmit,
      isSubmitting,
      // File upload dependencies
      files,
      handleFileUpload,
      handleFileRemove,
      preferences.promptSuggestions,
      effectiveChatId,
      selectedVMId,
      setSelectedVMId,
      isAuthenticated,
      stop,
      status,
      setHasDialogAuth,
      hasToolInvocations,
      swarmMode,
      swarmCount,
      userTier,
      maxSwarmMachines,
    ]
  )

  // Handle redirect for invalid chatId - only redirect if we're certain the chat doesn't exist
  // and we're not in a transient state during chat creation
  // Update streaming messages in the global store
  const { setStreamingMessages } = useChatStreaming()
  useEffect(() => {
    setStreamingMessages(effectiveMessages)
  }, [effectiveMessages, setStreamingMessages])
  
  const redirectCheckMessages = isCollaborativeRoom ? providerMessages : messages
  if (
    effectiveChatId &&
    !isChatsLoading &&
    !currentChat &&
    !isSubmitting &&
    status === "ready" &&
    redirectCheckMessages.length === 0 &&
    !hasSentFirstMessageRef.current // Don't redirect if we've already sent a message in this session
  ) {
    return redirect("/")
  }

  const showOnboarding = !effectiveChatId && redirectCheckMessages.length === 0

  // ── Cinematic intro ──
  // Phase lives in a shared store so the app header (rendered above us in
  // LayoutApp) can stay invisible until the intro completes — otherwise it
  // flashes in for a frame before the overlay portal covers the screen.
  const introPhase = useIntroStore((s) => s.phase)
  const setIntroPhase = useIntroStore((s) => s.setPhase)
  const resolveIntro = useIntroStore((s) => s.resolve)
  const [introResolved, setIntroResolved] = useState(false)
  const introInitializedRef = useRef(false)
  useEffect(() => {
    if (introInitializedRef.current) return
    introInitializedRef.current = true
    resolveIntro(showOnboarding && !!user)
    setIntroResolved(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const introVisible = (introPhase === "active" || introPhase === "fading") && showOnboarding && !!user

  // Pick a random motivational tagline once per mount — client-only to avoid SSR
  // hydration mismatch (Math.random differs between server and client renders).
  const [greetingTagline, setGreetingTagline] = useState<string>(GREETING_TAGLINES[0])
  useEffect(() => {
    setGreetingTagline(GREETING_TAGLINES[Math.floor(Math.random() * GREETING_TAGLINES.length)])
  }, [])

  // Check if user has saved credentials (for nudge in greeting)
  const [hasCredentials, setHasCredentials] = useState<boolean | null>(null)
  useEffect(() => {
    if (!isAuthenticated) return
    fetch("/api/secrets")
      .then((r) => r.json())
      .then((data) => setHasCredentials((data.secrets ?? []).length > 0))
      .catch(() => {})
  }, [isAuthenticated])

  // Task templates based on onboarding role + use-case (activation metric)
  const translateRole = useCallback((role: string, key: string) => t(`taskTemplates.${role}.${key}`, { company: "{company}" }), [t])
  const translateUseCase = useCallback((key: string) => t(`useCaseTemplates.${key}`, { company: "{company}" }), [t])
  const taskTemplates = useMemo(
    () => getTaskTemplates(user?.role, user?.use_case, user?.website, user?.company, translateRole, translateUseCase),
    [user?.role, user?.use_case, user?.website, user?.company, translateRole, translateUseCase]
  )

  // Any swarm is taking over the screen (new or returning)
  const swarmFullscreen = swarmActive || (!!existingActiveSwarm && showOnboarding)

  return (
    <div
        className={cn(
          "@container/main relative flex h-full flex-col items-center no-scrollbar",
          swarmFullscreen ? "justify-start" : "justify-end md:justify-center"
        )}
      >
        {introVisible && createPortal(
          <CinematicIntro
            onSettled={() => setIntroPhase("fading")}
            onComplete={() => setIntroPhase("done")}
          />,
          document.body
        )}
        {introPhase === "tagline-only" && showOnboarding && !!user && createPortal(
          <TaglineIntro
            onSettled={() => {}}
            onComplete={() => setIntroPhase("done")}
          />,
          document.body
        )}
        {!introResolved && showOnboarding && (
          <div className="fixed inset-0 z-[2147483647] bg-background" />
        )}
        <DialogAuth open={hasDialogAuth} setOpen={setHasDialogAuth} />
        <InsufficientCreditsModal
          isOpen={creditsModalOpen}
          onClose={() => setCreditsModalOpen(false)}
          currentBalance={creditsModalData.currentBalance}
          requiredCredits={creditsModalData.requiredCredits}
          estimatedRuntime={creditsModalData.estimatedRuntime}
          errorMessage={creditsModalData.errorMessage}
        />
        {showOnboarding && !!user && <QuickStartGuide />}

      
      <AnimatePresence initial={false} mode="popLayout">
        {showOnboarding && !swarmFullscreen && (
          <motion.div
            key="onboarding"
            className="relative mx-auto w-full overflow-visible pb-12 sm:pb-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -20, transition: { duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] } }}
            layout="position"
            layoutId="onboarding"
            transition={{
              layout: {
                duration: 0,
              },
            }}
          >
            {/* Greeting */}
                <motion.div
                  key="greeting"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
                  className="max-w-[50rem] mx-auto px-4"
                >
                  <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1, duration: 0.5 }}
                    className="text-center mb-2"
                  >
                    <h1
                      className={cn(
                        "text-4xl sm:text-5xl font-bold tracking-tight relative z-10 leading-relaxed pb-1 flex items-center justify-center gap-2 flex-wrap",
                        user ? handwriting.className : ""
                      )}
                    >
                      {user ? (
                        <>
                          <span className="inline-block -rotate-1 text-primary/90">{t("greeting")}</span>
                          {user.display_name && (
                            <>
                              <span className="inline-block -rotate-1 text-primary/90">, {user.display_name}</span>
                            </>
                          )}
                          <span className="inline-block -rotate-1 text-primary/90">!</span>
                        </>
                      ) : (
                        <>
                          <span className="bg-gradient-to-b from-foreground to-foreground/70 bg-clip-text text-transparent">
                            Coasty: Your AI
                          </span>
                        </>
                      )}
                      {!user && (
                        <motion.span
                          className="relative inline-flex items-center overflow-hidden align-middle"
                          animate={{ width: wordWidth }}
                          transition={{
                            type: "spring",
                            stiffness: 100,
                            damping: 15,
                            mass: 0.5
                          }}
                          style={{ height: "1.4em" }}
                        >
                          <motion.span
                            className={`absolute inset-0 rounded-xl bg-gradient-to-r ${themeConfig.gradients.wordRotation.base}`}
                            animate={{
                              opacity: [0.5, 1, 0.5]
                            }}
                            transition={{
                              duration: 3,
                              repeat: Infinity,
                              ease: "easeInOut"
                            }}
                          />
                          <motion.span
                            className="absolute inset-0 rounded-xl"
                            style={{
                              background: `radial-gradient(circle at 50% 50%, ${themeConfig.gradients.wordRotation.radialGlow} 0%, transparent 70%)`,
                            }}
                          />
                          <AnimatePresence mode="sync">
                            <motion.span
                              key={currentWordIndex}
                              initial={{ y: "100%", opacity: 0 }}
                              animate={{ y: "0%", opacity: 1 }}
                              exit={{ y: "-100%", opacity: 0 }}
                              transition={{
                                duration: 0.5,
                                ease: [0.25, 0.46, 0.45, 0.94]
                              }}
                              className="absolute w-full h-full flex items-center justify-center"
                            >
                              <span
                                ref={wordRef}
                                className={`relative px-2 ${themeConfig.primary.tw.text.base} font-bold whitespace-nowrap`}
                              >
                                {words[currentWordIndex]}
                              </span>
                            </motion.span>
                          </AnimatePresence>
                          <motion.span
                            className={`absolute inset-0 rounded-xl border ${themeConfig.gradients.wordRotation.border}`}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.3 }}
                          />
                        </motion.span>
                      )}
                    </h1>
                  </motion.div>

                  <motion.div
                    className="flex justify-center mb-6 px-2"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.2, duration: 0.5 }}
                  >
                    <p className="text-center text-muted-foreground text-sm sm:text-base md:text-lg">
                      {user ? greetingTagline : t("greetingUnauth")}
                    </p>
                  </motion.div>

                </motion.div>

          </motion.div>
        )}
        {!showOnboarding && !swarmFullscreen && (
          <Conversation key="conversation" {...conversationProps} />
        )}
      </AnimatePresence>

      {/* Swarm panel — fills available space between header and input */}
      <AnimatePresence>
        {swarmActive && (
          <motion.div
            key="swarm-panel"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 30, transition: { duration: 0.25 } }}
            transition={{ type: "spring", duration: 0.5, bounce: 0.15 }}
            className="flex-1 w-full mx-auto px-4 sm:px-6 md:px-8 min-h-0 pb-2 flex flex-col"
          >
            <SwarmPanel
              isActive={swarmActive}
              swarmId={swarmId}
              prompt={swarmPrompt}
              machineCount={swarmCount}
              onStop={handleSwarmStop}
              onDismiss={handleSwarmDismiss}
            />
          </motion.div>
        )}
        {!swarmActive && existingActiveSwarm && showOnboarding && (
          <motion.div
            key="active-swarm-fullscreen"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 30, transition: { duration: 0.25 } }}
            transition={{ type: "spring", duration: 0.5, bounce: 0.15 }}
            className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 md:px-8 min-h-0 pb-2 flex flex-col"
          >
            <ActiveSwarmBanner fullscreen onSwarmDetected={handleActiveSwarmDetected} />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        className={cn(
          "relative inset-x-0 bottom-0 z-50 mx-auto w-full px-4 sm:px-6 md:px-8",
          !isProject || !isNavigatorOpen ? "max-w-3xl" : "max-w-4xl"
        )}
        layout="position"
        layoutId="chat-input-container"
        transition={{
          layout: {
            duration: effectiveMessages.length === 1 ? 0.3 : 0,
          },
        }}
      >
        {/* Show tool invocations dock above chat input */}
        {(() => {
          const messagesWithTools = [...effectiveMessages]
            .reverse()
            .filter(m => m.role === 'assistant' && m.parts?.some((p: any) => p.type === 'tool-invocation'))

          if (messagesWithTools.length === 0) return null

          const latestMessageWithTools = messagesWithTools[0]

          const toolInvocationParts = (latestMessageWithTools.parts?.filter(
            (part: any) => part.type === 'tool-invocation'
          ) || []) as any[]

          if (toolInvocationParts.length > 0) {
            return (
              <div className="relative z-10">
                <ToolInvocation toolInvocations={toolInvocationParts} />
              </div>
            )
          }

          return null
        })()}
        
        {/* Research suggestions removed
        {showOnboarding && (
          <ResearchSuggestions 
            onSelectSuggestion={handleSuggestion} 
            className="mb-3 -mx-4 sm:mx-0"
          />
        )} */}
        {/* Show inline active swarm banner only when not in fullscreen swarm mode */}
        {showOnboarding && !swarmFullscreen && <ActiveSwarmBanner onSwarmDetected={handleActiveSwarmDetected} />}
        <RemoteApproval machineId={selectedVMId} isElectronMachine={machinesList.some((m: any) => m.id === selectedVMId && m.settings?.provider === 'electron')} />

        <ChatInput {...chatInputProps} />

        {/* Task templates — Apple-style minimal list with subtle icons */}
        <AnimatePresence>
          {showOnboarding && !swarmMode && !swarmFullscreen && user && (
            <motion.div
              key="task-templates-list"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6, transition: { duration: 0.15 } }}
              transition={{ delay: 0.3, duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="mx-auto mt-5 mb-1 flex w-full max-w-[34rem] flex-col items-center"
            >
              {taskTemplates.map((t, i) => {
                const summary = getTaskDescription(t.label)
                return (
                  <motion.button
                    key={t.label}
                    type="button"
                    onClick={() => handleCollaborativeInputChange(t.prompt)}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.35 + i * 0.05, duration: 0.45, ease: [0.25, 0.1, 0.25, 1] }}
                    className={cn(
                      "group relative flex w-full cursor-pointer items-center justify-center py-2 text-center",
                      i > 0 && "before:absolute before:left-1/2 before:top-0 before:h-px before:w-24 before:-translate-x-1/2 before:bg-foreground/[0.07] before:content-['']",
                    )}
                  >
                    <span className="relative truncate px-4 text-[11.5px] font-normal tracking-[-0.005em] text-foreground/45 transition-colors duration-200 ease-out group-hover:text-foreground/85">
                      {summary}
                    </span>
                  </motion.button>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Task hover visual animations */}
        <style dangerouslySetInnerHTML={{ __html: `
          @keyframes thv-slide-in {
            from { opacity: 0; transform: translateX(-8px); }
            to { opacity: 1; transform: translateX(0); }
          }
          .thv-row { animation: thv-slide-in 0.35s cubic-bezier(0.25, 1, 0.5, 1) both; }

          @keyframes thv-fade-up {
            from { opacity: 0; transform: translateY(6px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .thv-fade-up { animation: thv-fade-up 0.4s ease-out both; }

          @keyframes thv-fill {
            from { width: 0%; }
            to { width: var(--progress, 50%); }
          }
          .thv-progress { animation: thv-fill 0.8s cubic-bezier(0.25, 1, 0.5, 1) both; }

          @keyframes thv-char-reveal {
            from { opacity: 0; transform: translateY(2px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .thv-type-char { animation: thv-char-reveal 0.15s ease-out both; }

          @keyframes thv-pulse-dot {
            0%, 100% { opacity: 0.6; transform: scale(1); }
            50% { opacity: 1; transform: scale(1.3); }
          }
          .thv-pulse-dot { animation: thv-pulse-dot 2s ease-in-out infinite; }
        ` }} />
      </motion.div>
    </div>
  )
}
