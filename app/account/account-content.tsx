"use client"

import { useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { useAccountDialog, type AccountSectionType } from "@/lib/account-dialog-store"
import { LayoutApp } from "@/app/components/layout/layout-app"

// Mirrors validSections in account-dialog.tsx — Guide and Referral are
// intentionally excluded since they redirect rather than render inline.
const validSections: AccountSectionType[] = ["account", "billing", "privacy", "appearance", "data", "feedback", "about", "social", "memory", "public-chats"]

function AccountOpener() {
  const searchParams = useSearchParams()
  const { isOpen, _syncFromUrl } = useAccountDialog()

  useEffect(() => {
    if (!isOpen) {
      const sec = searchParams.get("section") as AccountSectionType | null
      // Save "/" as previous path so closing goes home
      useAccountDialog.setState({ _previousPath: "/" })
      _syncFromUrl(sec && validSections.includes(sec) ? sec : "account")
    }
  // Only run on mount and when searchParams change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  return null
}

export function AccountContent() {
  return (
    <LayoutApp>
      <AccountOpener />
    </LayoutApp>
  )
}
