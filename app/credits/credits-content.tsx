"use client"

import { useEffect } from "react"
import { useAccountDialog } from "@/lib/account-dialog-store"
import { LayoutApp } from "@/app/components/layout/layout-app"

function CreditsOpener() {
  const { isOpen, _syncFromUrl } = useAccountDialog()

  useEffect(() => {
    if (!isOpen) {
      useAccountDialog.setState({ _previousPath: "/" })
      _syncFromUrl("billing")
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}

export function CreditsContent() {
  return (
    <LayoutApp>
      <CreditsOpener />
    </LayoutApp>
  )
}
