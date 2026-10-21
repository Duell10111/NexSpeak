"use client"

import { BellRing } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useTranslation } from "@/hooks/useTranslation"
import { SOUND_CUE_GROUPS, saveAudioSettings, type AudioSettings, type SoundCueGroup } from "@/lib/audio-settings"
import type { MessageKey } from "@nexspeak/i18n"

const GROUP_LABELS: Record<SoundCueGroup, MessageKey> = {
  own: "settings.soundCueOwn",
  others: "settings.soundCueOthers",
  screenshare: "settings.soundCueScreenshare",
}

export function SoundCueSettings({ settings }: { settings: AudioSettings }) {
  const { t } = useTranslation()

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <BellRing className="h-4 w-4 text-muted-foreground" />
          <Label htmlFor="sound-cues" className="font-semibold">
            {t("settings.soundCues")}
          </Label>
        </div>
        <Switch
          id="sound-cues"
          checked={settings.soundCues}
          onCheckedChange={(soundCues) => saveAudioSettings({ soundCues })}
        />
      </div>
      {SOUND_CUE_GROUPS.map((group) => (
        <div key={group} className="flex items-center justify-between gap-4 pl-6">
          <Label htmlFor={`sound-cue-${group}`} className="font-normal">
            {t(GROUP_LABELS[group])}
          </Label>
          <Switch
            id={`sound-cue-${group}`}
            checked={settings.soundCueGroups[group]}
            disabled={!settings.soundCues}
            onCheckedChange={(enabled) =>
              saveAudioSettings({ soundCueGroups: { ...settings.soundCueGroups, [group]: enabled } })
            }
          />
        </div>
      ))}
      <div className="flex items-center justify-between gap-4 border-t pt-3">
        <Label htmlFor="soundboard-enabled">{t("soundboard.title")}</Label>
        <Switch id="soundboard-enabled" checked={settings.soundboardEnabled} onCheckedChange={(soundboardEnabled) => saveAudioSettings({ soundboardEnabled })} />
      </div>
      <div className="flex items-center gap-3">
        <Label htmlFor="soundboard-volume" className="shrink-0">{t("soundboard.volume")}</Label>
        <input id="soundboard-volume" type="range" min={0} max={100} value={settings.soundboardVolume} disabled={!settings.soundboardEnabled} onChange={(event) => saveAudioSettings({ soundboardVolume: Number(event.target.value) })} className="min-w-0 flex-1" />
        <span className="text-sm tabular-nums">{settings.soundboardVolume}%</span>
      </div>
      <p className="text-xs text-muted-foreground">{t("settings.soundCuesHint")}</p>
    </div>
  )
}
