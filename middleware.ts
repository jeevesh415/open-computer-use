import { updateSession } from "@/utils/supabase/middleware"
import { NextResponse, type NextRequest } from "next/server"
import { validateCsrfToken } from "./lib/csrf"
import { locales, defaultLocale, type Locale } from "./i18n/config"

function detectLocaleFromHeader(request: NextRequest): Locale {
  const acceptLanguage = request.headers.get("accept-language")
  if (!acceptLanguage) return defaultLocale

  const preferred = acceptLanguage
    .split(",")
    .map((part) => {
      const [lang, q] = part.trim().split(";q=")
      return { lang: lang.trim().split("-")[0].toLowerCase(), q: q ? parseFloat(q) : 1 }
    })
    .sort((a, b) => b.q - a.q)

  for (const { lang } of preferred) {
    if (locales.includes(lang as Locale)) {
      return lang as Locale
    }
  }
  return defaultLocale
}

export async function middleware(request: NextRequest) {
  const response = await updateSession(request)

  // Support ?hl=xx parameter for search engine crawlers (hreflang support)
  const hlParam = request.nextUrl.searchParams.get("hl")
  if (hlParam && locales.includes(hlParam as Locale)) {
    response.cookies.set("NEXT_LOCALE", hlParam, {
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
      sameSite: "lax",
    })
  }

  // Auto-detect locale from Accept-Language if no cookie is set
  if (!request.cookies.get("NEXT_LOCALE")?.value && !hlParam) {
    const detected = detectLocaleFromHeader(request)
    if (detected !== defaultLocale) {
      response.cookies.set("NEXT_LOCALE", detected, {
        path: "/",
        maxAge: 365 * 24 * 60 * 60, // 1 year
        sameSite: "lax",
      })
    }
  }

  // Determine active locale for headers
  const activeLocale = hlParam && locales.includes(hlParam as Locale)
    ? hlParam
    : request.cookies.get("NEXT_LOCALE")?.value || defaultLocale

  // Content-Language and Vary headers for SEO
  response.headers.set("Content-Language", activeLocale)
  response.headers.set("Vary", "Accept-Language, Cookie")

  // CSRF protection for state-changing requests
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    const csrfCookie = request.cookies.get("csrf_token")?.value
    const headerToken = request.headers.get("x-csrf-token")

    if (!csrfCookie || !headerToken || !(await validateCsrfToken(headerToken))) {
      return new NextResponse("Invalid CSRF token", { status: 403 })
    }
  }

  // CSP for development and production
  const isDev = process.env.NODE_ENV === "development"

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseDomain = supabaseUrl ? new URL(supabaseUrl).origin : ""

  response.headers.set(
    "Content-Security-Policy",
    isDev
      ? `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://us-assets.i.posthog.com; frame-src 'self' https://www.youtube-nocookie.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; connect-src 'self' wss: https://api.openai.com https://api.mistral.ai https://api.supabase.com ${supabaseDomain} https://us.i.posthog.com https://us-assets.i.posthog.com https://api.github.com;`
      : `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://analytics.umami.is https://us-assets.i.posthog.com https://vercel.live; frame-src 'self' https://vercel.live https://www.youtube-nocookie.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; connect-src 'self' wss: https://api.openai.com https://api.mistral.ai https://api.supabase.com ${supabaseDomain} https://api-gateway.umami.dev https://us.i.posthog.com https://us-assets.i.posthog.com https://api.github.com;`
  )

  // Security headers
  response.headers.set("X-Frame-Options", "SAMEORIGIN")
  response.headers.set("X-Content-Type-Options", "nosniff")
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
  if (!isDev) {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
  }

  return response
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
