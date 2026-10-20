import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { loadAudioSettings, saveAudioSettings } from "./audio-settings"

describe("screen share audio preference", () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it("preserves existing audio preferences and defaults audio sharing to on", () => {
    localStorage.setItem("nexspeak_audio_settings", JSON.stringify({ inputMode: "push-to-talk", outputVolume: 42 }))
    expect(loadAudioSettings()).toMatchObject({ inputMode: "push-to-talk", outputVolume: 42, shareSystemAudio: true })
  })

  it("remembers disabled audio without changing microphone settings", () => {
    saveAudioSettings({ inputDeviceId: "microphone", shareSystemAudio: false })
    expect(loadAudioSettings()).toMatchObject({ inputDeviceId: "microphone", shareSystemAudio: false })
    saveAudioSettings({ outputVolume: 75 })
    expect(loadAudioSettings()).toMatchObject({ outputVolume: 75, shareSystemAudio: false })
  })

  it("rejects non-boolean values", () => {
    localStorage.setItem("nexspeak_audio_settings", JSON.stringify({ shareSystemAudio: "false" }))
    expect(loadAudioSettings().shareSystemAudio).toBe(true)
  })
})
