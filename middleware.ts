import { updateSession } from "@/utils/supabase/middleware"
import { NextResponse, type NextRequest } from "next/server"
import { validateCsrfToken } from "./lib/csrf"
import { describeMode } from "./lib/oss-mode"
import { locales, defaultLocale, type Locale } from "./i18n/config"

// One-shot mode log: emit `[coasty] mode=oss|production` on the first
// middleware invocation of the process so operators can see at a glance which
// path their deployment is running. Subsequent requests skip this — flag is
// scoped to the module, so a `vi.resetModules()` in tests makes it fire again
// (each test gets a fresh log).
let _modeLogged = false

// Bot-scanner probe paths. Returning 200 (the Next.js default for unknown
// pages, which renders not-found.tsx) signals "live target" to mass scanners
// and keeps us on automated retry lists. Short-circuiting these with a real
// 404 before locale routing / Supabase session refresh removes us from those
// lists and saves the per-request auth round-trip. Patterns cover:
//   .env(.*)         leaked-secret probes (/.env, /.env.local, /backend/.env)
//   wp-<anything>    WordPress (/wp-admin, /wp-login.php, /wp-content/...)
//   .git/            exposed-repo probes (/.git/config, /.git/HEAD)
//   cgi-bin/         classic CGI shell probes
//   actuator/        Spring Boot endpoints (/actuator/env, /actuator/health)
//   phpmyadmin       DB admin probes (case-insensitive: /phpMyAdmin/)
//   adminer          DB admin probes (/adminer.php)
//   xmlrpc.php       WordPress pingback abuse
// Patterns anchor to `^` or `/` so they match path segments only — they
// won't accidentally hit a route like `/help-actuator-docs`.
const SCANNER_PROBE_RE =
  /(?:^|\/)(?:\.env[\w.-]*|wp-[\w.-]+|\.git(?:\/|$)|cgi-bin(?:\/|$)|actuator(?:\/|$)|phpmyadmin|adminer|xmlrpc\.php)/i

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
  // Boot-time mode log — once per process. Format is exactly
  // `[coasty] mode=oss` or `[coasty] mode=production` so log parsers can grep
  // for it cheaply. Tests rely on this exact format & one-shot semantics.
  if (!_modeLogged) {
    _modeLogged = true
    console.log(`[coasty] mode=${describeMode()}`)
  }

  // --- Per-request access logging: capture inputs at start ---
  // Capture cheap, sync facts up front so we can log even on early-return / throw.
  // Note: req.ip was removed in Next 15; rely on forwarding headers (Cloudflare, ALB).
  const t_start = performance.now()
  const method = request.method
  const path = request.nextUrl.pathname
  const ua = request.headers.get("user-agent")
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    ""

  // activeLocale is computed inside the try block but we need it visible to the
  // logger in `finally`. Default it to defaultLocale so the log line is well-typed
  // even if we throw before computing the real value.
  let activeLocale: Locale | string = defaultLocale
  let response: NextResponse

  try {
    // Bot-scanner short-circuit — must run BEFORE updateSession so we don't
    // pay the Supabase auth round-trip on probe traffic, and BEFORE locale
    // routing so we don't leak signal via Set-Cookie / Content-Language on a
    // 404 to a scanner. The finally block still logs the response for
    // security monitoring (see SCANNER_PROBE_RE comment above).
    if (SCANNER_PROBE_RE.test(path)) {
      response = new NextResponse(null, {
        status: 404,
        headers: {
          // Belt-and-suspenders against any CDN/proxy that might cache and
          // hide future probes from our access log.
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex, nofollow",
        },
      })
      return response
    }

    response = await updateSession(request)

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
    activeLocale = hlParam && locales.includes(hlParam as Locale)
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
        response = new NextResponse("Invalid CSRF token", { status: 403 })
        return response
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
  } finally {
    // --- Per-request access log: emit one JSON line per request to stdout ---
    // CloudWatch ingests Next.js standalone stdout line-by-line; one JSON object
    // per line is the friendliest format for Logs Insights.
    // Skip _next/* (static chunks) to keep ingestion volume bounded; the matcher
    // already excludes /api, favicon, common image extensions.
    if (!path.startsWith("/_next/") && path !== "/favicon.ico" && path !== "/robots.txt" && path !== "/sitemap.xml") {
      // Best-effort: never let a logging failure surface to the user.
      try {
        // `response!` is safe: either we assigned it before returning, or we
        // threw — in which case `finally` still runs but `response` may be
        // undefined. We narrow to handle that case.
        const status = (response! as NextResponse | undefined)?.status ?? 500
        console.log(JSON.stringify({
          type: "request",
          ts: new Date().toISOString(),
          method,
          path,
          status,
          duration_ms: Math.round(performance.now() - t_start),
          ua: ua?.substring(0, 200) ?? "",
          ip: ip ?? "",
          locale: activeLocale,
        }))
      } catch {
        // swallow logging errors; never break a real request
      }
    }
  }
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
