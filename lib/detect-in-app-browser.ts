/**
 * Detects in-app browsers (LinkedIn, Facebook, Instagram, etc.) that block
 * Google OAuth with 403: disallowed_useragent.
 *
 * Google's policy forbids OAuth in embedded WebViews for security reasons.
 * When detected, callers should offer alternative auth (magic link, email)
 * or prompt the user to open in their system browser.
 */
export function detectInAppBrowser(): { isInApp: boolean; appName: string | null } {
  if (typeof navigator === "undefined") return { isInApp: false, appName: null }
  const ua = navigator.userAgent || ""
  if (/LinkedInApp/i.test(ua)) return { isInApp: true, appName: "LinkedIn" }
  if (/FBAN|FBAV/i.test(ua)) return { isInApp: true, appName: "Facebook" }
  if (/Instagram/i.test(ua)) return { isInApp: true, appName: "Instagram" }
  if (/Twitter|TwitterAndroid/i.test(ua)) return { isInApp: true, appName: "Twitter" }
  if (/Snapchat/i.test(ua)) return { isInApp: true, appName: "Snapchat" }
  if (/MicroMessenger/i.test(ua)) return { isInApp: true, appName: "WeChat" }
  if (/Line\//i.test(ua)) return { isInApp: true, appName: "LINE" }
  // Generic WebView detection (Android WebView, iOS WKWebView without Safari)
  if (/; wv\)/i.test(ua)) return { isInApp: true, appName: null }
  if (/iPhone|iPad/.test(ua) && !/Safari/i.test(ua)) return { isInApp: true, appName: null }
  return { isInApp: false, appName: null }
}
