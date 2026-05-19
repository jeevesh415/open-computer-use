"use client"

/**
 * Top announcement banner — sits above the LandingHeader at the very top of
 * the page until the user dismisses it. Persists the dismissal in
 * localStorage so a closed banner doesn't reappear on subsequent visits.
 *
 * Two variants share identical chrome / heights / motion so the page
 * header math (`--top-banner-h`) doesn't need to care which is showing:
 *   • logged-out → OSWorld benchmark teaser, anchors to #benchmark
 *   • logged-in  → Unlimited plan promo, links to /account?section=billing
 * Each variant has its own dismissal key so a visitor who dismissed the
 * OSWorld banner still sees the Unlimited promo after signing in.
 *
 * Coordinates with the rest of the page via a CSS custom property
 * (`--top-banner-h`) on the document root: the LandingHeader reads this
 * value to position itself below the banner. When the banner is dismissed
 * or absent, the variable is `0` and the header sits at the top as usual.
 */

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { X } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { useUser } from "@/lib/user-store/provider"

type Variant = "logged-out" | "logged-in"

// Per-variant copy + destination + storage key. Heights, chrome, and
// motion are deliberately not in here — those are identical across
// variants so the header offset never jumps when the variant changes.
const VARIANTS: Record<
  Variant,
  {
    storageKey: string
    href: string
    pill: string
    title: string
    detail: string
    ariaLabel: string
  }
> = {
  "logged-out": {
    storageKey: "coasty.top-banner.osworld.v1",
    href: "#benchmark",
    pill: "New",
    title: "#1 Computer-Use Agent",
    detail: "82% OSWorld",
    ariaLabel: "Announcement: ranked #1 on OSWorld benchmark",
  },
  "logged-in": {
    storageKey: "coasty.top-banner.unlimited.v1",
    href: "/account?section=billing",
    pill: "New",
    title: "Go Unlimited",
    detail: "$249/mo, unlimited agent runs",
    ariaLabel: "Announcement: Unlimited plan now available for $249 a month",
  },
}

// Banner heights — kept in sync with the inline className below so the
// CSS var matches the rendered height exactly. Tailwind: h-9 = 36px,
// sm:h-10 = 40px.
const BANNER_H_MOBILE = 36
const BANNER_H_DESKTOP = 40

function readDismissed(key: string): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(key) === "1"
  } catch {
    return false
  }
}

function writeDismissed(key: string) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, "1")
  } catch {
    /* private mode / disabled storage — fail silently, banner won't persist */
  }
}

function setBannerCssVar(px: number) {
  if (typeof document === "undefined") return
  document.documentElement.style.setProperty("--top-banner-h", `${px}px`)
}

export function TopAnnouncementBanner() {
  // `user` is hydrated from the server-rendered profile passed into
  // UserProvider at the root layout, so its value is stable between SSR
  // and the first client paint — no hydration flicker between variants.
  const { user } = useUser()
  const variant: Variant = user ? "logged-in" : "logged-out"
  const config = VARIANTS[variant]

  // Three-state visibility:
  //   null    → SSR / pre-hydration, render nothing (avoids mismatch)
  //   true    → show banner
  //   false   → hide (already dismissed in a prior visit)
  const [visible, setVisible] = useState<boolean | null>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  // Re-check dismissed state whenever the variant changes — a signed-in
  // user gets a fresh look at the Unlimited promo even if they previously
  // dismissed the logged-out OSWorld teaser.
  useEffect(() => {
    setVisible(!readDismissed(config.storageKey))
  }, [config.storageKey])

  // Sync the CSS var with current viewport width + visibility. The header
  // reads this var via `top-[var(--top-banner-h,0px)]`.
  useEffect(() => {
    if (visible !== true) {
      setBannerCssVar(0)
      return
    }
    const apply = () =>
      setBannerCssVar(
        window.innerWidth >= 640 ? BANNER_H_DESKTOP : BANNER_H_MOBILE,
      )
    apply()
    window.addEventListener("resize", apply, { passive: true })
    return () => {
      window.removeEventListener("resize", apply)
      // Reset on unmount so a navigation away from this page doesn't leave
      // a phantom offset on the next route's header.
      setBannerCssVar(0)
    }
  }, [visible])

  // Allow Esc to dismiss while the banner has focus, and allow keyboard
  // users to reach the close button quickly with a clear focus ring.
  useEffect(() => {
    if (visible !== true) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && document.activeElement === closeBtnRef.current) {
        dismiss()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [visible])

  const dismiss = () => {
    writeDismissed(config.storageKey)
    setVisible(false)
  }

  return (
    <AnimatePresence initial={false}>
      {visible === true && (
        <motion.div
          // Keying by variant remounts the banner on auth change so the
          // enter animation plays for the new copy (rather than the old
          // content silently morphing into the new in place).
          key={`top-banner-${variant}`}
          initial={{ y: "-100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "-100%", opacity: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          role="region"
          aria-label={config.ariaLabel}
          className={cn(
            "fixed inset-x-0 top-0 z-[60]",
            "h-9 sm:h-10",
            "bg-foreground text-background",
            "border-b border-foreground/20",
          )}
        >
          {/* Subtle inner highlight along the top edge — keeps the banner
              feeling lifted rather than slabby across themes. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-background/25 to-transparent"
          />

          <div className="mx-auto flex h-full max-w-7xl items-center gap-2 px-3 sm:px-5 lg:px-8">
            {/* Invisible spacer matching the close button's footprint —
                keeps the centered claim visually balanced on the row
                without resorting to absolute positioning that could
                collide with the text on narrow viewports. */}
            <span aria-hidden="true" className="h-7 w-7 sm:h-8 sm:w-8 shrink-0" />

            {/* Centered claim — clickable. Logged-out routes to the
                OSWorld benchmark section on the landing page; logged-in
                routes to /account?section=billing so the account dialog
                opens directly on the billing tab. Truncates with ellipsis
                instead of wrapping so the banner stays exactly one row
                tall. */}
            <Link
              href={config.href}
              className={cn(
                "group flex min-w-0 flex-1 items-center justify-center gap-2 sm:gap-2.5",
                "text-[11px] sm:text-[12.5px] font-medium tracking-tight",
                "transition-opacity hover:opacity-85",
              )}
            >
              <span className="hidden sm:inline-flex h-[18px] shrink-0 items-center rounded-full bg-background/15 px-2 text-[10px] font-semibold uppercase tracking-[0.14em]">
                {config.pill}
              </span>
              <span className="truncate">
                <span className="font-semibold">{config.title}</span>
                <span aria-hidden="true" className="mx-1.5 sm:mx-2 opacity-50">
                  ·
                </span>
                <span className="font-medium tabular-nums">{config.detail}</span>
              </span>
              <span
                aria-hidden="true"
                className="hidden sm:inline shrink-0 text-[11px] opacity-50 transition-all group-hover:opacity-90 group-hover:translate-x-0.5"
              >
                →
              </span>
            </Link>

            {/* Close button — sized for comfortable touch targets, paired
                with the left spacer so the row reads as visually centred
                regardless of how long the claim text becomes. */}
            <button
              ref={closeBtnRef}
              onClick={dismiss}
              type="button"
              aria-label="Dismiss announcement"
              className={cn(
                "flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-full",
                "text-background/70 hover:text-background",
                "hover:bg-background/10 active:bg-background/15",
                "transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background/40",
              )}
            >
              <X className="h-3.5 w-3.5 sm:h-4 sm:w-4" strokeWidth={2.2} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
