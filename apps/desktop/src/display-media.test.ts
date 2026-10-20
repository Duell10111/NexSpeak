import { describe, expect, it } from "vitest"
import { screenShareAudioDevice, supportsSystemAudio } from "./display-media"

describe("system audio availability", () => {
  it("requires macOS 13 or later and keeps Windows enabled", () => {
    expect(supportsSystemAudio("darwin", "21.6.0")).toBe(false)
    expect(supportsSystemAudio("darwin", "22.0.0")).toBe(true)
    expect(supportsSystemAudio("darwin", "25.0.0")).toBe(true)
    expect(supportsSystemAudio("darwin", "unknown")).toBe(false)
    expect(supportsSystemAudio("win32", "10.0.22631")).toBe(true)
    expect(supportsSystemAudio("linux", "6.12.0")).toBe(false)
  })

  it("never grants audio for video-only requests or unsupported platforms", () => {
    expect(screenShareAudioDevice(false, "darwin", "22.0.0")).toBeUndefined()
    expect(screenShareAudioDevice(false, "win32", "10.0.22631")).toBeUndefined()
    expect(screenShareAudioDevice(true, "darwin", "21.6.0")).toBeUndefined()
    expect(screenShareAudioDevice(true, "linux", "6.12.0")).toBeUndefined()
  })

  it("excludes the macOS app audio even where Blink ignores restrictOwnAudio", () => {
    expect(screenShareAudioDevice(true, "darwin", "22.0.0")).toBe("loopbackWithoutChrome")
    expect(screenShareAudioDevice(true, "darwin", "25.0.0")).toBe("loopbackWithoutChrome")
    expect(screenShareAudioDevice(true, "win32", "10.0.22631")).toBe("loopback")
  })
})
