/**
 * Minimal localisation: two bundled dictionaries, a per-browser language choice and
 * `{name}` placeholders. Deliberately no library; the strings are all we need.
 */

import { de, type MessageKey } from './de'
import { en } from './en'

export type { MessageKey }
export type Locale = 'de' | 'en'
export type TranslationParams = Record<string, string | number>
export type Translate = (key: MessageKey, params?: TranslationParams) => string

export const LOCALES: readonly Locale[] = ['de', 'en']
/** Language names are shown in their own language, so everybody finds theirs. */
export const LOCALE_NAMES: Record<Locale, string> = { de: 'Deutsch', en: 'English' }
/** Rendered on the server and before hydration; the client switches right after. */
export const SERVER_LOCALE: Locale = 'de'

const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { de, en }
const STORAGE_KEY = 'nexspeak:locale'
const listeners = new Set<() => void>()
let current: Locale | null = null

function isLocale(value: unknown): value is Locale {
  return value === 'de' || value === 'en'
}

function detectLocale(): Locale {
  if (typeof window === 'undefined') return SERVER_LOCALE
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isLocale(stored)) return stored
  } catch {
    // Storage blocked: fall back to the browser language.
  }
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const language of preferred) {
    const base = language?.toLowerCase().split('-')[0]
    if (isLocale(base)) return base
  }
  return 'en'
}

export function getLocale(): Locale {
  current ??= detectLocale()
  return current
}

export function getServerLocale(): Locale {
  return SERVER_LOCALE
}

export function setLocale(locale: Locale): void {
  current = locale
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // Remembering the language is a convenience only.
  }
  if (typeof document !== 'undefined') document.documentElement.lang = locale
  listeners.forEach((listener) => listener())
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** BCP 47 tag for Intl formatting (dates, numbers). */
export function intlLocale(locale: Locale = getLocale()): string {
  return locale === 'de' ? 'de-DE' : 'en-US'
}

function format(template: string, params?: TranslationParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}

const translators = new Map<Locale, Translate>()

export function getTranslator(locale: Locale): Translate {
  let translator = translators.get(locale)
  if (!translator) {
    const dictionary = DICTIONARIES[locale]
    translator = (key, params) => format(dictionary[key] ?? de[key] ?? key, params)
    translators.set(locale, translator)
  }
  return translator
}

/**
 * Translate with the current language. For code outside React (errors, toasts); components
 * use `useTranslation()` so they re-render when the language changes.
 */
export const t: Translate = (key, params) => getTranslator(getLocale())(key, params)
