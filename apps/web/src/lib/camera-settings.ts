/** Camera selection is a preference, so disconnected devices never prevent capture. */
const STORAGE_KEY = "nexspeak_camera_device"
const listeners = new Set<() => void>()

export function loadCameraDevice(): string {
  try { return localStorage.getItem(STORAGE_KEY) || "" } catch { return "" }
}

export const defaultCameraDevice = () => ""

export function saveCameraDevice(deviceId: string): void {
  try { localStorage.setItem(STORAGE_KEY, deviceId) } catch (error) {
    console.warn("Failed to persist camera preference:", error)
  }
  listeners.forEach((listener) => listener())
}

export function subscribeCameraDevice(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Privacy-redacted lists cannot prove that a remembered camera has been unplugged. */
export function cameraDeviceMissing(devices: MediaDeviceInfo[], deviceId: string, granted: boolean): boolean {
  if (!deviceId) return false
  const cameras = devices.filter((device) => device.kind === "videoinput")
  const readable = cameras.length > 0 && cameras.every((device) => device.deviceId && device.label)
  return (granted || readable) && !cameras.some((device) => device.deviceId === deviceId)
}
