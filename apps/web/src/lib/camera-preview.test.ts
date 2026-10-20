import { afterEach, describe, expect, it, vi } from "vitest"
import { CameraPreview } from "./camera-preview"

function capture() {
  const stop = vi.fn()
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
  let resolve!: (stream: MediaStream) => void
  const pending = new Promise<MediaStream>((done) => { resolve = done })
  return { stop, stream, pending, resolve: () => resolve(stream) }
}

afterEach(() => vi.unstubAllGlobals())

describe("camera preview ownership", () => {
  it("stops a capture that arrives after the settings are closed", async () => {
    const media = capture()
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(() => media.pending) } })
    const preview = new CameraPreview()
    const started = preview.start("camera-a")
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: false, video: { deviceId: { ideal: "camera-a" } } })
    preview.stop()
    media.resolve()
    expect(await started).toBeNull()
    expect(media.stop).toHaveBeenCalledOnce()
  })

  it("discards older requests finishing after the latest camera is already visible", async () => {
    const first = capture(), second = capture()
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockReturnValueOnce(first.pending).mockReturnValueOnce(second.pending) } })
    const preview = new CameraPreview()
    const old = preview.start("camera-a")
    const latest = preview.start("camera-b")
    second.resolve()
    expect(await latest).toBe(second.stream)
    first.resolve()
    expect(await old).toBeNull()
    expect(first.stop).toHaveBeenCalledOnce()
    expect(second.stop).not.toHaveBeenCalled()
    preview.stop()
    expect(second.stop).toHaveBeenCalledOnce()
  })

  it("releases the previous preview before requesting another camera and ignores stale errors", async () => {
    const first = capture()
    let reject!: (error: Error) => void
    const stale = new Promise<MediaStream>((_, fail) => { reject = fail })
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockResolvedValueOnce(first.stream).mockReturnValueOnce(stale) } })
    const preview = new CameraPreview()
    await preview.start("")
    const next = preview.start("camera-b")
    expect(first.stop).toHaveBeenCalledOnce()
    preview.stop()
    reject(new Error("Permission denied after closing"))
    expect(await next).toBeNull()
  })

  it("reports current permission failures", async () => {
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new Error("Permission denied")) } })
    await expect(new CameraPreview().start("")).rejects.toThrow("Permission denied")
  })
})
