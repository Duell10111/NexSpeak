"use client"

import { useState, useSyncExternalStore } from "react"
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
import { Spinner } from "@/components/ui/spinner"
import { ExternalLink, Headphones, Languages, LogOut, Mic } from "lucide-react"
import { useMatrix } from "@/components/matrix-provider"
import { useSecurity } from "@/components/nexspeak/security-context"
import { SecurityPanel } from "@/components/nexspeak/security-panel"
import { SoundCueSettings } from "@/components/nexspeak/sound-cue-settings"
import { CallInputSettings } from "@/components/nexspeak/call-shortcut-settings"
import { LinkPreviewSettingsPanel } from "@/components/nexspeak/link-preview-settings"
import { NotificationSettingsPanel } from "@/components/nexspeak/notification-settings"
import { ProfilePanel } from "@/components/nexspeak/profile-panel"
import { CameraSettings } from "@/components/nexspeak/camera-settings"
import { AboutPanel } from "@/components/nexspeak/about-panel"
import { DesktopAutostartSetting } from "@/components/nexspeak/desktop-settings"
import { SystemAudioSetting } from "@/components/nexspeak/system-audio-setting"
import { IgnoredUsersList } from "@/components/nexspeak/ignored-users"
import { useTranslation } from "@/hooks/useTranslation"
import { useAudioDevices } from "@/hooks/useAudioDevices"
import { LOCALE_NAMES, LOCALES, type Locale } from "@nexspeak/i18n"
import { VoiceProcessingSettings } from "@/components/nexspeak/voice-processing-settings"
import { MicrophoneTest } from "@/components/nexspeak/microphone-test"
import {
  getDefaultAudioSettings,
  loadAudioSettings,
  saveAudioSettings,
  subscribeAudioSettings,
} from "@/lib/audio-settings"

export type SettingsTab = "profile" | "audio" | "video" | "notifications" | "security" | "account" | "about" | "messages"

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The tab shown when the dialog opens. */
  initialTab?: SettingsTab
}

// Radix Select doesn't allow an empty string as item value.
const DEFAULT_DEVICE = "__default__"

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

export function SettingsDialog(props: SettingsDialogProps) {
  return <SettingsDialogContent key={`${props.open}:${props.initialTab}`} {...props} />
}

function SettingsDialogContent({ open, onOpenChange, initialTab = "audio" }: SettingsDialogProps) {
  const { t, locale, setLocale } = useTranslation()
  const { session, logout } = useMatrix()
  const { status: securityStatus } = useSecurity()
  const settings = useSyncExternalStore(subscribeAudioSettings, loadAudioSettings, getDefaultAudioSettings)
  const [activeTab, setActiveTab] = useState(initialTab)
  const { inputs, outputs, permissionError, namesHidden, refresh } = useAudioDevices(open && activeTab === "audio")
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
      {/* Fixed height, so the dialog doesn't jump when the tabs differ in height. */}
      <DialogContent className="h-[min(90dvh,42rem)] w-full max-w-lg content-start overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("settings.title")}</DialogTitle>
          <DialogDescription>{t("settings.description")}</DialogDescription>
        </DialogHeader>

        {/* Remounted per opening and requested tab (the menus' "Check for updates…" switches to About
            while it is open), so it starts at the requested tab. min-w-0: unbreakable
            content must not widen the dialog's grid column. */}
        <Tabs key={`${open}:${initialTab}`} defaultValue={initialTab} onValueChange={(value) => setActiveTab(value as SettingsTab)} className="w-full min-w-0">
          <TabsList className="grid h-auto w-full grid-cols-3">
            <TabsTrigger value="profile">{t("settings.profile")}</TabsTrigger>
            <TabsTrigger value="audio">{t("settings.audio")}</TabsTrigger>
            <TabsTrigger value="video">{t("settings.video")}</TabsTrigger>
            <TabsTrigger value="messages">{t("linkPreview.messages")}</TabsTrigger>
            <TabsTrigger value="notifications">{t("settings.notifications")}</TabsTrigger>
            <TabsTrigger value="security">{t("settings.security")}</TabsTrigger>
            <TabsTrigger value="account">{t("settings.account")}</TabsTrigger>
            <TabsTrigger value="about">{t("settings.about")}</TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <ProfilePanel />
          </TabsContent>

          <TabsContent value="video">
            <CameraSettings />
          </TabsContent>

          <TabsContent value="about">
            <AboutPanel />
          </TabsContent>

          <TabsContent value="messages">
            <LinkPreviewSettingsPanel />
          </TabsContent>

          <TabsContent value="notifications">
            <NotificationSettingsPanel />
          </TabsContent>

          <TabsContent value="security">
            <SecurityPanel />
          </TabsContent>

          <TabsContent value="audio" className="space-y-6">
            {permissionError && (
              <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {t("settings.noMicAccess")}
              </p>
            )}
            {namesHidden && !permissionError && (
              <p className="text-xs text-muted-foreground">{t("settings.audioDeviceNamesHidden")}</p>
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
            </div>

            <CallInputSettings settings={settings} />

            <VoiceProcessingSettings settings={settings} />

            <MicrophoneTest settings={settings} onAccess={refresh} />

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
            <SystemAudioSetting />
            <SoundCueSettings settings={settings} />
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
            <DesktopAutostartSetting />
            <div className="space-y-1 rounded-lg bg-muted p-4 text-sm">
              <p className="text-muted-foreground">{t("settings.signedInAs")}</p>
              <p className="break-all font-medium text-foreground">{session?.userId}</p>
              <p className="pt-2 text-muted-foreground">{t("login.homeserver")}</p>
              <p className="break-all font-medium text-foreground">{session?.homeserverUrl}</p>
              <p className="pt-2 text-muted-foreground">{t("settings.device")}</p>
              <p className="break-all font-mono text-xs text-foreground">{session?.deviceId}</p>
            </div>
            {session?.oidc?.accountManagementUrl?.startsWith("https://") && (
              <Button asChild variant="outline" className="w-full">
                <a href={session.oidc.accountManagementUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  {t("settings.manageAccount")}
                </a>
              </Button>
            )}
            <IgnoredUsersList />
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
