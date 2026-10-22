"use client"

import { useSyncExternalStore } from "react"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useTranslation } from "@/hooks/useTranslation"
import { getDefaultGifSettings, loadGifSettings, saveGifSettings, subscribeGifSettings } from "@/lib/gif-settings"
import { GIF_PROVIDER, gifApiKey } from "@nexspeak/core/gifs"

export function GifSettingsPanel() {
  const { t } = useTranslation()
  const settings = useSyncExternalStore(subscribeGifSettings, loadGifSettings, getDefaultGifSettings)
  const available = Boolean(gifApiKey())

  return (
    <div className="space-y-5">
      <h3 className="font-semibold">{t("settings.gifs")}</h3>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="gif-search">{t("settings.gifSearch", { provider: GIF_PROVIDER })}</Label>
          <Switch
            id="gif-search"
            checked={available && settings.search}
            disabled={!available}
            onCheckedChange={(search) => saveGifSettings({ search })}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {available ? t("settings.gifSearchHint", { provider: GIF_PROVIDER }) : t("settings.gifSearchUnavailable")}
        </p>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="gif-autoplay">{t("settings.gifAutoplay")}</Label>
          <Switch
            id="gif-autoplay"
            checked={settings.autoplay}
            onCheckedChange={(autoplay) => saveGifSettings({ autoplay })}
          />
        </div>
        <p className="text-xs text-muted-foreground">{t("settings.gifAutoplayHint")}</p>
      </div>
    </div>
  )
}
