/**
 * Notification preferences, persisted per browser. Which rooms notify at all comes from the
 * user's Matrix push rules (shared with Element), not from here.
 */

export interface NotificationSettings {
  enabled: boolean
  /** Off: notifications only say who wrote, not what (for screen sharing and shared screens). */
  showContent: boolean
}

const STORAGE_KEY = "nexspeak_notification_settings"
const DEFAULT_SETTINGS: NotificationSettings = { enabled: true, showContent: true }
const listeners = new Set<() => void>()

let cachedRaw: string | null | undefined
let cachedSettings: NotificationSettings = DEFAULT_SETTINGS

export function loadNotificationSettings(): NotificationSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === cachedRaw) return cachedSettings
    cachedRaw = raw
    const parsed = raw ? (JSON.parse(raw) as Partial<NotificationSettings>) : {}
    cachedSettings = {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_SETTINGS.enabled,
      showContent: typeof parsed.showContent === "boolean" ? parsed.showContent : DEFAULT_SETTINGS.showContent,
    }
  } catch {
    cachedSettings = DEFAULT_SETTINGS
  }
  return cachedSettings
}

export function getDefaultNotificationSettings(): NotificationSettings {
  return DEFAULT_SETTINGS
}

export function saveNotificationSettings(update: Partial<NotificationSettings>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadNotificationSettings(), ...update }))
  } catch (error) {
    console.warn("Failed to persist notification settings:", error)
  }
  listeners.forEach((listener) => listener())
}

export function subscribeNotificationSettings(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
