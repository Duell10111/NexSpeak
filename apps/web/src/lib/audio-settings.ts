/**
 * Audio device, input mode and voice processing preferences, persisted per browser.
 */

import {
  DEFAULT_AUDIO_PROCESSING,
  NOISE_SUPPRESSION_MODES,
  type AudioProcessingOptions,
  type NoiseSuppressionMode,
} from '@nexspeak/core/audio-processing'
import { emptyCallShortcutBindings, parseCallShortcutBindings, type CallShortcutBindings } from '@nexspeak/core/global-shortcuts'

export type InputMode = 'voice-activity' | 'push-to-talk'
/** Sound cues in calls: our own join/leave, others joining/leaving, screen shares starting/stopping. */
export type SoundCueGroup = 'own' | 'others' | 'screenshare'
export const SOUND_CUE_GROUPS: readonly SoundCueGroup[] = ['own', 'others', 'screenshare']

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
  /** Local playback of soundboard clips sent by call participants. */
  soundboardEnabled: boolean
  /** 0..100, multiplied by the output volume and the clip's own volume. */
  soundboardVolume: number
  /** Turns all sound cues off at once; soundCueGroups picks individual ones. */
  soundCues: boolean
  soundCueGroups: Record<SoundCueGroup, boolean>
  noiseSuppression: NoiseSuppressionMode
  echoCancellation: boolean
  autoGainControl: boolean
  /** Voice activity mode: only transmit while the level is above the input sensitivity. */
  inputSensitivityEnabled: boolean
  /** Input sensitivity in dBFS, MIN_INPUT_SENSITIVITY_DB to 0. */
  inputSensitivityDb: number
  callShortcuts: CallShortcutBindings
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
  soundboardEnabled: true,
  soundboardVolume: 100,
  soundCues: true,
  soundCueGroups: { own: true, others: true, screenshare: true },
  noiseSuppression: DEFAULT_AUDIO_PROCESSING.noiseSuppression,
  echoCancellation: DEFAULT_AUDIO_PROCESSING.echoCancellation,
  autoGainControl: DEFAULT_AUDIO_PROCESSING.autoGainControl,
  inputSensitivityEnabled: false,
  inputSensitivityDb: -50,
  callShortcuts: emptyCallShortcutBindings(),
}
export const MAX_PUSH_TO_TALK_RELEASE_DELAY_MS = 1000
export const MIN_INPUT_SENSITIVITY_DB = -80
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
      callShortcuts: parseCallShortcutBindings(parsed.callShortcuts),
      pushToTalkReleaseDelayMs:
        typeof parsed.pushToTalkReleaseDelayMs === 'number'
          ? Math.min(MAX_PUSH_TO_TALK_RELEASE_DELAY_MS, Math.max(0, parsed.pushToTalkReleaseDelayMs))
          : DEFAULT_SETTINGS.pushToTalkReleaseDelayMs,
      soundboardEnabled: parsed.soundboardEnabled !== false,
      soundboardVolume: typeof parsed.soundboardVolume === 'number' && Number.isFinite(parsed.soundboardVolume) ? Math.max(0, Math.min(100, parsed.soundboardVolume)) : 100,
      soundCues: parsed.soundCues !== false,
      soundCueGroups: {
        own: parsed.soundCueGroups?.own !== false,
        others: parsed.soundCueGroups?.others !== false,
        screenshare: parsed.soundCueGroups?.screenshare !== false,
      },
      noiseSuppression: NOISE_SUPPRESSION_MODES.includes(parsed.noiseSuppression as NoiseSuppressionMode)
        ? (parsed.noiseSuppression as NoiseSuppressionMode)
        : DEFAULT_SETTINGS.noiseSuppression,
      echoCancellation: parsed.echoCancellation !== false,
      autoGainControl: parsed.autoGainControl !== false,
      inputSensitivityEnabled: parsed.inputSensitivityEnabled === true,
      inputSensitivityDb:
        typeof parsed.inputSensitivityDb === 'number'
          ? Math.min(0, Math.max(MIN_INPUT_SENSITIVITY_DB, parsed.inputSensitivityDb))
          : DEFAULT_SETTINGS.inputSensitivityDb,
    }
  } catch {
    cachedSettings = DEFAULT_SETTINGS
  }
  return cachedSettings
}

/** What the call and the microphone test do with the microphone. */
export function audioProcessingOptions(settings: AudioSettings): AudioProcessingOptions {
  return {
    noiseSuppression: settings.noiseSuppression,
    echoCancellation: settings.echoCancellation,
    autoGainControl: settings.autoGainControl,
    voiceGateDb:
      settings.inputMode === 'voice-activity' && settings.inputSensitivityEnabled ? settings.inputSensitivityDb : null,
  }
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
