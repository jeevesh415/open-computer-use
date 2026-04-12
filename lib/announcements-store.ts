"use client"

import { create } from "zustand"

// ── Announcement types ─────────────────────────────────────────────��
export type AnnouncementTag = "new" | "improvement" | "fix" | "update"

export interface Announcement {
  id: string
  title: string
  description: string
  date: string // ISO date string e.g. "2026-04-05"
  tag: AnnouncementTag
  link?: string
  linkLabel?: string
  /** Image path for the hero visual (public/ relative) */
  image?: string
  /** Gradient theme for the hero background */
  gradient: { bg: string; orb1: string; orb2: string; orb3: string }
}

// ── Static announcements data ───────────────────────────────────────
// Add new announcements at the TOP of this array (newest first).
// Each must have a unique `id` — used to track read state.
export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: "cua-v3-2026-04",
    title: "Coasty CUA v3, the cheapest CUA ever",
    description:
      "Completely rebuilt Computer Use Agent with significantly improved accuracy, 3x faster execution, and the cheapest CUA on the market — up to 60% lower cost per task.",
    date: "2026-04-05",
    tag: "new",
    image: "/demo-screenshot.png",
    gradient: {
      bg: "from-blue-950 via-indigo-950 to-slate-950",
      orb1: "bg-blue-500/40",
      orb2: "bg-violet-500/30",
      orb3: "bg-cyan-400/25",
    },
  },
  {
    id: "mobile-remote-2026-04",
    title: "Remote control from mobile",
    description:
      "Control your machines on the go. Start tasks, approve actions, monitor screenshots, and manage agents — all from your phone.",
    date: "2026-04-02",
    tag: "new",
    image: "/demo-screenshot-mobile.png",
    gradient: {
      bg: "from-teal-900 via-cyan-900 to-sky-950",
      orb1: "bg-teal-400/45",
      orb2: "bg-cyan-300/35",
      orb3: "bg-sky-400/30",
    },
  },
]

// ── Storage key ─────────────────────────────────────────────────────
const STORAGE_KEY = "coasty-announcements-read"

function getReadIds(): Set<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch {
    return new Set()
  }
}

function persistReadIds(ids: Set<string>) {
  if (typeof window === "undefined") return
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]))
}

// ── Zustand store ───────────────────────────────────────────────────
interface AnnouncementsStore {
  readIds: Set<string>
  hydrated: boolean
  hydrate: () => void
  markAllRead: () => void
  unreadCount: number
}

export const useAnnouncementsStore = create<AnnouncementsStore>((set, get) => ({
  readIds: new Set(),
  hydrated: false,
  unreadCount: ANNOUNCEMENTS.length,

  hydrate: () => {
    if (get().hydrated) return
    if (typeof window === "undefined") return
    const ids = getReadIds()
    const unread = ANNOUNCEMENTS.filter((a) => !ids.has(a.id)).length
    set({ readIds: ids, hydrated: true, unreadCount: unread })
  },

  markAllRead: () => {
    const ids = new Set(ANNOUNCEMENTS.map((a) => a.id))
    persistReadIds(ids)
    set({ readIds: ids, unreadCount: 0 })
  },
}))
