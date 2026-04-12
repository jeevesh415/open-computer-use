"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/toast"
import { useUser } from "@/lib/user-store/provider"
import { CoastyIcon } from "@/components/icons/coasty"
import { Building2, Globe, User, Check } from "lucide-react"
import { useState, useEffect } from "react"

export function UserProfile() {
  const { user, updateUser, isLoading } = useUser()
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

  if (!user) return null

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await updateUser({
        display_name: displayName.trim() || null,
        company: company.trim() || null,
        website: website.trim() || null,
      } as any)
      setHasChanges(false)
      toast({ title: "Profile updated", status: "success" })
    } catch {
      toast({ title: "Failed to update profile", status: "error" })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div>
      <h3 className="mb-3 text-sm font-medium">Profile</h3>
      <div className="flex items-center space-x-4 mb-4">
        <div className="bg-muted flex items-center justify-center overflow-hidden rounded-full">
          {user?.profile_image ? (
            <Avatar className="size-12">
              <AvatarImage src={user.profile_image} className="object-cover" />
              <AvatarFallback className="bg-transparent">
                <CoastyIcon className="size-6 text-primary" />
              </AvatarFallback>
            </Avatar>
          ) : (
            <CoastyIcon className="size-8 text-primary" />
          )}
        </div>
        <div>
          <h4 className="text-sm font-medium">{user?.display_name}</h4>
          <p className="text-muted-foreground text-sm">{user?.email}</p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="settings-name" className="text-xs font-medium text-muted-foreground">
            Name
          </Label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/40" />
            <Input
              id="settings-name"
              type="text"
              placeholder="Your name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="h-9 rounded-lg bg-background/50 pl-10 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="settings-company" className="text-xs font-medium text-muted-foreground">
              Company
            </Label>
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/40" />
              <Input
                id="settings-company"
                type="text"
                placeholder="Your company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="h-9 rounded-lg bg-background/50 pl-10 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="settings-website" className="text-xs font-medium text-muted-foreground">
              Website
            </Label>
            <div className="relative">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/40" />
              <Input
                id="settings-website"
                type="text"
                placeholder="yoursite.com"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                className="h-9 rounded-lg bg-background/50 pl-10 text-sm"
              />
            </div>
          </div>
        </div>

        {hasChanges && (
          <div className="flex justify-end pt-1">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving || isLoading}
              className="flex items-center gap-1.5"
            >
              <Check className="size-3.5" />
              {isSaving ? "Saving..." : "Save changes"}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
