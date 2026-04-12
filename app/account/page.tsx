"use client"

import { useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { useAccountDialog, type AccountSectionType } from "@/lib/account-dialog-store"
import { LayoutApp } from "@/app/components/layout/layout-app"

const validSections: AccountSectionType[] = ["account", "billing", "privacy", "notifications", "appearance", "api-keys", "data", "feedback", "about", "social"]

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

export default function AccountPage() {
  return (
    <LayoutApp>
      <AccountOpener />
    </LayoutApp>
  )
}
