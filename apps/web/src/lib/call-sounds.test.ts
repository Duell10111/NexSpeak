import { describe, expect, it } from "vitest"
import type { CallCue } from "@nexspeak/core/matrix/call-session"
import { getDefaultAudioSettings } from "./audio-settings"
import { encodeWav, isCueEnabled, renderCue } from "./call-sounds"

const CUES: CallCue[] = [
  "self-join",
  "self-leave",
  "participant-join",
  "participant-leave",
  "screenshare-start",
  "screenshare-stop",
]

describe("call sound cues", () => {
  it("are all on by default", () => {
    const settings = getDefaultAudioSettings()
    expect(CUES.every((cue) => isCueEnabled(settings, cue))).toBe(true)
  })

  it("can be turned off at once or per group", () => {
    const defaults = getDefaultAudioSettings()
    expect(CUES.some((cue) => isCueEnabled({ ...defaults, soundCues: false }, cue))).toBe(false)

    const noOthers = { ...defaults, soundCueGroups: { ...defaults.soundCueGroups, others: false } }
    expect(isCueEnabled(noOthers, "participant-join")).toBe(false)
    expect(isCueEnabled(noOthers, "participant-leave")).toBe(false)
    expect(isCueEnabled(noOthers, "self-join")).toBe(true)
    expect(isCueEnabled(noOthers, "screenshare-start")).toBe(true)
  })

  it("renders short sounds that don't clip", () => {
    for (const cue of CUES) {
      const samples = renderCue(cue, 22_050)
      expect(samples.length / 22_050).toBeLessThan(0.5)
      expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(1)
      expect(Math.max(...samples)).toBeGreaterThan(0.1)
    }
  })

  it("encodes 16-bit mono WAV files of a few KB", () => {
    const wav = encodeWav(renderCue("self-join", 22_050), 22_050)
    const view = new DataView(wav.buffer)
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF")
    expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe("WAVE")
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(22_050)
    expect(view.getUint32(40, true)).toBe(wav.length - 44)
    expect(wav.length).toBeLessThan(20_000)
  })
})
