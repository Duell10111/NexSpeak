"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/** Listing devices must never open the microphone: doing so can duck other system audio. */
export function useAudioDevices(active: boolean) {
  const [devices, setDevices] = useState<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }>({
    inputs: [], outputs: [],
  })
  const [permissionError, setPermissionError] = useState(false)
  const [namesHidden, setNamesHidden] = useState(false)
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  const refresh = useCallback(() => refreshRef.current(), [])

  useEffect(() => {
    if (!active || !navigator.mediaDevices) return
    let cancelled = false
    let revision = 0
    let permission: PermissionStatus | undefined
    const media = navigator.mediaDevices
    const loadDevices = async () => {
      const current = ++revision
      try {
        const all = await media.enumerateDevices()
        if (cancelled || current !== revision) return
        // Without permission browsers may return placeholder devices with empty IDs.
        setDevices({
          inputs: all.filter((device) => device.kind === "audioinput" && device.deviceId && device.deviceId !== "default"),
          outputs: all.filter((device) => device.kind === "audiooutput" && device.deviceId && device.deviceId !== "default"),
        })
        setNamesHidden(!all.some((device) => device.kind === "audioinput" && device.label))
      } catch (error) {
        console.error("Failed to enumerate audio devices:", error)
      }
    }
    const permissionChanged = () => {
      if (cancelled) return
      setPermissionError(permission?.state === "denied")
      void loadDevices()
    }
    // Firefox and Safari may not support querying this permission. Enumeration still works.
    void navigator.permissions?.query({ name: "microphone" as PermissionName }).then((status) => {
      if (cancelled) return
      permission = status
      permission.addEventListener("change", permissionChanged)
      setPermissionError(permission.state === "denied")
    }).catch(() => {})
    refreshRef.current = loadDevices
    void loadDevices()
    media.addEventListener("devicechange", loadDevices)
    return () => {
      cancelled = true
      refreshRef.current = async () => {}
      media.removeEventListener("devicechange", loadDevices)
      permission?.removeEventListener("change", permissionChanged)
    }
  }, [active])

  return { ...devices, permissionError, namesHidden, refresh }
}
