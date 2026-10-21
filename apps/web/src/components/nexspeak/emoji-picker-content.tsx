"use client"

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { Input } from "@/components/ui/input"
import { useTranslation } from "@/hooks/useTranslation"
import data from "@/lib/emoji/data.json"
import { buildSearchIndex, COLUMNS, filterEmoji, loadFrequency, normalizeSearch, recordEmojiUse, ROW_HEIGHT, TONE_KEY, VIEWPORT_HEIGHT, visibleRowRange, type EmojiEntry } from "@/lib/emoji/picker"
import type { EmojiPickerProps, PickerCustomEmoji } from "./emoji-picker"

const entries = data as unknown as EmojiEntry[]
const searchIndex = buildSearchIndex(entries)
const byEmoji = new Map(entries.map((entry) => [entry[0], entry]))
const DEFAULT_FREQUENT = ["👍", "👎", "❤️", "😂", "😮", "😢", "😡", "🎉", "🔥", "👀", "✅", "❌", "🙏", "💯", "🤔", "😅"]
const CATEGORY_KEYS = ["smileys", "people", "components", "nature", "food", "travel", "activities", "objects", "symbols", "flags"] as const
const TONE_KEYS = ["tone1", "tone2", "tone3", "tone4", "tone5"] as const
const CATEGORY_ICONS = ["😀", "👋", "🦰", "🐻", "🍔", "🚗", "⚽", "💡", "💯", "🏁"]
type Cell = { unicode: EmojiEntry } | { custom: PickerCustomEmoji }
type Row = { title: string } | { cells: Cell[]; first: number }

function savedTone(): number {
  try {
    const tone = Number(localStorage.getItem(TONE_KEY) ?? 0)
    return Number.isInteger(tone) && tone >= 0 && tone <= 6 ? tone : 0
  } catch { return 0 }
}

export default function EmojiPickerContent({ onSelect, customEmojis = [], onSelectCustom, renderCustomEmoji, onClose }: Omit<EmojiPickerProps, "children" | "onOpenChange"> & { onClose: () => void }) {
  const { t, locale } = useTranslation()
  const descriptionId = useId()
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("all")
  const [tone, setTone] = useState(savedTone)
  const [frequency] = useState(loadFrequency)
  const [scrollTop, setScrollTop] = useState(0)
  const viewport = useRef<HTMLDivElement>(null)
  const categoryTitle = (index: number) => t(`emojiPicker.${CATEGORY_KEYS[index]}`)

  const { rows, cellRows } = useMemo(() => {
    const result: Row[] = []
    const positions: number[] = []
    function section(title: string, cells: Cell[]) {
      if (!cells.length) return
      result.push({ title })
      for (let start = 0; start < cells.length; start += COLUMNS) {
        const chunk = cells.slice(start, start + COLUMNS)
        result.push({ cells: chunk, first: positions.length })
        positions.push(...chunk.map(() => result.length - 1))
      }
    }
    if ((category === "all" && !query.trim()) || category === "frequent") {
      const frequent = Object.keys(frequency).length ? Object.keys(frequency).sort((a, b) => frequency[b] - frequency[a]) : DEFAULT_FREQUENT
      const words = normalizeSearch(query).split(/\s+/).filter(Boolean)
      section(t("emojiPicker.frequent"), frequent.flatMap((emoji) => {
        const entry = byEmoji.get(emoji)
        return entry && words.every((word) => normalizeSearch(entry.slice(0, 4).join(" ")).includes(word)) ? [{ unicode: entry }] : []
      }))
    }
    if ((category === "all" || category === "server") && onSelectCustom) {
      const words = normalizeSearch(query).split(/\s+/).filter(Boolean)
      section(t("emojiPicker.server"), customEmojis.filter((emoji) => words.every((word) => normalizeSearch(emoji.name).includes(word))).map((custom) => ({ custom })))
    }
    if (category !== "frequent" && category !== "server") {
      const filtered = filterEmoji(searchIndex, query, category === "all" ? null : Number(category), tone)
      for (let index = 0; index < CATEGORY_KEYS.length; index++) {
        section(t(`emojiPicker.${CATEGORY_KEYS[index]}`), filtered.filter((entry) => entry[4] === index).map((unicode) => ({ unicode })))
      }
    }
    return { rows: result, cellRows: positions }
  }, [category, customEmojis, frequency, onSelectCustom, query, t, tone])

  function resetScroll() {
    setScrollTop(0)
    if (viewport.current) viewport.current.scrollTop = 0
  }
  function focusCell(index: number) {
    const target = Math.max(0, Math.min(cellRows.length - 1, index))
    const element = viewport.current
    if (!element || !cellRows.length) return
    const top = cellRows[target] * ROW_HEIGHT
    if (top < element.scrollTop || top + ROW_HEIGHT > element.scrollTop + VIEWPORT_HEIGHT) {
      element.scrollTop = top
      setScrollTop(top)
    }
    const selector = `[data-emoji-index="${target}"]`
    const button = element.querySelector<HTMLButtonElement>(selector)
    if (button) button.focus({ preventScroll: true })
    else requestAnimationFrame(() => element.querySelector<HTMLButtonElement>(selector)?.focus({ preventScroll: true }))
  }
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-emoji-index]")
    if (!target) return
    const current = Number(target.dataset.emojiIndex)
    const next = { ArrowRight: current + 1, ArrowLeft: current - 1, ArrowDown: current + COLUMNS, ArrowUp: current - COLUMNS, Home: 0, End: cellRows.length - 1 }[event.key]
    if (next === undefined) return
    event.preventDefault()
    focusCell(next)
  }
  const [first, last] = visibleRowRange(scrollTop, rows.length)

  return <div className="space-y-2">
    <Input autoFocus aria-label={t("emojiPicker.search")} placeholder={t("emojiPicker.search")} value={query} onChange={(event) => { setQuery(event.target.value); resetScroll() }} onKeyDown={(event) => {
      if (event.key === "ArrowDown") { event.preventDefault(); focusCell(0) }
    }} />
    <div className="flex gap-1">
      <select aria-label={t("emojiPicker.category")} value={category} onChange={(event) => { setCategory(event.target.value); resetScroll() }} className="h-8 min-w-0 flex-1 rounded border bg-popover px-1 text-xs">
        <option value="all">{t("emojiPicker.all")}</option>
        <option value="frequent">{t("emojiPicker.frequent")}</option>
        {!!customEmojis.length && onSelectCustom && <option value="server">{t("emojiPicker.server")}</option>}
        {CATEGORY_KEYS.map((key, index) => <option value={index} key={key}>{CATEGORY_ICONS[index]} {categoryTitle(index)}</option>)}
      </select>
      <select aria-label={t("emojiPicker.skinTone")} value={tone} onChange={(event) => {
        const next = Number(event.target.value)
        setTone(next)
        try { localStorage.setItem(TONE_KEY, String(next)) } catch { /* Storage is optional. */ }
        resetScroll()
      }} className="h-8 w-28 rounded border bg-popover px-1 text-xs">
        <option value="0">{t("emojiPicker.defaultTone")}</option>
        {["🏻", "🏼", "🏽", "🏾", "🏿"].map((emoji, index) => <option key={emoji} value={index + 1}>{emoji} {t(`emojiPicker.${TONE_KEYS[index]}`)}</option>)}
        <option value="6">{t("emojiPicker.allTones")}</option>
      </select>
    </div>
    <div ref={viewport} role="listbox" aria-label={t("chat.pickEmoji")} onKeyDown={navigate} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} className="overflow-y-auto overscroll-contain" style={{ height: VIEWPORT_HEIGHT }}>
      {!rows.length && <p role="status" className="p-3 text-sm text-muted-foreground">{t("emojiPicker.noResults")}</p>}
      <div style={{ height: rows.length * ROW_HEIGHT, position: "relative" }}>
        {rows.slice(first, last).map((row, offset) => {
          const index = first + offset
          return <div key={index} style={{ position: "absolute", top: index * ROW_HEIGHT, height: ROW_HEIGHT, width: "100%" }}>
            {"title" in row ? <div role="presentation" className="flex h-full items-center px-1 text-xs font-medium text-muted-foreground">{row.title}</div> : <div className="grid h-full grid-cols-8">
              {row.cells.map((cell, column) => {
                const unicode = "unicode" in cell ? cell.unicode : null
                const custom = "custom" in cell ? cell.custom : null
                const label = unicode ? unicode[0] : `:${custom!.name}:`
                const name = unicode ? unicode[locale === "de" ? 2 : 1] : custom!.name
                return <button key={column} type="button" data-emoji-index={row.first + column} role="option" aria-selected={false} aria-label={label} aria-describedby={`${descriptionId}-${row.first + column}`} title={name} className="flex h-10 min-w-0 items-center justify-center rounded text-xl hover:bg-muted focus-visible:bg-muted focus-visible:outline focus-visible:outline-ring" onClick={() => {
                  if (unicode) { recordEmojiUse(unicode[0]); onSelect(unicode[0]) }
                  else if (custom) onSelectCustom?.(custom)
                  onClose()
                }}><span id={`${descriptionId}-${row.first + column}`} className="sr-only">{name}</span>{unicode ? unicode[0] : renderCustomEmoji?.(custom!) ?? <span className="truncate text-xs">{label}</span>}</button>
              })}
            </div>}
          </div>
        })}
      </div>
    </div>
  </div>
}
