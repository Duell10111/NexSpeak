'use client'

import { Fragment, useEffect, useSyncExternalStore, type ReactNode } from 'react'
import {
  getLocale,
  getServerLocale,
  getTranslator,
  intlLocale,
  setLocale,
  subscribeLocale,
  type Locale,
  type MessageKey,
  type Translate,
} from '@nexspeak/i18n'

export function useTranslation(): { t: Translate; locale: Locale; intl: string; setLocale: (locale: Locale) => void } {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getServerLocale)
  return { t: getTranslator(locale), locale, intl: intlLocale(locale), setLocale }
}

/**
 * Translation with React nodes in its placeholders, e.g. a bold name:
 * `<Trans k="chat.typingOne" values={{ name: <strong>Alice</strong> }} />`.
 */
export function Trans({ k, values }: { k: MessageKey; values: Record<string, ReactNode> }) {
  const { t } = useTranslation()
  // Keep the placeholders in the template, then swap them for the nodes.
  const template = t(k, Object.fromEntries(Object.keys(values).map((name) => [name, `{${name}}`])))
  const parts = template.split(/\{(\w+)\}/g)
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>{index % 2 === 1 ? (values[part] ?? `{${part}}`) : part}</Fragment>
      ))}
    </>
  )
}

/** Keeps <html lang> in sync with the chosen language (screen readers, hyphenation). */
export function DocumentLanguage() {
  const { locale } = useTranslation()
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  return null
}
