import { decryptKey, encryptKey } from "@/lib/encryption"
import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { v4 as uuidv4 } from "uuid"

const CREDENTIAL_PREFIX = "credential:"

export async function GET() {
  try {
    const supabase = await createClient()
    if (!supabase) {
      return NextResponse.json({ error: "Supabase not available" }, { status: 500 })
    }

    const { data: authData } = await supabase.auth.getUser()
    if (!authData?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: rows, error } = await supabase
      .from("user_keys")
      .select("provider, encrypted_key, iv, created_at, updated_at")
      .eq("user_id", authData.user.id)
      .like("provider", `${CREDENTIAL_PREFIX}%`)
      .order("created_at", { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const secrets = (rows || []).flatMap((row: { provider: string; encrypted_key: string; iv: string; created_at: string; updated_at: string }) => {
      try {
        const id = row.provider.slice(CREDENTIAL_PREFIX.length)
        const json = decryptKey(row.encrypted_key, row.iv)
        const data = JSON.parse(json)
        return [{
          id,
          name: data.name,
          service: data.service,
          username: data.username,
          notes: data.notes,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }]
      } catch {
        return []
      }
    })

    return NextResponse.json({ secrets })
  } catch {
    return NextResponse.json({ error: "Server error occurred" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  let body: { name?: string; service?: string; username?: string; password?: string; notes?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  try {
    const { name, service, username, password, notes } = body

    if (!name || !service || !username || !password) {
      return NextResponse.json(
        { error: "name, service, username, and password are required" },
        { status: 400 }
      )
    }

    if (name.length > 200 || service.length > 500 || username.length > 500 || password.length > 1000 || (notes && notes.length > 2000)) {
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

    const id = uuidv4()
    const payload = JSON.stringify({ name, service: normalizeDomain(service), username, password, notes: notes || "" })
    const { encrypted, iv } = encryptKey(payload)

    const { error } = await supabase.from("user_keys").insert({
      user_id: authData.user.id,
      provider: `${CREDENTIAL_PREFIX}${id}`,
      encrypted_key: encrypted,
      iv,
      updated_at: new Date().toISOString(),
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, id })
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
