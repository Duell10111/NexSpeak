"use client"

import { useEffect, useState } from "react"
import { Monitor } from "lucide-react"
import { toast } from "sonner"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useTranslation } from "@/hooks/useTranslation"
import { desktopBridge } from "@/lib/desktop"

/** Desktop app only: "Start at login" (into the tray). Hidden in the browser and in dev runs. */
export function DesktopAutostartSetting() {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    void desktopBridge()?.getAutostart().then(setEnabled)
  }, [])

  if (enabled === null) return null

  const change = (next: boolean) => {
    setEnabled(next)
    desktopBridge()
      ?.setAutostart(next)
      .then(setEnabled)
      .catch((error: unknown) => {
        console.error("Failed to change autostart:", error)
        setEnabled(!next)
        toast.error(t("desktop.autostartFailed"))
      })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Monitor className="h-4 w-4 text-muted-foreground" />
        <p className="font-semibold text-sm">{t("desktop.app")}</p>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Label htmlFor="autostart">{t("desktop.autostart")}</Label>
          <p className="text-xs text-muted-foreground">{t("desktop.autostartHint")}</p>
        </div>
        <Switch id="autostart" checked={enabled} onCheckedChange={change} />
      </div>
    </div>
  )
}
