/** Browser-local, explicit consent; encrypted-room previews require separate consent. */
export interface LinkPreviewSettings {
  enabled: boolean
  encrypted: boolean
}
const STORAGE_KEY = 'nexspeak_link_preview_settings'
const DEFAULT: LinkPreviewSettings = { enabled: false, encrypted: false }
let cachedRaw: string | null | undefined
let cached = DEFAULT
const listeners = new Set<() => void>()
const storage = (event: StorageEvent) => { if (event.key === STORAGE_KEY || event.key === null) listeners.forEach((listener) => listener()) }
export function loadLinkPreviewSettings(): LinkPreviewSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === cachedRaw) return cached
    cachedRaw = raw
    const value = raw ? JSON.parse(raw) : null
    cached = { enabled: value?.enabled === true, encrypted: value?.encrypted === true }
  } catch { cached = DEFAULT }
  return cached
}
export function defaultLinkPreviewSettings(): LinkPreviewSettings { return DEFAULT }
export function saveLinkPreviewSettings(update: Partial<LinkPreviewSettings>): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadLinkPreviewSettings(), ...update })) }
  catch (error) { console.warn('Failed to persist link preview settings:', error) }
  listeners.forEach((listener) => listener())
}
export function subscribeLinkPreviewSettings(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', storage)
  listeners.add(listener)
  return () => { listeners.delete(listener); if (listeners.size === 0) window.removeEventListener('storage', storage) }
}
