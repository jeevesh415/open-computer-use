import { NextRequest, NextResponse } from "next/server"
import { locales, type Locale } from "@/i18n/config"

export async function POST(request: NextRequest) {
  let body: { locale?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const { locale } = body

  if (!locale || !locales.includes(locale as Locale)) {
    return NextResponse.json({ error: "Invalid locale" }, { status: 400 })
  }

  const response = NextResponse.json({ locale })
  response.cookies.set("NEXT_LOCALE", locale, {
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
    sameSite: "lax",
  })

  return response
}
