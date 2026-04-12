import { createClient } from "@/lib/supabase/server"
import { HomeClient } from "./home-client"
import { FAQSchema } from "./seo-schemas"
import { redirect } from "next/navigation"
import { getLocale } from "next-intl/server"

export const dynamic = "force-dynamic"

export default async function Home() {
  const locale = await getLocale()
  const supabase = await createClient()
  let isAuthenticated = false

  if (supabase) {
    const { data: { user } } = await supabase.auth.getUser()
    isAuthenticated = !!user

    // Redirect authenticated users who haven't completed onboarding
    if (user) {
      try {
        const { data: userData } = await supabase
          .from("users")
          .select("onboarding_completed")
          .eq("id", user.id)
          .single()

        if (userData && !userData.onboarding_completed) {
          redirect("/onboarding")
        }
      } catch (e) {
        // Re-throw redirect (Next.js throws NEXT_REDIRECT internally)
        if (e && typeof e === "object" && "digest" in e) throw e
        // Otherwise silently continue if check fails
      }
    }
  }

  return (
    <>
      <FAQSchema locale={locale} />
      <HomeClient isAuthenticated={isAuthenticated} />
    </>
  )
}
