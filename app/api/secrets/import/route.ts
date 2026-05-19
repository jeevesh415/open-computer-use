import { encryptKey } from "@/lib/encryption"
import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { v4 as uuidv4 } from "uuid"
import type { CreateSecretRequest, ImportResult } from "@/types/secrets.types"

const CREDENTIAL_PREFIX = "credential:"
const MAX_IMPORT = 500

function normalizeDomain(input: string): string {
  try {
    const withProto = input.startsWith("http") ? input : `https://${input}`
    const url = new URL(withProto)
    return url.hostname.replace(/^www\./, "")
  } catch {
    return input.trim()
  }
}

function validateCredential(cred: CreateSecretRequest): string | null {
  if (!cred.name || !cred.service || !cred.username || !cred.password) {
    return "Missing required fields"
  }
  if (cred.name.length > 200) return "Name too long"
  if (cred.service.length > 500) return "Service too long"
  if (cred.username.length > 500) return "Username too long"
  if (cred.password.length > 1000) return "Password too long"
  if (cred.notes && cred.notes.length > 2000) return "Notes too long"
  return null
}

export async function POST(request: Request) {
  let body: { credentials?: CreateSecretRequest[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  try {
    const credentials: CreateSecretRequest[] = body.credentials as CreateSecretRequest[]

    if (!Array.isArray(credentials) || credentials.length === 0) {
      return NextResponse.json({ error: "No credentials provided" }, { status: 400 })
    }

    if (credentials.length > MAX_IMPORT) {
      return NextResponse.json(
        { error: `Maximum ${MAX_IMPORT} credentials per import` },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    if (!supabase) {
      return NextResponse.json({ error: "Supabase not available" }, { status: 500 })
    }

    const { data: authData } = await supabase.auth.getUser()
    if (!authData?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = authData.user.id
    let imported = 0
    let skipped = 0
    const errors: string[] = []

    for (let i = 0; i < credentials.length; i++) {
      const cred = credentials[i]
      const validationError = validateCredential(cred)

      if (validationError) {
        skipped++
        errors.push(`Row ${i + 1}: ${validationError}`)
        continue
      }

      try {
        const id = uuidv4()
        const payload = JSON.stringify({
          name: cred.name,
          service: normalizeDomain(cred.service),
          username: cred.username,
          password: cred.password,
          notes: cred.notes || "",
        })
        const { encrypted, iv } = encryptKey(payload)

        const { error } = await supabase.from("user_keys").insert({
          user_id: userId,
          provider: `${CREDENTIAL_PREFIX}${id}`,
          encrypted_key: encrypted,
          iv,
          updated_at: new Date().toISOString(),
        })

        if (error) {
          skipped++
          errors.push(`Row ${i + 1}: ${error.message}`)
        } else {
          imported++
        }
      } catch {
        skipped++
        errors.push(`Row ${i + 1}: Encryption or insert failed`)
      }
    }

    const result: ImportResult = { imported, skipped, errors }
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: "Server error occurred" }, { status: 500 })
  }
}
