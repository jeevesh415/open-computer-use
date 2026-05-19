// app/providers/user-provider.tsx
"use client"

import {
  fetchUserProfile,
  signOutUser,
  subscribeToUserUpdates,
  updateUserProfile,
} from "@/lib/user-store/api"
import { clearAllIndexedDBStores } from "@/lib/chat-store/persist"
import type { UserProfile } from "@/lib/user/types"
import { identifyUser, resetUser, trackSignOut } from "@/lib/posthog/analytics"
import { clearSigningOut, markSigningOut } from "@/lib/user-store/sign-out-state"
import { dismissAllToasts } from "@/components/ui/toast"
import { createContext, useContext, useEffect, useState } from "react"

type UserContextType = {
  user: UserProfile | null
  isLoading: boolean
  updateUser: (updates: Partial<UserProfile>) => Promise<void>
  refreshUser: () => Promise<void>
  signOut: () => Promise<void>
}

const UserContext = createContext<UserContextType | undefined>(undefined)

export function UserProvider({
  children,
  initialUser,
}: {
  children: React.ReactNode
  initialUser: UserProfile | null
}) {
  const [user, setUser] = useState<UserProfile | null>(initialUser)
  const [isLoading, setIsLoading] = useState(false)

  const refreshUser = async () => {
    if (!user?.id) return

    setIsLoading(true)
    try {
      const updatedUser = await fetchUserProfile(user.id)
      if (updatedUser) setUser(updatedUser)
    } finally {
      setIsLoading(false)
    }
  }

  const updateUser = async (updates: Partial<UserProfile>) => {
    if (!user?.id) return

    setIsLoading(true)
    try {
      const success = await updateUserProfile(user.id, updates)
      if (success) {
        setUser((prev) => (prev ? { ...prev, ...updates } : null))
      }
    } finally {
      setIsLoading(false)
    }
  }

  const signOut = async () => {
    // Sign-out has to be atomic from the user's perspective: one click,
    // immediate redirect to /, no transient broken state in between.
    //
    // Bug we're fixing: the previous implementation only cleared the Supabase
    // session and React state, then RETURNED. Whatever protected page the user
    // was on (chat, /c/[id], dashboard) re-rendered with `user=null` —
    // showing a half-empty header, no display name, etc. Only when the user
    // hit refresh did the middleware see no auth cookie and redirect them to
    // the landing page.
    //
    // Fix: do every cleanup synchronously, THEN hard-navigate via
    // `window.location.replace("/")`. The full page reload is deliberate:
    //   - the home page server component re-renders with isAuthenticated=false
    //     so the LandingPage shows immediately on the new request (no flash);
    //   - every Zustand store, React Query cache, and in-memory ref is
    //     wiped — important on shared devices so the next user doesn't see
    //     stale chats while the page transitions;
    //   - `replace` (not `assign`) strips the protected URL from history, so
    //     pressing Back after sign-out doesn't take the user to a now-broken
    //     authenticated route.
    //
    // We don't await IndexedDB cleanup before navigation — `idb` queues the
    // deletes and they complete after the unload starts, which is fine since
    // the next page load won't read from those stores until after they're
    // gone (the messages/chats providers are unmounted by the redirect).
    setIsLoading(true)
    // Set the sentinel BEFORE we touch supabase. Anything in-flight on the
    // page (the AI chat's streaming fetch, TanStack queries, realtime
    // channels) is about to start failing as soon as the auth cookie is
    // cleared a few lines below — without this flag, those failures bubble
    // up as toasts ("An error occurred", "Failed to ...") right as the
    // user is being navigated away. Listeners that surface transient
    // errors check `isSigningOut()` and stay quiet.
    markSigningOut()
    // Tear down any toasts that rendered just before our sentinel was
    // set. Even with the sentinel in place, a toast that was already
    // queued one tick before this call would still flash; dismissAll
    // sweeps the slate clean.
    dismissAllToasts()
    try {
      const success = await signOutUser()
      if (!success) {
        // signOutUser already toasted the failure reason. Stay put so the
        // user can retry rather than being silently kicked to landing.
        clearSigningOut()
        setIsLoading(false)
        return
      }

      // PostHog uses navigator.sendBeacon for the identify/reset event —
      // survives the unload, so calling this before replace() is safe.
      trackSignOut()
      resetUser()
      setUser(null)
      // Fire-and-forget IDB cleanup. The deletes are queued by `idb` and
      // complete after the unload starts; that's fine because the next
      // page (LandingPage) doesn't read those stores until they're gone.
      clearAllIndexedDBStores().catch((e) =>
        console.warn("clearAllIndexedDBStores failed during signOut:", e),
      )

      // setUser(null) above triggers a re-render of every UserContext
      // consumer with `user=null`. Some of those have useEffect deps on
      // `user` and will refetch — with the just-cleared auth cookie that
      // returns 401, and the call site might toast. We don't try to
      // prevent the refetches (it'd require touching every provider in
      // the tree); instead, the toast() utility checks `isSigningOut()`
      // and silently drops error/warning toasts during this window.
      // See components/ui/toast.tsx + lib/user-store/sign-out-state.ts.

      // Guard for SSR / non-browser callers (tests, server components if
      // anyone re-uses this hook by mistake).
      if (typeof window !== "undefined") {
        window.location.replace("/")
      }
    } catch (e) {
      console.error("signOut threw:", e)
      clearSigningOut()
      setIsLoading(false)
    }
  }

  // Identify user with PostHog when authenticated
  useEffect(() => {
    if (!user?.id) return

    identifyUser(user.id, {
      email: user.email,
      display_name: user.display_name,
      profile_image: user.profile_image,
      created_at: user.created_at ?? undefined,
    })
  }, [user?.id, user?.email, user?.display_name, user?.profile_image, user?.created_at])

  // Set up realtime subscription for user data changes
  useEffect(() => {
    if (!user?.id) return

    const unsubscribe = subscribeToUserUpdates(user.id, (newData) => {
      setUser((prev) => (prev ? { ...prev, ...newData } : null))
    })

    return () => {
      unsubscribe()
    }
  }, [user?.id])

  return (
    <UserContext.Provider
      value={{ user, isLoading, updateUser, refreshUser, signOut }}
    >
      {children}
    </UserContext.Provider>
  )
}

// Custom hook to use the user context
export function useUser() {
  const context = useContext(UserContext)
  if (context === undefined) {
    throw new Error("useUser must be used within a UserProvider")
  }
  return context
}
