"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Camera } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useTranslation } from "@/hooks/useTranslation"
import { useCameraDevices } from "@/hooks/useCameraDevices"
import { defaultCameraDevice, loadCameraDevice, saveCameraDevice, subscribeCameraDevice } from "@/lib/camera-settings"
import { CameraPreview } from "@/lib/camera-preview"

const DEFAULT_DEVICE = "__default__"

export function CameraSettings() {
  const { t } = useTranslation()
  const deviceId = useSyncExternalStore(subscribeCameraDevice, loadCameraDevice, defaultCameraDevice)
  const [previewing, setPreviewing] = useState(false)
  const [ready, setReady] = useState(false)
  const { devices, refresh } = useCameraDevices(true, ready)
  const preview = useRef<CameraPreview | null>(null)
  const video = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!previewing) return
    const element = video.current
    const capture = new CameraPreview()
    preview.current = capture
    let cancelled = false
    void capture.start(deviceId).then((stream) => {
      if (cancelled || !stream) return
      if (element) element.srcObject = stream
      setReady(true)
      void refresh()
    }).catch((error: unknown) => {
      if (cancelled) return
      console.warn("Failed to preview camera:", error)
      setPreviewing(false)
      toast.error(t("settings.cameraOpenFailed"))
    })
    return () => {
      cancelled = true
      capture.stop()
      preview.current = null
      if (element) element.srcObject = null
    }
  }, [previewing, deviceId, refresh, t])

  const stop = () => {
    preview.current?.stop()
    if (video.current) video.current.srcObject = null
    setPreviewing(false)
    setReady(false)
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-muted-foreground" />
          <Label htmlFor="camera-device" className="font-semibold">{t("settings.cameraDevice")}</Label>
        </div>
        <Select value={deviceId || DEFAULT_DEVICE} onValueChange={(value) => {
          setReady(false)
          saveCameraDevice(value === DEFAULT_DEVICE ? "" : value)
        }}>
          <SelectTrigger id="camera-device"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_DEVICE}>{t("settings.systemDefault")}</SelectItem>
            {deviceId && !devices.some((device) => device.deviceId === deviceId) && (
              <SelectItem value={deviceId}>{t("settings.savedCamera")}</SelectItem>
            )}
            {devices.map((device, index) => (
              <SelectItem key={device.deviceId} value={device.deviceId}>
                {device.label || t("settings.cameraNumber", { number: index + 1 })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t("settings.cameraHint")}</p>
      </div>
      <Button variant="outline" className="w-full" onClick={() => {
        if (previewing) stop()
        else { setReady(false); setPreviewing(true) }
      }}>{previewing ? t("settings.stopCameraPreview") : t("settings.startCameraPreview")}</Button>
      {previewing && (
        <div className="space-y-2">
          <video ref={video} autoPlay playsInline muted aria-label={t("settings.cameraPreview")} className="aspect-video w-full rounded-md bg-black object-contain" />
          {!ready && <p role="status" className="text-sm text-muted-foreground">{t("settings.cameraOpening")}</p>}
        </div>
      )}
    </div>
  )
}
