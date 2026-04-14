"use client"

import { create } from "zustand"

export type AccountSectionType =
  | "account"
  | "billing"
  | "privacy"
  | "notifications"
  | "appearance"
  | "api-keys"
  | "data"
  | "feedback"
  | "about"
  | "social"
  | "public-chats"

interface AccountDialogStore {
  isOpen: boolean
  section: AccountSectionType
  /** The path the user was on before opening the dialog */
  _previousPath: string | null
  /** Whether open() pushed a history entry (overlay mode) vs direct URL visit */
  _didPushState: boolean
  open: (section?: AccountSectionType) => void
  close: () => void
  setSection: (section: AccountSectionType) => void
  /** Called from the dialog component to sync state without URL side-effects */
  _syncFromUrl: (section: AccountSectionType) => void
}

export const useAccountDialog = create<AccountDialogStore>((set, get) => ({
  isOpen: false,
  section: "account",
  _previousPath: null,
  _didPushState: false,

  open: (section = "account") => {
    if (typeof window === "undefined") return
    const current = get()
    // Save current path if we're not already on /account
    const currentPath = window.location.pathname + window.location.search
    const previousPath = currentPath.startsWith("/account") ? current._previousPath : currentPath

    // Determine if this is an overlay (pushState) or already on /account route
    const needsPush = !window.location.pathname.startsWith("/account") && window.location.pathname !== "/credits"

    set({ isOpen: true, section, _previousPath: previousPath, _didPushState: needsPush })

    // Push /account?section=X to the URL
    const url = section === "account" ? "/account" : `/account?section=${section}`
    if (needsPush) {
      window.history.pushState({ accountDialog: true, section }, "", url)
    } else {
      // Already on /account or /credits — just update the URL without adding history
      window.history.replaceState({ accountDialog: true, section }, "", url)
    }
  },

  close: () => {
    if (typeof window === "undefined") return
    const { _didPushState } = get()
    set({ isOpen: false, _previousPath: null, _didPushState: false })

    // Always clean up pointer-events that Radix may have set
    document.body.style.pointerEvents = ""

    if (_didPushState) {
      // We pushed a history entry in open() — go back to undo it.
      // This triggers popstate, but the handler checks isOpen (already false) so it's safe.
      window.history.back()
    }
    // If !_didPushState, user was on the actual /account or /credits route.
    // The dialog component handles real Next.js navigation in this case.
  },

  setSection: (section) => {
    if (typeof window === "undefined") return
    set({ section })
    // Replace URL to update section without adding history entry
    const url = section === "account" ? "/account" : `/account?section=${section}`
    window.history.replaceState({ accountDialog: true, section }, "", url)
  },

  _syncFromUrl: (section) => {
    set({ isOpen: true, section })
  },
}))
