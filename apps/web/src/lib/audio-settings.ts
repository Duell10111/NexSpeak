/**
 * Audio device and input mode preferences, persisted per browser.
 */

export type InputMode = 'voice-activity' | 'push-to-talk'

export interface AudioSettings {
  /** Empty string means the system default device. */
  inputDeviceId: string
  outputDeviceId: string
  /** 0-100 */
  outputVolume: number
  /** Include system/tab audio when starting a screen share, where supported. */
  shareSystemAudio: boolean
  inputMode: InputMode
  /** KeyboardEvent.code or "Mouse3"–"Mouse5" (see lib/push-to-talk.ts); null until chosen. */
  pushToTalkKey: string | null
  /** Keeps transmitting this long after the key is released, so word endings aren't cut off. */
  pushToTalkReleaseDelayMs: number
}

const STORAGE_KEY = 'nexspeak_audio_settings'
const DEFAULT_SETTINGS: AudioSettings = {
  inputDeviceId: '',
  outputDeviceId: '',
  outputVolume: 100,
  shareSystemAudio: true,
  inputMode: 'voice-activity',
  pushToTalkKey: null,
  pushToTalkReleaseDelayMs: 100,
}
export const MAX_PUSH_TO_TALK_RELEASE_DELAY_MS = 1000
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
      shareSystemAudio: typeof parsed.shareSystemAudio === 'boolean' ? parsed.shareSystemAudio : true,
      inputMode: parsed.inputMode === 'push-to-talk' ? 'push-to-talk' : 'voice-activity',
      pushToTalkKey: typeof parsed.pushToTalkKey === 'string' ? parsed.pushToTalkKey : null,
      pushToTalkReleaseDelayMs:
        typeof parsed.pushToTalkReleaseDelayMs === 'number'
          ? Math.min(MAX_PUSH_TO_TALK_RELEASE_DELAY_MS, Math.max(0, parsed.pushToTalkReleaseDelayMs))
          : DEFAULT_SETTINGS.pushToTalkReleaseDelayMs,
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
