"use client"

import { Switch } from "@/components/ui/switch"
import { useUserPreferences } from "@/lib/user-preference-store/provider"
import { cn } from "@/lib/utils"
import { Wrench, MessageSquareText, Sparkles, Columns2 } from "lucide-react"

interface PreferenceRowProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  isLast?: boolean
}

function PreferenceRow({ icon: Icon, label, description, checked, onCheckedChange, isLast }: PreferenceRowProps) {
  return (
    <div className={cn(
      "flex items-center gap-3.5 px-4 py-3.5",
      !isLast && "border-b border-border/15"
    )}>
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/[0.04] shrink-0">
        <Icon className="h-3.5 w-3.5 text-muted-foreground/40" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-foreground leading-tight">{label}</p>
        <p className="text-[11px] text-muted-foreground/40 mt-0.5 leading-relaxed">{description}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </div>
  )
}

export function PreferencesSection() {
  const {
    preferences,
    setShowToolInvocations,
    setShowConversationPreviews,
    setPromptSuggestions,
    setMultiModelEnabled,
  } = useUserPreferences()

  return (
    <div className="rounded-xl border border-border/30 bg-card/20 overflow-hidden">
      <PreferenceRow
        icon={Wrench}
        label="Tool invocations"
        description="Show tool execution details in conversations"
        checked={preferences.showToolInvocations}
        onCheckedChange={setShowToolInvocations}
      />
      <PreferenceRow
        icon={MessageSquareText}
        label="Conversation previews"
        description="Show message previews in the chat history sidebar"
        checked={preferences.showConversationPreviews}
        onCheckedChange={setShowConversationPreviews}
      />
      <PreferenceRow
        icon={Sparkles}
        label="Prompt suggestions"
        description="Show suggested prompts when starting a new conversation"
        checked={preferences.promptSuggestions}
        onCheckedChange={setPromptSuggestions}
      />
      <PreferenceRow
        icon={Columns2}
        label="Multi-model mode"
        description="Compare responses from multiple models side by side"
        checked={preferences.multiModelEnabled}
        onCheckedChange={setMultiModelEnabled}
        isLast
      />
    </div>
  )
}
