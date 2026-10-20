"use client"

import { AudioLines } from "lucide-react"
import { NOISE_SUPPRESSION_MODES, type NoiseSuppressionMode } from "@nexspeak/core/audio-processing"
import type { MessageKey } from "@nexspeak/i18n"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useTranslation } from "@/hooks/useTranslation"
import { saveAudioSettings, type AudioSettings } from "@/lib/audio-settings"

const MODE_LABELS: Record<NoiseSuppressionMode, { label: MessageKey; hint: MessageKey }> = {
  browser: { label: "settings.noiseSuppressionBrowser", hint: "settings.noiseSuppressionBrowserHint" },
  enhanced: { label: "settings.noiseSuppressionEnhanced", hint: "settings.noiseSuppressionEnhancedHint" },
  off: { label: "settings.noiseSuppressionOff", hint: "settings.noiseSuppressionOffHint" },
}

export function VoiceProcessingSettings({ settings }: { settings: AudioSettings }) {
  const { t } = useTranslation()

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <AudioLines className="h-4 w-4 text-muted-foreground" />
        <Label className="font-semibold">{t("settings.voiceProcessing")}</Label>
      </div>

      <div className="space-y-2">
        <Label htmlFor="noise-suppression" className="font-normal">
          {t("settings.noiseSuppression")}
        </Label>
        <Select
          value={settings.noiseSuppression}
          onValueChange={(value) => saveAudioSettings({ noiseSuppression: value as NoiseSuppressionMode })}
        >
          <SelectTrigger id="noise-suppression">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NOISE_SUPPRESSION_MODES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {t(MODE_LABELS[mode].label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t(MODE_LABELS[settings.noiseSuppression].hint)}</p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="echo-cancellation" className="font-normal">
          {t("settings.echoCancellation")}
        </Label>
        <Switch
          id="echo-cancellation"
          checked={settings.echoCancellation}
          onCheckedChange={(echoCancellation) => saveAudioSettings({ echoCancellation })}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="auto-gain-control" className="font-normal">
          {t("settings.autoGainControl")}
        </Label>
        <Switch
          id="auto-gain-control"
          checked={settings.autoGainControl}
          onCheckedChange={(autoGainControl) => saveAudioSettings({ autoGainControl })}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t("settings.voiceProcessingHint")}</p>
    </div>
  )
}
