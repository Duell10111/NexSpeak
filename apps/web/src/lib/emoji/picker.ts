/** Helpers used only by the lazily mounted picker. No subscriptions or idle work. */
export type EmojiEntry = readonly [emoji: string, english: string, german: string, keywords: string, category: number]
export const COLUMNS = 8
export const ROW_HEIGHT = 40
export const VIEWPORT_HEIGHT = 240
export const FREQUENCY_KEY = "nexspeak:emoji-frequency"
export const TONE_KEY = "nexspeak:emoji-tone"
const MAX_FREQUENT = 32
export type Frequency = Record<string, number>

export function normalizeSearch(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[_:-]+/g, " ").trim()
}

export function emojiToneMask(emoji: string): number {
  let mask = 0
  for (const char of emoji) {
    const code = char.codePointAt(0)!
    if (code >= 0x1f3fb && code <= 0x1f3ff) mask |= 1 << (code - 0x1f3fb)
  }
  return mask
}

export function neutralEmoji(emoji: string): string {
  return emoji.replace(/[\u{1f3fb}-\u{1f3ff}\ufe0f]/gu, "")
}

export function buildSearchIndex(entries: readonly EmojiEntry[]) {
  const toned = new Set(entries.filter((entry) => emojiToneMask(entry[0])).map((entry) => neutralEmoji(entry[0])))
  return entries.map((entry) => ({ entry, search: normalizeSearch(entry.slice(0, 4).join(" ")), tone: emojiToneMask(entry[0]), hasTones: toned.has(neutralEmoji(entry[0])) }))
}

export function filterEmoji(index: ReturnType<typeof buildSearchIndex>, query: string, category: number | null, tone: number): EmojiEntry[] {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean)
  return index.filter(({ entry, search, tone: mask, hasTones }) => {
    if (category !== null && entry[4] !== category) return false
    if (!words.every((word) => search.includes(word))) return false
    // The all-tones choice also exposes every mixed-tone sequence.
    if (tone === 6) return true
    if (tone === 0) return mask === 0
    return mask ? Boolean(mask & (1 << (tone - 1))) : !hasTones
  }).map(({ entry }) => entry)
}

export function loadFrequency(): Frequency {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FREQUENCY_KEY) ?? "{}")
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([key, count]) => key.length < 100 && typeof count === "number" && Number.isFinite(count) && count > 0).slice(0, MAX_FREQUENT))
  } catch { return {} }
}

export function recordEmojiUse(emoji: string): void {
  const frequency = loadFrequency()
  const count = Math.min((frequency[emoji] ?? 0) + 1, 1_000_000)
  // Keep the current selection even when the bounded history is full, so new favorites can grow.
  delete frequency[emoji]
  const others = Object.entries(frequency).sort((a, b) => b[1] - a[1]).slice(0, MAX_FREQUENT - 1)
  const bounded = Object.fromEntries([[emoji, count], ...others])
  try { localStorage.setItem(FREQUENCY_KEY, JSON.stringify(bounded)) } catch { /* Storage is optional. */ }
}

export function visibleRowRange(scrollTop: number, rowCount: number): [number, number] {
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 1)
  return [start, Math.min(rowCount, start + Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + 3)]
}
