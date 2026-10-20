import { afterEach, describe, expect, it, vi } from "vitest"
import { cameraDeviceMissing, loadCameraDevice, saveCameraDevice, subscribeCameraDevice } from "./camera-settings"

const camera = (deviceId: string, label = "Camera") => ({ kind: "videoinput", deviceId, label }) as MediaDeviceInfo

afterEach(() => vi.unstubAllGlobals())

describe("camera preference", () => {
  it("persists selections and notifies subscribers without accessing media", () => {
    const values = new Map<string, string>()
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) })
    const changed = vi.fn()
    const unsubscribe = subscribeCameraDevice(changed)
    expect(loadCameraDevice()).toBe("")
    saveCameraDevice("camera-b")
    expect(loadCameraDevice()).toBe("camera-b")
    expect(changed).toHaveBeenCalledOnce()
    unsubscribe()
    saveCameraDevice("")
    expect(loadCameraDevice()).toBe("")
    expect(changed).toHaveBeenCalledOnce()
  })

  it("keeps saved cameras when enumeration is empty or privacy-redacted", () => {
    expect(cameraDeviceMissing([], "saved", false)).toBe(false)
    expect(cameraDeviceMissing([camera("", "")], "saved", false)).toBe(false)
    expect(cameraDeviceMissing([camera("another", "")], "saved", false)).toBe(false)
  })

  it("falls back only when a readable list or granted permission confirms the camera is gone", () => {
    expect(cameraDeviceMissing([camera("another")], "saved", false)).toBe(true)
    expect(cameraDeviceMissing([], "saved", true)).toBe(true)
    expect(cameraDeviceMissing([camera("saved")], "saved", true)).toBe(false)
    expect(cameraDeviceMissing([], "", true)).toBe(false)
  })
})
