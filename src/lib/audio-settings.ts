/**
 * Audio device preferences, persisted per browser.
 */

export interface AudioSettings {
  /** Empty string means the system default device. */
  inputDeviceId: string
  outputDeviceId: string
  /** 0-100 */
  outputVolume: number
}

const STORAGE_KEY = 'nexspeak_audio_settings'
const DEFAULT_SETTINGS: AudioSettings = { inputDeviceId: '', outputDeviceId: '', outputVolume: 100 }
const listeners = new Set<() => void>()

let cachedRaw: string | null | undefined
let cachedSettings: AudioSettings = DEFAULT_SETTINGS

export function loadAudioSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === cachedRaw) return cachedSettings

    cachedRaw = raw
    const parsed = raw ? (JSON.parse(raw) as Partial<AudioSettings>) : {}
    cachedSettings = {
      inputDeviceId: typeof parsed.inputDeviceId === 'string' ? parsed.inputDeviceId : '',
      outputDeviceId: typeof parsed.outputDeviceId === 'string' ? parsed.outputDeviceId : '',
      outputVolume:
        typeof parsed.outputVolume === 'number' ? Math.min(100, Math.max(0, parsed.outputVolume)) : 100,
    }
  } catch {
    cachedSettings = DEFAULT_SETTINGS
  }
  return cachedSettings
}

export function getDefaultAudioSettings(): AudioSettings {
  return DEFAULT_SETTINGS
}

export function saveAudioSettings(update: Partial<AudioSettings>): void {
  const next = { ...loadAudioSettings(), ...update }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch (error) {
    console.warn('Failed to persist audio settings:', error)
  }
  listeners.forEach((listener) => listener())
}

export function subscribeAudioSettings(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
