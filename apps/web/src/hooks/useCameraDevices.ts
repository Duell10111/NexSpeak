"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { cameraDeviceMissing, loadCameraDevice, saveCameraDevice } from "@/lib/camera-settings"

/** Enumerate only while needed. Permission is requested by explicit preview/call actions. */
export function useCameraDevices(active: boolean, cameraOn = false) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const accessGranted = useRef(false)
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  const refresh = useCallback(() => refreshRef.current(), [])

  useEffect(() => {
    if (!active) { accessGranted.current = false; return }
    if (!navigator.mediaDevices) return
    if (cameraOn) accessGranted.current = true
    let revision = 0
    let cancelled = false
    const refresh = async () => {
      const current = ++revision
      try {
        // Snapshot permission before enumeration: granting it during enumeration must not make
        // an older privacy-redacted list look authoritative. Firefox lacks this permission query.
        const permission = await navigator.permissions?.query({ name: "camera" as PermissionName }).catch(() => null)
        const granted = permission?.state === "granted" || (!permission && accessGranted.current)
        const devices = await navigator.mediaDevices.enumerateDevices()
        if (cancelled || current !== revision) return
        setDevices(devices.filter((device) => device.kind === "videoinput" && device.deviceId))
        if (cameraDeviceMissing(devices, loadCameraDevice(), granted)) saveCameraDevice("")
      } catch (error) {
        console.warn("Failed to enumerate cameras:", error)
      }
    }
    refreshRef.current = refresh
    void refresh()
    navigator.mediaDevices.addEventListener("devicechange", refresh)
    return () => {
      cancelled = true
      refreshRef.current = async () => {}
      navigator.mediaDevices.removeEventListener("devicechange", refresh)
    }
  }, [active, cameraOn])

  return { devices, refresh }
}
