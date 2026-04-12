export const locales = [
  'en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'pl', 'ru', 'uk',
  'ja', 'ko', 'zh', 'ar', 'hi', 'th', 'vi', 'tr', 'id', 'sv',
  'da', 'no', 'fi', 'cs', 'ro', 'hu', 'el', 'he', 'ms', 'fil'
] as const

export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = 'en'

export const localeNames: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  pt: 'Português',
  it: 'Italiano',
  nl: 'Nederlands',
  pl: 'Polski',
  ru: 'Русский',
  uk: 'Українська',
  ja: '日本語',
  ko: '한국어',
  zh: '中文',
  ar: 'العربية',
  hi: 'हिन्दी',
  th: 'ไทย',
  vi: 'Tiếng Việt',
  tr: 'Türkçe',
  id: 'Bahasa Indonesia',
  sv: 'Svenska',
  da: 'Dansk',
  no: 'Norsk',
  fi: 'Suomi',
  cs: 'Čeština',
  ro: 'Română',
  hu: 'Magyar',
  el: 'Ελληνικά',
  he: 'עברית',
  ms: 'Bahasa Melayu',
  fil: 'Filipino',
}

// RTL languages
export const rtlLocales: Locale[] = ['ar', 'he']
