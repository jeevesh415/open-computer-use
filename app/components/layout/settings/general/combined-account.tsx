"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/toast"
import { useUser } from "@/lib/user-store/provider"
import { SignOut, Envelope, CalendarBlank, Spinner } from "@phosphor-icons/react"
import { CoastyIcon } from "@/components/icons/coasty"
import { Building2, Globe, User, Check, Camera, Shield } from "lucide-react"
import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"

const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, delay, ease: [0.22, 1, 0.36, 1] as const },
})

export function CombinedAccount() {
  const t = useTranslations("accountSettings")
  const { user, signOut, updateUser, isLoading } = useUser()

  const [displayName, setDisplayName] = useState("")
  const [company, setCompany] = useState("")
  const [website, setWebsite] = useState("")
  const [hasChanges, setHasChanges] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name || "")
      setCompany(user.company || "")
      setWebsite(user.website || "")
    }
  }, [user])

  useEffect(() => {
    if (!user) return
    const changed =
      displayName !== (user.display_name || "") ||
      company !== (user.company || "") ||
      website !== (user.website || "")
    setHasChanges(changed)
  }, [displayName, company, website, user])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await updateUser({
        display_name: displayName.trim() || null,
        company: company.trim() || null,
        website: website.trim() || null,
      } as any)
      setHasChanges(false)
      toast({ title: t("toasts.profileUpdated"), status: "success" })
    } catch {
      toast({ title: t("toasts.profileUpdateFailed"), status: "error" })
    } finally {
      setIsSaving(false)
    }
  }

  const handleSignOut = async () => {
    // signOut() (in user-store/provider) now does the full reset + redirect to /
    // atomically. Cleanup of chats/messages/IndexedDB and the route push are
    // all owned by the provider, so this stays a thin wrapper.
    try {
      await signOut()
    } catch (e) {
      console.error("Sign out failed:", e)
      toast({ title: t("toasts.signOutFailed"), status: "error" })
    }
  }

  if (!user) return null

  const memberSince = user.created_at
    ? new Date(user.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : null

  return (
    <div className="space-y-8">

      {/* ─── Profile Card ────────────────────────────────────────────── */}
      <motion.div {...fadeUp(0)} className="rounded-xl border border-border/30 bg-card/20 overflow-hidden">
        <div className="px-5 py-5">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <div className="h-14 w-14 rounded-xl border border-border/30 bg-muted/40 overflow-hidden flex items-center justify-center">
                {user?.profile_image ? (
                  <Avatar className="h-full w-full rounded-none">
                    <AvatarImage src={user.profile_image} className="object-cover" />
                    <AvatarFallback className="bg-transparent rounded-none">
                      <CoastyIcon className="h-6 w-6 text-foreground/30" />
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <CoastyIcon className="h-6 w-6 text-foreground/30" />
                )}
              </div>
              <div className="absolute inset-0 rounded-xl bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center sm:opacity-0 sm:group-hover:opacity-100 cursor-pointer">
                <Camera className="h-4 w-4 text-white drop-shadow" />
              </div>
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold truncate">
                {user?.display_name || user?.email?.split("@")[0] || "User"}
              </h3>
              <div className="flex items-center gap-3 mt-0.5">
                <div className="flex items-center gap-1 text-muted-foreground/50">
                  <Envelope className="h-3 w-3" />
                  <span className="text-xs truncate">{user?.email}</span>
                </div>
                {memberSince && (
                  <div className="flex items-center gap-1 text-muted-foreground/40">
                    <CalendarBlank className="h-3 w-3" />
                    <span className="text-[11px]">{memberSince}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ─── Edit Profile ────────────────────────────────────────────── */}
      <motion.div {...fadeUp(0.1)} className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-foreground/[0.04] flex items-center justify-center">
            <User className="h-3 w-3 text-muted-foreground/50" />
          </div>
          <h3 className="text-sm font-semibold">{t("profileDetails")}</h3>
        </div>

        <div className="rounded-xl border border-border/30 bg-card/20 p-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="account-name" className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider">
              {t("displayName")}
            </Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/30" />
              <Input
                id="account-name"
                type="text"
                placeholder={t("namePlaceholder")}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="h-10 rounded-lg bg-background/50 pl-9 text-sm border-border/40 focus:border-primary/30 transition-colors"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="account-company" className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider">
                {t("company")}
              </Label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/30" />
                <Input
                  id="account-company"
                  type="text"
                  placeholder={t("companyPlaceholder")}
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  className="h-10 rounded-lg bg-background/50 pl-9 text-sm border-border/40 focus:border-primary/30 transition-colors"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="account-website" className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider">
                {t("website")}
              </Label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/30" />
                <Input
                  id="account-website"
                  type="text"
                  placeholder={t("websitePlaceholder")}
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  className="h-10 rounded-lg bg-background/50 pl-9 text-sm border-border/40 focus:border-primary/30 transition-colors"
                />
              </div>
            </div>
          </div>

          {hasChanges && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="flex justify-end pt-1"
            >
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isSaving || isLoading}
                className="rounded-lg gap-1.5 px-4"
              >
                {isSaving ? (
                  <>
                    <Spinner className="h-3.5 w-3.5 animate-spin" />
                    {t("saving")}
                  </>
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    {t("saveChanges")}
                  </>
                )}
              </Button>
            </motion.div>
          )}
        </div>
      </motion.div>

      {/* ─── Account Actions ─────────────────────────────────────────── */}
      <motion.div {...fadeUp(0.2)} className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-foreground/[0.04] flex items-center justify-center">
            <Shield className="h-3 w-3 text-muted-foreground/50" />
          </div>
          <h3 className="text-sm font-semibold">{t("account")}</h3>
        </div>

        <div className="rounded-xl border border-border/30 bg-card/20 divide-y divide-border/20">
          {/* Email row */}
          <div className="flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-muted/50 flex items-center justify-center">
                <Envelope className="h-3.5 w-3.5 text-muted-foreground/50" />
              </div>
              <div>
                <p className="text-sm font-medium">{t("email")}</p>
                <p className="text-xs text-muted-foreground/50">{user?.email}</p>
              </div>
            </div>
            <span className="text-[10px] font-medium text-muted-foreground/30 uppercase tracking-wider">{t("verified")}</span>
          </div>

          {/* Sign out row */}
          <div className="flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-muted/50 flex items-center justify-center">
                <SignOut className="h-3.5 w-3.5 text-muted-foreground/50" />
              </div>
              <div>
                <p className="text-sm font-medium">{t("signOut")}</p>
                <p className="text-xs text-muted-foreground/50">{t("signOutDescription")}</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg text-xs"
              onClick={handleSignOut}
            >
              {t("signOut")}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
