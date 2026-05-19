"use client"

import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import { useUser } from "@/lib/user-store/provider"
import { SignOut } from "@phosphor-icons/react"

export function AccountManagement() {
  const { signOut } = useUser()

  // signOut() (in user-store/provider) now does the full reset + redirect to /
  // atomically — no need to manually reset chats / IndexedDB / push the route
  // here. Keeping this as a thin wrapper for the toast-on-failure path; the
  // redirect path won't reach the catch because the page unloads first.
  const handleSignOut = async () => {
    try {
      await signOut()
    } catch (e) {
      console.error("Sign out failed:", e)
      toast({ title: "Failed to sign out", status: "error" })
    }
  }

  return (
    <div className="flex items-center justify-between">
      <div>
        <h3 className="text-sm font-medium">Account</h3>
        <p className="text-muted-foreground text-xs">Log out on this device</p>
      </div>
      <Button
        variant="default"
        size="sm"
        className="flex items-center gap-2"
        onClick={handleSignOut}
      >
        <SignOut className="size-4" />
        <span>Sign out</span>
      </Button>
    </div>
  )
}
