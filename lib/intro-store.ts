"use client"

import { create } from "zustand"

const DISMISS_KEY = "coasty-skip-intro"

export type IntroPhase =
  | "pending"
  | "active"
  | "tagline-only"
  | "fading"
  | "done"

interface IntroStore {
  phase: IntroPhase
  setPhase: (phase: IntroPhase) => void
  resolve: (showOnboarding: boolean) => void
}

export const useIntroStore = create<IntroStore>((set) => ({
  phase: "pending",
  setPhase: (phase) => set({ phase }),
  resolve: (showOnboarding) => {
    if (typeof window === "undefined") return
    if (!showOnboarding) {
      set({ phase: "done" })
      return
    }
    const dismissed = !!localStorage.getItem(DISMISS_KEY)
    set({ phase: dismissed ? "tagline-only" : "active" })
  },
}))
