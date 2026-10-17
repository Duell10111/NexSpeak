import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_SCREENSHARE_QUALITY,
  loadScreenShareQuality,
  saveScreenShareQuality,
  screenShareBitrate,
  screenShareConstraints,
  screenShareTuning,
} from "./screenshare-quality"

describe("screenShareConstraints", () => {
  it("caps resolution and frame rate", () => {
    expect(screenShareConstraints({ resolution: "1080", fps: 60 })).toEqual({
      width: { max: 1920 },
      height: { max: 1080 },
      frameRate: { ideal: 60, max: 60 },
    })
  })

  it("leaves the resolution alone for source", () => {
    expect(screenShareConstraints({ resolution: "source", fps: 30 })).toEqual({ frameRate: { ideal: 30, max: 30 } })
  })
})

describe("screenShareBitrate", () => {
  it("grows with resolution and frame rate", () => {
    expect(screenShareBitrate({ resolution: "1080", fps: 30 })).toBe(4_500_000)
    expect(screenShareBitrate({ resolution: "1080", fps: 60 })).toBeGreaterThan(screenShareBitrate({ resolution: "1080", fps: 30 }))
    expect(screenShareBitrate({ resolution: "1440", fps: 30 })).toBeGreaterThan(screenShareBitrate({ resolution: "1080", fps: 30 }))
  })
})

describe("screenShareTuning", () => {
  it("prefers smoothness at 60 fps and sharpness at 15 fps", () => {
    expect(screenShareTuning({ resolution: "1080", fps: 60 }).degradationPreference).toBe("maintain-framerate")
    expect(screenShareTuning({ resolution: "1080", fps: 15 }).degradationPreference).toBe("maintain-resolution")
  })
})

describe("screenshare quality storage", () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    })
  })

  it("round-trips and rejects unknown values", () => {
    expect(loadScreenShareQuality()).toEqual(DEFAULT_SCREENSHARE_QUALITY)
    saveScreenShareQuality({ resolution: "1440", fps: 60 })
    expect(loadScreenShareQuality()).toEqual({ resolution: "1440", fps: 60 })
    localStorage.setItem("nexspeak:screenshare-quality", JSON.stringify({ resolution: "8k", fps: 144 }))
    expect(loadScreenShareQuality()).toEqual(DEFAULT_SCREENSHARE_QUALITY)
  })
})
