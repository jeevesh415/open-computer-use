import { decryptKey, encryptKey } from "@/lib/encryption"
import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

const CREDENTIAL_PREFIX = "credential:"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    if (!supabase) {
      return NextResponse.json({ error: "Supabase not available" }, { status: 500 })
    }

    const { data: authData } = await supabase.auth.getUser()
    if (!authData?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: row, error } = await supabase
      .from("user_keys")
      .select("encrypted_key, iv, created_at, updated_at")
      .eq("user_id", authData.user.id)
      .eq("provider", `${CREDENTIAL_PREFIX}${id}`)
      .single()

    if (error || !row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const json = decryptKey(row.encrypted_key, row.iv)
    const data = JSON.parse(json)

    return NextResponse.json({
      id,
      name: data.name,
      service: data.service,
      username: data.username,
      password: data.password,
      notes: data.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })
  } catch {
    return NextResponse.json({ error: "Server error occurred" }, { status: 500 })
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let body: { name?: string; service?: string; username?: string; password?: string; notes?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  try {
    const { id } = await params

    const { name, service, username, password, notes } = body
    if (
      (name && name.length > 200) ||
      (service && service.length > 500) ||
      (username && username.length > 500) ||
      (password && password.length > 1000) ||
      (notes && notes.length > 2000)
    ) {
      return NextResponse.json({ error: "Field too long" }, { status: 400 })
    }

    const supabase = await createClient()
    if (!supabase) {
      return NextResponse.json({ error: "Supabase not available" }, { status: 500 })
    }

    const { data: authData } = await supabase.auth.getUser()
    if (!authData?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Fetch existing to merge
    const { data: row, error: fetchError } = await supabase
      .from("user_keys")
      .select("encrypted_key, iv")
      .eq("user_id", authData.user.id)
      .eq("provider", `${CREDENTIAL_PREFIX}${id}`)
      .single()

    if (fetchError || !row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const existing = JSON.parse(decryptKey(row.encrypted_key, row.iv))
    const updated = {
      name: body.name ?? existing.name,
      service: body.service ? normalizeDomain(body.service) : existing.service,
      username: body.username ?? existing.username,
      password: body.password ?? existing.password,
      notes: body.notes !== undefined ? body.notes : existing.notes,
    }

    const { encrypted, iv } = encryptKey(JSON.stringify(updated))

    const { error } = await supabase
      .from("user_keys")
      .update({ encrypted_key: encrypted, iv, updated_at: new Date().toISOString() })
      .eq("user_id", authData.user.id)
      .eq("provider", `${CREDENTIAL_PREFIX}${id}`)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Server error occurred" }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    if (!supabase) {
      return NextResponse.json({ error: "Supabase not available" }, { status: 500 })
    }

    const { data: authData } = await supabase.auth.getUser()
    if (!authData?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { error } = await supabase
      .from("user_keys")
      .delete()
      .eq("user_id", authData.user.id)
      .eq("provider", `${CREDENTIAL_PREFIX}${id}`)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Server error occurred" }, { status: 500 })
  }
}

function normalizeDomain(input: string): string {
  try {
    const withProto = input.startsWith("http") ? input : `https://${input}`
    const url = new URL(withProto)
    return url.hostname.replace(/^www\./, "")
  } catch {
    return input.trim()
  }
}
