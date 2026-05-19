import { createClient } from "@/lib/supabase/server"
import { isOssMode } from "@/lib/oss-mode"
import { redirect } from "next/navigation"
import { OnboardingFlow } from "./onboarding-flow"

export const dynamic = "force-dynamic"

export default async function OnboardingPage() {
  // OSS mode has no real user/account flow — short-circuit straight back to
  // the chat surface instead of trying to render an onboarding wizard that
  // assumes Supabase is wired in.
  if (isOssMode()) {
    redirect("/")
  }

  const supabase = await createClient()

  if (!supabase) {
    redirect("/auth")
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth")
  }

  // Check if user already completed onboarding
  const { data: userData } = await supabase
    .from("users")
    .select("onboarding_completed, display_name, created_at, role, company, website, team_size, referral_source, use_case")
    .eq("id", user.id)
    .single()

  if (userData?.onboarding_completed) {
    redirect("/")
  }

  // Determine if this is an existing user (created before onboarding was added)
  // If they have message_count > 0 or created_at is more than 5 minutes ago, they're existing
  const createdAt = userData?.created_at ? new Date(userData.created_at) : null
  const isExistingUser = createdAt
    ? Date.now() - createdAt.getTime() > 5 * 60 * 1000
    : false

  const initialName =
    user.user_metadata?.name ||
    user.user_metadata?.full_name ||
    userData?.display_name ||
    ""

  const initialEmail = user.email || ""

  return (
    <OnboardingFlow
      userId={user.id}
      initialName={initialName}
      initialEmail={initialEmail}
      isExistingUser={isExistingUser}
      existingData={{
        role: userData?.role || "",
        company: userData?.company || "",
        website: userData?.website || "",
        team_size: userData?.team_size || "",
        referral_source: userData?.referral_source || "",
        use_case: userData?.use_case || "",
      }}
    />
  )
}
