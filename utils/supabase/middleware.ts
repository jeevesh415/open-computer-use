import { isSupabaseEnabled } from "@/lib/supabase/config"
import { isOssMode } from "@/lib/oss-mode"
import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function updateSession(request: NextRequest) {
  // OSS-mode short-circuit. Self-host deployments do not have a Supabase
  // project — they talk straight to the public Coasty REST API with a single
  // COASTY_API_KEY. Calling `createServerClient` here would either throw on
  // missing env or hang on a network request to a non-existent project.
  //
  // SECURITY: This bypass is gated by `isOssMode()` (see `lib/oss-mode.ts` for
  // the resolution order). The auto-detect path requires
  // `NEXT_PUBLIC_SUPABASE_URL` to be UNSET, so a production deployment with
  // Supabase configured can never accidentally enter this branch. Auth
  // gating in OSS mode is the responsibility of the upstream
  // `validateCoastyApiKey` middleware on the API routes themselves.
  if (isOssMode()) {
    return NextResponse.next({ request })
  }

  if (!isSupabaseEnabled) {
    return NextResponse.next({
      request,
    })
  }

  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: any[]) {
          cookiesToSet.forEach(({ name, value }: any) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }: any) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Do not run code between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // IMPORTANT: DO NOT REMOVE auth.getUser()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Protected routes that require authentication (all app routes)
  const protectedPaths = [
    '/account',
    '/machines',
    '/c/',
    '/history',
    '/schedules',
    '/secrets',
    '/agent-labs',
    '/swarms',
    '/credits',
    '/billing',
    '/developers',
    '/referral',
    '/super-agents',
    '/goals',
    '/workspace',
    '/inbox',
  ]
  const isProtectedPath = protectedPaths.some(path =>
    request.nextUrl.pathname.startsWith(path)
  )

  if (!user && isProtectedPath) {
    // Redirect to auth page if not authenticated
    const url = request.nextUrl.clone()
    url.pathname = '/auth'
    url.searchParams.set('redirectTo', request.nextUrl.pathname)
    return NextResponse.redirect(url)
  }

  // Redirect authenticated users who haven't completed onboarding.
  // Skip for onboarding page itself, auth routes, API routes, and static assets.
  //
  // PERF (P1): the middleware runs on every page navigation.  Querying
  // `users.onboarding_completed` on every navigation was a hot path.  Once a
  // user completes onboarding the flag never flips back, so we cache the
  // "done" state in a long-lived first-party cookie (`coasty_onb=1`,
  // 30 days, httpOnly).  When the cookie is present we skip the DB round-trip
  // entirely — for the 99 %+ of authenticated traffic that's already
  // onboarded, this turns a ~50 ms Supabase query into a cookie read.
  const skipOnboardingCheck = ['/onboarding', '/auth', '/api/', '/_next/', '/favicon']
  const shouldCheckOnboarding = user && !skipOnboardingCheck.some(path =>
    request.nextUrl.pathname.startsWith(path)
  )

  if (shouldCheckOnboarding) {
    const onboardedCookie = request.cookies.get('coasty_onb')?.value
    if (onboardedCookie !== '1') {
      try {
        const { data: userData } = await supabase
          .from('users')
          .select('onboarding_completed')
          .eq('id', user.id)
          .single()

        if (userData && !userData.onboarding_completed) {
          const url = request.nextUrl.clone()
          url.pathname = '/onboarding'
          return NextResponse.redirect(url)
        }

        // Persist the "done" state — never query again until the cookie expires
        // or the user logs out (Supabase SSR clears auth cookies on sign-out;
        // we leave coasty_onb because it's also a no-op for fresh users).
        if (userData?.onboarding_completed) {
          supabaseResponse.cookies.set('coasty_onb', '1', {
            path: '/',
            maxAge: 30 * 24 * 60 * 60,
            sameSite: 'lax',
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
          })
        }
      } catch {
        // If onboarding check fails, don't block the user
      }
    }
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // If you're creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  return supabaseResponse
}
