/**
 * GIF preferences, persisted per browser. Search is opt-in because it sends search terms and the
 * IP address to the GIF provider; playback only affects this device.
 */

export interface GifSettings {
  search: boolean
  /** On: GIFs play while visible and the window is focused. Off: on hover or click. */
  autoplay: boolean
}

const STORAGE_KEY = "nexspeak_gif_settings"
const DEFAULT_SETTINGS: GifSettings = { search: false, autoplay: true }
const listeners = new Set<() => void>()

let cachedRaw: string | null | undefined
let cachedSettings: GifSettings = DEFAULT_SETTINGS

export function loadGifSettings(): GifSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === cachedRaw) return cachedSettings
    cachedRaw = raw
    const parsed = raw ? (JSON.parse(raw) as Partial<GifSettings>) : {}
    cachedSettings = {
      search: typeof parsed.search === "boolean" ? parsed.search : DEFAULT_SETTINGS.search,
      autoplay: typeof parsed.autoplay === "boolean" ? parsed.autoplay : DEFAULT_SETTINGS.autoplay,
    }
  } catch {
    cachedSettings = DEFAULT_SETTINGS
  }
  return cachedSettings
}

export function getDefaultGifSettings(): GifSettings {
  return DEFAULT_SETTINGS
}

export function saveGifSettings(update: Partial<GifSettings>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadGifSettings(), ...update }))
  } catch (error) {
    console.warn("Failed to persist GIF settings:", error)
  }
  listeners.forEach((listener) => listener())
}

export function subscribeGifSettings(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
