import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"

const VALID_PACKAGES = ["boost-small", "boost-medium", "boost-large"]

export async function GET() {
  try {
    const supabase = await createClient()
    if (!supabase) {
      return NextResponse.json({ error: "Database connection error" }, { status: 500 })
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: settings } = await supabase
      .from("auto_refill_settings")
      .select("enabled, package_id, threshold, max_refills_per_day")
      .eq("user_id", user.id)
      .single()

    return NextResponse.json({
      enabled: settings?.enabled ?? false,
      package_id: settings?.package_id ?? "boost-small",
      threshold: settings?.threshold ?? 50,
      max_refills_per_day: settings?.max_refills_per_day ?? 5,
    })
  } catch (error) {
    console.error("Error fetching auto-refill settings:", error)
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    if (!supabase) {
      return NextResponse.json({ error: "Database connection error" }, { status: 500 })
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await req.json()
    const { enabled, package_id, threshold, max_refills_per_day } = body

    // Validate
    if (typeof enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 })
    }
    if (package_id && !VALID_PACKAGES.includes(package_id)) {
      return NextResponse.json({ error: "Invalid package_id" }, { status: 400 })
    }
    if (threshold !== undefined && (threshold < 10 || threshold > 500)) {
      return NextResponse.json({ error: "Threshold must be between 10 and 500" }, { status: 400 })
    }
    if (max_refills_per_day !== undefined && (max_refills_per_day < 1 || max_refills_per_day > 999)) {
      return NextResponse.json({ error: "Max refills per day must be between 1 and 999" }, { status: 400 })
    }

    // Check user has active subscription (required for auto-refill)
    const { data: subscription } = await (supabase as any)
      .from("user_subscriptions")
      .select("id, status")
      .eq("user_id", user.id)
      .eq("status", "active")
      .single()

    if (!subscription) {
      return NextResponse.json(
        { error: "Active subscription required for auto-refill" },
        { status: 403 }
      )
    }

    const updates = {
      user_id: user.id,
      enabled,
      package_id: package_id || "boost-small",
      threshold: threshold ?? 50,
      max_refills_per_day: max_refills_per_day ?? 5,
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from("auto_refill_settings")
      .upsert(updates, { onConflict: "user_id" })
      .select("enabled, package_id, threshold, max_refills_per_day")
      .single()

    if (error) {
      console.error("Error saving auto-refill settings:", error)
      return NextResponse.json({ error: "Failed to save settings" }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("Error updating auto-refill settings:", error)
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 })
  }
}
