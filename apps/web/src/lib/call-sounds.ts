/**
 * Sound cues in calls (join, leave, screen sharing, viewers of our stream), like Discord's.
 * The sounds are synthesized on first use instead of shipped as files: nothing to download or
 * license, and nothing exists before the first call.
 */

import type { CallCue } from "@nexspeak/core/matrix/call-session"
import type { AudioSettings, SoundCueGroup } from "@/lib/audio-settings"

const SAMPLE_RATE = 22_050
/** Several people joining at once (or a burst of events) plays the cue only once. */
export const CUE_THROTTLE_MS = 1_500

const CUE_GROUPS: Record<CallCue, SoundCueGroup> = {
  "self-join": "own",
  "self-leave": "own",
  "participant-join": "others",
  "participant-leave": "others",
  "screenshare-start": "screenshare",
  "screenshare-stop": "screenshare",
  "viewer-join": "viewers",
  "viewer-leave": "viewers",
}

interface Note {
  /** Hz */
  frequency: number
  /** Seconds from the start of the cue. */
  start: number
  duration: number
}

/** Rising for joining and starting, falling for leaving and stopping. */
const CUE_NOTES: Record<CallCue, { notes: Note[]; gain: number }> = {
  "self-join": { notes: [note(523.25, 0, 0.14), note(783.99, 0.09, 0.2)], gain: 0.35 },
  "self-leave": { notes: [note(783.99, 0, 0.14), note(523.25, 0.09, 0.2)], gain: 0.35 },
  "participant-join": { notes: [note(659.25, 0, 0.1), note(880, 0.07, 0.16)], gain: 0.28 },
  "participant-leave": { notes: [note(880, 0, 0.1), note(659.25, 0.07, 0.16)], gain: 0.28 },
  "screenshare-start": {
    notes: [note(392, 0, 0.09), note(523.25, 0.06, 0.09), note(659.25, 0.12, 0.18)],
    gain: 0.3,
  },
  "screenshare-stop": {
    notes: [note(659.25, 0, 0.09), note(523.25, 0.06, 0.09), note(392, 0.12, 0.18)],
    gain: 0.3,
  },
  // Higher and shorter than the others: a quiet hint while streaming, e.g. a game.
  "viewer-join": { notes: [note(1046.5, 0, 0.07), note(1318.51, 0.05, 0.12)], gain: 0.22 },
  "viewer-leave": { notes: [note(1318.51, 0, 0.07), note(1046.5, 0.05, 0.12)], gain: 0.22 },
}

function note(frequency: number, start: number, duration: number): Note {
  return { frequency, start, duration }
}

export function isCueEnabled(settings: AudioSettings, cue: CallCue): boolean {
  return settings.soundCues && settings.soundCueGroups[CUE_GROUPS[cue]]
}

/** Mono samples in -1..1: soft sine tones with a short attack and an exponential decay. */
export function renderCue(cue: CallCue, sampleRate = SAMPLE_RATE): Float32Array {
  const { notes, gain } = CUE_NOTES[cue]
  const length = Math.ceil(Math.max(...notes.map((n) => n.start + n.duration)) * sampleRate)
  const samples = new Float32Array(length)
  const attack = 0.006 * sampleRate
  for (const { frequency, start, duration } of notes) {
    const offset = Math.floor(start * sampleRate)
    const count = Math.floor(duration * sampleRate)
    for (let i = 0; i < count && offset + i < length; i++) {
      const phase = (2 * Math.PI * frequency * i) / sampleRate
      // A little second harmonic makes the tone rounder than a pure sine.
      const tone = Math.sin(phase) + 0.2 * Math.sin(2 * phase)
      const envelope = Math.min(1, i / attack) * Math.exp((-5 * i) / count)
      samples[offset + i] += (tone / 1.2) * envelope * gain
    }
  }
  return samples
}

/** 16-bit PCM WAV. */
export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2))
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  ascii(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, "WAVE")
  ascii(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, "data")
  view.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true))
  return new Uint8Array(view.buffer)
}

function cueDataUrl(cue: CallCue): string {
  const bytes = encodeWav(renderCue(cue))
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:audio/wav;base64,${btoa(binary)}`
}

export interface CallSoundPlayer {
  play: (cue: CallCue, options: { volume: number; outputDeviceId: string }) => void
}

/**
 * One player per call: an <audio> element per cue, created on its first use, so the cue plays
 * on the chosen output device (setSinkId). Nothing runs between cues; the elements go away with
 * the player after the call.
 */
export function createCallSoundPlayer(now: () => number = Date.now): CallSoundPlayer {
  const elements = new Map<CallCue, HTMLAudioElement>()
  const lastPlayed = new Map<CallCue, number>()

  return {
    play(cue, { volume, outputDeviceId }) {
      const time = now()
      const last = lastPlayed.get(cue)
      if (last !== undefined && time - last < CUE_THROTTLE_MS) return
      lastPlayed.set(cue, time)

      let element = elements.get(cue)
      if (!element) {
        element = new Audio(cueDataUrl(cue))
        // Lets the E2E tests tell the cues apart.
        element.dataset.cue = cue
        elements.set(cue, element)
      }
      const audio = element
      audio.volume = Math.min(1, Math.max(0, volume))
      audio.currentTime = 0
      const sinkReady =
        "setSinkId" in audio && audio.sinkId !== outputDeviceId
          ? audio.setSinkId(outputDeviceId).catch(() => {})
          : Promise.resolve()
      void sinkReady
        .then(() => audio.play())
        .catch((error: unknown) => console.warn("Failed to play call sound:", error))
    },
  }
}
