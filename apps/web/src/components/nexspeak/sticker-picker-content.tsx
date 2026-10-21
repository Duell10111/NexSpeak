'use client'

import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Input } from '@/components/ui/input'
import { useTranslation } from '@/hooks/useTranslation'
import { useStickers } from '@/hooks/useStickers'
import { normalizeSearch } from '@/lib/emoji/picker'
import { StickerImage } from './sticker-image'
import type { Sticker } from '@nexspeak/core/matrix/custom-emojis'

const COLUMNS = 3
const ROW_HEIGHT = 92
const HEIGHT = ROW_HEIGHT * 3

export default function StickerPickerContent({ onSelect }: { onSelect: (sticker: Sticker) => void }) {
  const { t } = useTranslation()
  const stickers = useStickers(true)
  const [query, setQuery] = useState('')
  const [scroll, setScroll] = useState(0)
  const viewport = useRef<HTMLDivElement>(null)
  const searchable = useMemo(() => stickers.map((sticker) => normalizeSearch(`${sticker.name} ${sticker.body} ${sticker.packName}`)), [stickers])
  const filtered = useMemo(() => {
    const words = normalizeSearch(query).split(/\s+/).filter(Boolean)
    return stickers.filter((_, index) => words.every((word) => searchable[index].includes(word)))
  }, [stickers, searchable, query])
  const first = Math.max(0, Math.floor(scroll / ROW_HEIGHT) - 1) * COLUMNS
  const last = Math.min(filtered.length, (Math.ceil((scroll + HEIGHT) / ROW_HEIGHT) + 1) * COLUMNS)
  function focus(index: number) {
    const element = viewport.current
    if (!element || !filtered.length) return
    const target = Math.max(0, Math.min(filtered.length - 1, index))
    const top = Math.floor(target / COLUMNS) * ROW_HEIGHT
    if (top < element.scrollTop || top + ROW_HEIGHT > element.scrollTop + HEIGHT) {
      element.scrollTop = top
      setScroll(top)
    }
    const selector = `[data-sticker-index="${target}"]`
    const button = element.querySelector<HTMLButtonElement>(selector)
    if (button) button.focus({ preventScroll: true })
    else requestAnimationFrame(() => element.querySelector<HTMLButtonElement>(selector)?.focus({ preventScroll: true }))
  }
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-sticker-index]')
    if (!target) return
    const index = Number(target.dataset.stickerIndex)
    const next = { ArrowLeft: index - 1, ArrowRight: index + 1, ArrowUp: index - COLUMNS, ArrowDown: index + COLUMNS, Home: 0, End: filtered.length - 1 }[event.key]
    if (next === undefined) return
    event.preventDefault()
    focus(next)
  }
  return <div className="space-y-2">
    <Input autoFocus aria-label={t('sticker.search')} placeholder={t('sticker.search')} value={query} onChange={(event) => {
      setQuery(event.target.value); setScroll(0)
      if (viewport.current) viewport.current.scrollTop = 0
    }} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); focus(0) } }} />
    <div ref={viewport} role="listbox" aria-label={t('sticker.picker')} onKeyDown={navigate} onScroll={(event) => setScroll(event.currentTarget.scrollTop)} className="overflow-y-auto overscroll-contain" style={{ height: HEIGHT }}>
      {!filtered.length && <p role="status" className="p-3 text-sm text-muted-foreground">{t('sticker.empty')}</p>}
      <div className="relative" style={{ height: Math.ceil(filtered.length / COLUMNS) * ROW_HEIGHT }}>
        {filtered.slice(first, last).map((sticker, offset) => {
          const index = first + offset
          return <button key={`${sticker.packId}:${sticker.name}`} type="button" role="option" aria-selected={false} aria-label={sticker.name}
            title={[sticker.body, sticker.packName].filter(Boolean).join(' · ')} data-sticker-index={index}
            onClick={() => onSelect(sticker)} className="absolute flex flex-col items-center justify-center rounded hover:bg-muted focus-visible:outline focus-visible:outline-ring"
            style={{ top: Math.floor(index / COLUMNS) * ROW_HEIGHT, left: `${index % COLUMNS * 100 / COLUMNS}%`, width: `${100 / COLUMNS}%`, height: ROW_HEIGHT }}>
            <StickerImage mxc={sticker.url} name={sticker.body} size={64} />
            <span className="w-full truncate px-1 text-xs">{sticker.name}</span>
          </button>
        })}
      </div>
    </div>
  </div>
}
