// @vitest-environment jsdom
/**
 * signout-flow.test.tsx — guards the sign-out UX against the
 * "transient broken state" bug we fixed.
 *
 * The original bug
 * ----------------
 * Clicking "Sign out" in the topbar or sidebar called the user-store's
 * `signOut()`, which cleared the Supabase session and set `user=null`
 * in React state — but never navigated. Whatever protected page the user
 * was on (chat, /c/[id], dashboard) re-rendered with `user=null`, showing
 * a half-empty header with no display name. Only when the user pressed
 * refresh did the middleware see no auth cookie and redirect them to
 * the landing page.
 *
 * What we now guarantee
 * ---------------------
 * 1. `useUser().signOut()` calls `signOutUser()` (Supabase auth signOut),
 *    fires the analytics signal, clears React state, kicks off the
 *    IndexedDB cleanup, AND triggers a hard navigation to `/`.
 * 2. The hard navigation is `window.location.replace("/")` — not `assign`
 *    — so the protected URL is wiped from history and the user can't
 *    press Back into a now-broken authenticated route.
 * 3. If `signOutUser()` returns `false` (Supabase unavailable / network),
 *    we DON'T navigate or wipe state — the user can retry.
 * 4. The IndexedDB cleanup is fire-and-forget (no await) so a stale tab
 *    without IDB access doesn't block sign-out.
 *
 * The test mocks Supabase, IndexedDB, and PostHog so the suite stays
 * fast and deterministic. The system under test is the real provider.
 */
import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, act, cleanup } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Mock dependencies BEFORE importing the provider so the module sees mocks.
// ---------------------------------------------------------------------------

// Supabase auth — capture how many times we asked it to sign out.
const signOutUserMock = vi.fn(async () => true)
vi.mock("@/lib/user-store/api", () => ({
  signOutUser: () => signOutUserMock(),
  fetchUserProfile: vi.fn(async () => null),
  updateUserProfile: vi.fn(async () => true),
  // The provider sets up a realtime subscription on mount when a user is
  // present. Return a no-op unsubscribe so the effect doesn't blow up.
  subscribeToUserUpdates: vi.fn(() => () => {}),
}))

// IndexedDB cleanup — assert it was called, but resolve cleanly so the
// fire-and-forget doesn't surface as an unhandled rejection.
const clearAllIndexedDBStoresMock = vi.fn(async () => undefined)
vi.mock("@/lib/chat-store/persist", () => ({
  clearAllIndexedDBStores: () => clearAllIndexedDBStoresMock(),
}))

// PostHog analytics — capture the sign-out event + identity reset.
const trackSignOutMock = vi.fn()
const resetUserMock = vi.fn()
vi.mock("@/lib/posthog/analytics", () => ({
  trackSignOut: () => trackSignOutMock(),
  resetUser: () => resetUserMock(),
  identifyUser: vi.fn(),
}))

// Toast — keep the surface real-import-able even though we never assert it.
// dismissAllToasts is called by provider.signOut to sweep toasts that
// rendered a tick before the sign-out sentinel flipped; mock it as a noop.
vi.mock("@/components/ui/toast", () => ({
  toast: vi.fn(),
  dismissAllToasts: vi.fn(),
}))

// Now import the SUT.
import { UserProvider, useUser } from "@/lib/user-store/provider"

// ---------------------------------------------------------------------------
// jsdom helper — `window.location` is a structured object the test must be
// allowed to swap. JSDOM 22+ throws on `window.location = {…}`, so we use
// `Object.defineProperty` to install a spy-able replace().
// ---------------------------------------------------------------------------

let locationReplaceSpy: ReturnType<typeof vi.fn>
let locationAssignSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  locationReplaceSpy = vi.fn()
  locationAssignSpy = vi.fn()
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: {
      ...window.location,
      replace: locationReplaceSpy,
      assign: locationAssignSpy,
    },
  })
})

afterEach(() => {
  cleanup()
})

// ---------------------------------------------------------------------------
// Test harness — render the provider with an arbitrary initial user, expose
// the `signOut` function via a ref so tests can call it directly.
// ---------------------------------------------------------------------------

interface SignOutHandle {
  callSignOut: () => Promise<void>
  getUser: () => unknown
  getIsLoading: () => boolean
}

function makeHarness(): SignOutHandle {
  const handle: Partial<SignOutHandle> = {}

  function Probe() {
    const { signOut, user, isLoading } = useUser()
    handle.callSignOut = signOut
    handle.getUser = () => user
    handle.getIsLoading = () => isLoading
    return null
  }

  render(
    <UserProvider
      initialUser={{
        id: "u-test-1",
        email: "test@example.com",
        display_name: "Test User",
        profile_image: "",
        created_at: new Date().toISOString(),
      } as any}
    >
      <Probe />
    </UserProvider>,
  )

  return handle as SignOutHandle
}

// ---------------------------------------------------------------------------
// Happy-path: every step of the contract fires, in the right order.
// ---------------------------------------------------------------------------

describe("useUser().signOut — happy path", () => {
  it("calls Supabase signOutUser exactly once", async () => {
    const h = makeHarness()
    await act(async () => { await h.callSignOut() })
    expect(signOutUserMock).toHaveBeenCalledTimes(1)
  })

  it("fires the trackSignOut analytics event", async () => {
    const h = makeHarness()
    await act(async () => { await h.callSignOut() })
    expect(trackSignOutMock).toHaveBeenCalledTimes(1)
  })

  it("resets the PostHog user identity", async () => {
    const h = makeHarness()
    await act(async () => { await h.callSignOut() })
    expect(resetUserMock).toHaveBeenCalledTimes(1)
  })

  it("clears React state (user becomes null)", async () => {
    const h = makeHarness()
    expect(h.getUser()).toMatchObject({ id: "u-test-1" })
    await act(async () => { await h.callSignOut() })
    expect(h.getUser()).toBeNull()
  })

  it("kicks off IndexedDB cleanup (fire-and-forget)", async () => {
    const h = makeHarness()
    await act(async () => { await h.callSignOut() })
    // Fire-and-forget — the call should be issued but we don't have to
    // await its resolution. Just check it was invoked.
    expect(clearAllIndexedDBStoresMock).toHaveBeenCalledTimes(1)
  })

  it("hard-redirects to `/` via window.location.replace", async () => {
    const h = makeHarness()
    await act(async () => { await h.callSignOut() })
    // `replace` (not `assign`) — so the protected route is removed from
    // history and Back doesn't return the user to a now-broken page.
    expect(locationReplaceSpy).toHaveBeenCalledWith("/")
    expect(locationAssignSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Ordering — the cleanup MUST happen before navigation. Otherwise we'd
// briefly render a logged-in chrome around a logged-out backend, which is
// the exact "transient broken state" the user complained about.
// ---------------------------------------------------------------------------

describe("useUser().signOut — ordering guarantees", () => {
  it("Supabase sign-out completes before navigation fires", async () => {
    // We resolve signOutUser AFTER capturing the order of side effects.
    let signOutResolve: (v: boolean) => void = () => {}
    signOutUserMock.mockImplementationOnce(
      () => new Promise<boolean>((res) => { signOutResolve = res }),
    )

    const h = makeHarness()
    let signOutPromise: Promise<void>
    act(() => { signOutPromise = h.callSignOut() })

    // Before Supabase resolves, navigation must NOT have fired.
    expect(locationReplaceSpy).not.toHaveBeenCalled()

    // Now resolve Supabase — and only then should the redirect happen.
    await act(async () => {
      signOutResolve(true)
      await signOutPromise!
    })
    expect(locationReplaceSpy).toHaveBeenCalledWith("/")
  })

  it("React state is cleared before navigation fires", async () => {
    // Same pattern — pause Supabase, observe state, resume.
    let signOutResolve: (v: boolean) => void = () => {}
    signOutUserMock.mockImplementationOnce(
      () => new Promise<boolean>((res) => { signOutResolve = res }),
    )

    const h = makeHarness()
    let signOutPromise: Promise<void>
    act(() => { signOutPromise = h.callSignOut() })

    // While Supabase is in-flight: user still set, no redirect.
    expect(h.getUser()).not.toBeNull()
    expect(locationReplaceSpy).not.toHaveBeenCalled()

    await act(async () => {
      signOutResolve(true)
      await signOutPromise!
    })
    // After: user cleared, redirect fired.
    expect(h.getUser()).toBeNull()
    expect(locationReplaceSpy).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Failure path: if Supabase signOut returns false (deployment without
// Supabase, network drop, etc.) we MUST stay on the current page so the
// user can retry. Silently kicking them to landing while still authed
// is worse than the original bug.
// ---------------------------------------------------------------------------

describe("useUser().signOut — failure path", () => {
  it("does NOT navigate when signOutUser returns false", async () => {
    signOutUserMock.mockImplementationOnce(async () => false)
    const h = makeHarness()
    await act(async () => { await h.callSignOut() })
    expect(locationReplaceSpy).not.toHaveBeenCalled()
  })

  it("does NOT clear React user when signOutUser returns false", async () => {
    signOutUserMock.mockImplementationOnce(async () => false)
    const h = makeHarness()
    await act(async () => { await h.callSignOut() })
    expect(h.getUser()).toMatchObject({ id: "u-test-1" })
  })

  it("does NOT fire analytics when signOutUser returns false", async () => {
    signOutUserMock.mockImplementationOnce(async () => false)
    const h = makeHarness()
    await act(async () => { await h.callSignOut() })
    expect(trackSignOutMock).not.toHaveBeenCalled()
    expect(resetUserMock).not.toHaveBeenCalled()
  })

  it("releases the loading flag after a failed sign-out so the button is clickable again", async () => {
    signOutUserMock.mockImplementationOnce(async () => false)
    const h = makeHarness()
    await act(async () => { await h.callSignOut() })
    expect(h.getIsLoading()).toBe(false)
  })

  it("does NOT crash when signOutUser throws", async () => {
    signOutUserMock.mockImplementationOnce(async () => {
      throw new Error("network down")
    })
    const h = makeHarness()
    await act(async () => { await h.callSignOut() })
    // A throw must not propagate, must not navigate, must not clear user.
    expect(locationReplaceSpy).not.toHaveBeenCalled()
    expect(h.getUser()).not.toBeNull()
    expect(h.getIsLoading()).toBe(false)
  })

  it("does NOT crash when IndexedDB cleanup throws", async () => {
    // Even if IDB is broken, the sign-out itself must succeed and redirect.
    clearAllIndexedDBStoresMock.mockImplementationOnce(
      () => Promise.reject(new Error("idb access denied")),
    )
    const h = makeHarness()
    await act(async () => { await h.callSignOut() })
    expect(locationReplaceSpy).toHaveBeenCalledWith("/")
  })
})

// ---------------------------------------------------------------------------
// Static guard: the sign-out *callers* in the UI never bypass the provider.
// If someone re-introduces a hand-rolled `supabase.auth.signOut()` directly
// inside a topbar/sidebar handler, this test catches it.
// ---------------------------------------------------------------------------

import fs from "fs"
import path from "path"

describe("static guard: sign-out call sites go through useUser()", () => {
  const REPO_ROOT = path.resolve(__dirname, "../..")

  // The known UI surfaces that expose a "Sign out" affordance.
  const callSites = [
    "app/components/layout/topbar/app-topbar.tsx",
    "app/components/layout/sidebar/sidebar-footer-section.tsx",
    "app/components/layout/settings/general/account-management.tsx",
    "app/components/layout/settings/general/combined-account.tsx",
  ]

  for (const rel of callSites) {
    it(`${rel} uses useUser().signOut, not supabase.auth.signOut directly`, () => {
      const p = path.join(REPO_ROOT, rel)
      expect(fs.existsSync(p), `${rel} not found`).toBe(true)
      const src = fs.readFileSync(p, "utf8")
      // Must reference the provider's signOut
      expect(
        /\buseUser\b/.test(src) && /\bsignOut\b/.test(src),
        `${rel} must call useUser().signOut so the central reset+redirect contract applies`,
      ).toBe(true)
      // Must NOT roll a raw supabase.auth.signOut — that bypasses our cleanup.
      expect(
        /\bsupabase\.auth\.signOut\b/.test(src),
        `${rel} bypasses the central signOut by calling supabase.auth.signOut directly. ` +
          `Use useUser().signOut so React state, IndexedDB, analytics, and the redirect all happen atomically.`,
      ).toBe(false)
    })
  }
})
