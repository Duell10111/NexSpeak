"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { Headphones, Languages, LogOut, Mic } from "lucide-react"
import { useMatrix } from "@/components/matrix-provider"
import { useSecurity } from "@/components/nexspeak/security-context"
import { SecurityPanel } from "@/components/nexspeak/security-panel"
import { PushToTalkSettings } from "@/components/nexspeak/push-to-talk-settings"
import { useTranslation } from "@/hooks/useTranslation"
import { LOCALE_NAMES, LOCALES, t as translate, type Locale } from "@nexspeak/i18n"
import {
  getDefaultAudioSettings,
  loadAudioSettings,
  saveAudioSettings,
  subscribeAudioSettings,
} from "@/lib/audio-settings"

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Radix Select doesn't allow an empty string as item value.
const DEFAULT_DEVICE = "__default__"
const MIC_TEST_DURATION_MS = 5000

function useAudioDevices(open: boolean) {
  const [devices, setDevices] = useState<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }>({
    inputs: [],
    outputs: [],
  })
  const [permissionError, setPermissionError] = useState(false)

  useEffect(() => {
    if (!open || !navigator.mediaDevices) return
    let cancelled = false

    const loadDevices = async () => {
      try {
        // Device labels are only exposed after microphone permission was granted.
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach((track) => track.stop())
        if (!cancelled) setPermissionError(false)
      } catch {
        if (!cancelled) setPermissionError(true)
      }

      try {
        const all = await navigator.mediaDevices.enumerateDevices()
        if (cancelled) return
        setDevices({
          inputs: all.filter((device) => device.kind === "audioinput" && device.deviceId !== "default"),
          outputs: all.filter((device) => device.kind === "audiooutput" && device.deviceId !== "default"),
        })
      } catch (error) {
        console.error("Failed to enumerate devices:", error)
      }
    }

    void loadDevices()
    navigator.mediaDevices.addEventListener("devicechange", loadDevices)
    return () => {
      cancelled = true
      navigator.mediaDevices.removeEventListener("devicechange", loadDevices)
    }
  }, [open])

  return { ...devices, permissionError }
}

function MicrophoneTest({ deviceId }: { deviceId: string }) {
  const { t } = useTranslation()
  const [level, setLevel] = useState<number | null>(null)
  const stopRef = useRef<(() => void) | null>(null)

  useEffect(() => () => stopRef.current?.(), [])

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      })
      const audioContext = new AudioContext()
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 1024
      audioContext.createMediaStreamSource(stream).connect(analyser)
      const buffer = new Uint8Array(analyser.fftSize)

      let frame = 0
      const tick = () => {
        analyser.getByteTimeDomainData(buffer)
        let sum = 0
        for (const sample of buffer) {
          const normalized = (sample - 128) / 128
          sum += normalized * normalized
        }
        setLevel(Math.min(100, Math.sqrt(sum / buffer.length) * 400))
        frame = requestAnimationFrame(tick)
      }
      tick()

      const timeout = setTimeout(() => stopRef.current?.(), MIC_TEST_DURATION_MS)
      stopRef.current = () => {
        clearTimeout(timeout)
        cancelAnimationFrame(frame)
        stream.getTracks().forEach((track) => track.stop())
        void audioContext.close()
        stopRef.current = null
        setLevel(null)
      }
    } catch (error) {
      console.error("Failed to test microphone:", error)
      toast.error(translate("settings.micOpenFailed"))
    }
  }

  return (
    <div className="space-y-2">
      <Button size="sm" variant="outline" onClick={() => void start()} disabled={level !== null} className="w-full">
        {level !== null ? t("settings.speakNow") : t("settings.testMic")}
      </Button>
      {level !== null && <Progress value={level} aria-label={t("settings.micLevel")} />}
    </div>
  )
}

function playTestTone(volume: number, outputDeviceId: string) {
  const audioContext = new AudioContext()
  const sinkCapable = audioContext as AudioContext & { setSinkId?: (id: string) => Promise<void> }
  if (outputDeviceId && sinkCapable.setSinkId) {
    void sinkCapable.setSinkId(outputDeviceId).catch(() => {})
  }

  const oscillator = audioContext.createOscillator()
  const gain = audioContext.createGain()
  oscillator.connect(gain)
  gain.connect(audioContext.destination)
  oscillator.frequency.value = 440
  gain.gain.setValueAtTime(0.15 * volume, audioContext.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 1)
  oscillator.start()
  oscillator.stop(audioContext.currentTime + 1)
  oscillator.onended = () => void audioContext.close()
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { t, locale, setLocale } = useTranslation()
  const { session, logout } = useMatrix()
  const { status: securityStatus } = useSecurity()
  const settings = useSyncExternalStore(subscribeAudioSettings, loadAudioSettings, getDefaultAudioSettings)
  const { inputs, outputs, permissionError } = useAudioDevices(open)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const supportsOutputSelection = typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype

  const handleLogout = async () => {
    setIsLoggingOut(true)
    try {
      await logout()
    } finally {
      setIsLoggingOut(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-md">
        <DialogHeader>
          <DialogTitle>{t("settings.title")}</DialogTitle>
          <DialogDescription>{t("settings.description")}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="audio" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="audio">{t("settings.audio")}</TabsTrigger>
            <TabsTrigger value="security">{t("settings.security")}</TabsTrigger>
            <TabsTrigger value="account">{t("settings.account")}</TabsTrigger>
          </TabsList>

          <TabsContent value="security">
            <SecurityPanel />
          </TabsContent>

          <TabsContent value="audio" className="space-y-6">
            {permissionError && (
              <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {t("settings.noMicAccess")}
              </p>
            )}

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Mic className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="input-device" className="font-semibold">
                  {t("settings.inputDevice")}
                </Label>
              </div>
              <Select
                value={settings.inputDeviceId || DEFAULT_DEVICE}
                onValueChange={(value) => saveAudioSettings({ inputDeviceId: value === DEFAULT_DEVICE ? "" : value })}
              >
                <SelectTrigger id="input-device">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_DEVICE}>{t("settings.systemDefault")}</SelectItem>
                  {inputs.map((device, index) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {device.label || t("settings.micNumber", { number: index + 1 })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <MicrophoneTest deviceId={settings.inputDeviceId} />
            </div>

            <PushToTalkSettings settings={settings} />

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Headphones className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="output-device" className="font-semibold">
                  {t("settings.outputDevice")}
                </Label>
              </div>
              <Select
                value={settings.outputDeviceId || DEFAULT_DEVICE}
                onValueChange={(value) => saveAudioSettings({ outputDeviceId: value === DEFAULT_DEVICE ? "" : value })}
                disabled={!supportsOutputSelection}
              >
                <SelectTrigger id="output-device">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_DEVICE}>{t("settings.systemDefault")}</SelectItem>
                  {outputs.map((device, index) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {device.label || t("settings.speakerNumber", { number: index + 1 })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!supportsOutputSelection && (
                <p className="text-xs text-muted-foreground">{t("settings.noOutputSelection")}</p>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => playTestTone(settings.outputVolume / 100, settings.outputDeviceId)}
                className="w-full"
              >
                {t("settings.playTestTone")}
              </Button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="output-volume">{t("settings.callVolume")}</Label>
                <span className="text-sm font-medium text-muted-foreground">{settings.outputVolume}%</span>
              </div>
              <Slider
                id="output-volume"
                min={0}
                max={100}
                step={1}
                value={[settings.outputVolume]}
                onValueChange={(value) => saveAudioSettings({ outputVolume: value[0] })}
                className="w-full"
              />
            </div>
          </TabsContent>

          <TabsContent value="account" className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Languages className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="language" className="font-semibold">
                  {t("settings.language")}
                </Label>
              </div>
              <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
                <SelectTrigger id="language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOCALES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {LOCALE_NAMES[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 rounded-lg bg-muted p-4 text-sm">
              <p className="text-muted-foreground">{t("settings.signedInAs")}</p>
              <p className="break-all font-medium text-foreground">{session?.userId}</p>
              <p className="pt-2 text-muted-foreground">{t("login.homeserver")}</p>
              <p className="break-all font-medium text-foreground">{session?.homeserverUrl}</p>
              <p className="pt-2 text-muted-foreground">{t("settings.device")}</p>
              <p className="break-all font-mono text-xs text-foreground">{session?.deviceId}</p>
            </div>
            <Button variant="destructive" className="w-full" onClick={() => void handleLogout()} disabled={isLoggingOut}>
              {isLoggingOut ? <Spinner className="mr-2 h-4 w-4" /> : <LogOut className="mr-2 h-4 w-4" />}
              {t("account.logout")}
            </Button>
            {securityStatus?.backupVersion ? (
              <p className="text-xs text-muted-foreground">
                {t("settings.backupOk")}
              </p>
            ) : (
              <p className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                {t("settings.backupMissing")}
              </p>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
