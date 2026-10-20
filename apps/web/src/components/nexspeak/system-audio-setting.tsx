"use client"

import { useId, useSyncExternalStore } from "react"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useTranslation } from "@/hooks/useTranslation"
import { desktopBridge } from "@/lib/desktop"
import { getDefaultAudioSettings, loadAudioSettings, saveAudioSettings, subscribeAudioSettings } from "@/lib/audio-settings"

/** The same remembered preference in Settings and the Go Live dialog; no media runs here. */
export function SystemAudioSetting() {
  const { t } = useTranslation()
  const id = useId()
  const settings = useSyncExternalStore(subscribeAudioSettings, loadAudioSettings, getDefaultAudioSettings)
  const bridge = desktopBridge()
  if (bridge && !bridge.supportsSystemAudio) return null

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-1">
        <Label htmlFor={id}>{t("stream.shareAudio")}</Label>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {t(bridge ? "stream.shareAudioHintDesktop" : "stream.shareAudioHintBrowser")}
        </p>
      </div>
      <Switch
        id={id}
        aria-describedby={`${id}-hint`}
        checked={settings.shareSystemAudio}
        onCheckedChange={(shareSystemAudio) => saveAudioSettings({ shareSystemAudio })}
      />
    </div>
  )
}
