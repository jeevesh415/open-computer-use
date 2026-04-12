"use client"

import { create } from "zustand"

interface GuideStore {
  dismissed: boolean
  hydrated: boolean
  hydrate: () => void
  toggle: () => void
}

export const useGuideStore = create<GuideStore>((set, get) => ({
  dismissed: false,
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return
    if (typeof window === "undefined") return
    const val = localStorage.getItem("coasty-quickstart-dismissed") === "true"
    set({ dismissed: val, hydrated: true })
  },
  toggle: () => {
    const next = !get().dismissed
    if (next) {
      localStorage.setItem("coasty-quickstart-dismissed", "true")
    } else {
      localStorage.removeItem("coasty-quickstart-dismissed")
    }
    set({ dismissed: next })
  },
}))
