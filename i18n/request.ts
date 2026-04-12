import { getRequestConfig } from 'next-intl/server'
import { cookies, headers } from 'next/headers'
import { defaultLocale, locales, type Locale } from './config'

// Explicit message loaders so webpack can statically analyze the imports
const messageLoaders: Record<Locale, () => Promise<Record<string, unknown>>> = {
  en: () => import('../messages/en.json').then(m => m.default),
  es: () => import('../messages/es.json').then(m => m.default),
  fr: () => import('../messages/fr.json').then(m => m.default),
  de: () => import('../messages/de.json').then(m => m.default),
  pt: () => import('../messages/pt.json').then(m => m.default),
  it: () => import('../messages/it.json').then(m => m.default),
  nl: () => import('../messages/nl.json').then(m => m.default),
  pl: () => import('../messages/pl.json').then(m => m.default),
  ru: () => import('../messages/ru.json').then(m => m.default),
  uk: () => import('../messages/uk.json').then(m => m.default),
  ja: () => import('../messages/ja.json').then(m => m.default),
  ko: () => import('../messages/ko.json').then(m => m.default),
  zh: () => import('../messages/zh.json').then(m => m.default),
  ar: () => import('../messages/ar.json').then(m => m.default),
  hi: () => import('../messages/hi.json').then(m => m.default),
  th: () => import('../messages/th.json').then(m => m.default),
  vi: () => import('../messages/vi.json').then(m => m.default),
  tr: () => import('../messages/tr.json').then(m => m.default),
  id: () => import('../messages/id.json').then(m => m.default),
  sv: () => import('../messages/sv.json').then(m => m.default),
  da: () => import('../messages/da.json').then(m => m.default),
  no: () => import('../messages/no.json').then(m => m.default),
  fi: () => import('../messages/fi.json').then(m => m.default),
  cs: () => import('../messages/cs.json').then(m => m.default),
  ro: () => import('../messages/ro.json').then(m => m.default),
  hu: () => import('../messages/hu.json').then(m => m.default),
  el: () => import('../messages/el.json').then(m => m.default),
  he: () => import('../messages/he.json').then(m => m.default),
  ms: () => import('../messages/ms.json').then(m => m.default),
  fil: () => import('../messages/fil.json').then(m => m.default),
}

async function loadMessages(locale: Locale) {
  const loader = messageLoaders[locale] ?? messageLoaders[defaultLocale]
  return loader()
}

function detectLocale(cookieValue?: string, acceptLanguage?: string | null): Locale {
  // 1. Cookie (user's explicit choice)
  if (cookieValue && locales.includes(cookieValue as Locale)) {
    return cookieValue as Locale
  }

  // 2. Accept-Language header
  if (acceptLanguage) {
    const preferred = acceptLanguage
      .split(',')
      .map((part) => {
        const [lang, q] = part.trim().split(';q=')
        return { lang: lang.trim().split('-')[0].toLowerCase(), q: q ? parseFloat(q) : 1 }
      })
      .sort((a, b) => b.q - a.q)

    for (const { lang } of preferred) {
      if (locales.includes(lang as Locale)) {
        return lang as Locale
      }
    }
  }

  return defaultLocale
}

export default getRequestConfig(async () => {
  let cookieValue: string | undefined
  let acceptLanguage: string | null = null

  try {
    const cookieStore = await cookies()
    cookieValue = cookieStore.get('NEXT_LOCALE')?.value
  } catch {
    // cookies() can throw during static rendering
  }

  try {
    const headerStore = await headers()
    acceptLanguage = headerStore.get('accept-language')
  } catch {
    // headers() can throw during static rendering
  }

  const locale = detectLocale(cookieValue, acceptLanguage)

  return {
    locale,
    messages: await loadMessages(locale),
  }
})
