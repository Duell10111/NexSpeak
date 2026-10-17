"use client"

import { useState, useSyncExternalStore } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useTranslation } from "@/hooks/useTranslation"
import {
  getDefaultNotificationSettings,
  loadNotificationSettings,
  saveNotificationSettings,
  subscribeNotificationSettings,
} from "@/lib/notification-settings"

function currentPermission(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission
}

export function NotificationSettingsPanel() {
  const { t } = useTranslation()
  const settings = useSyncExternalStore(
    subscribeNotificationSettings,
    loadNotificationSettings,
    getDefaultNotificationSettings,
  )
  const [permission, setPermission] = useState(currentPermission)

  // Browsers only ask after a click; the desktop app grants it on its own.
  const requestPermission = () => {
    void Notification.requestPermission().then(setPermission)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="notifications-enabled">{t("settings.notificationsEnabled")}</Label>
        <Switch
          id="notifications-enabled"
          checked={settings.enabled}
          onCheckedChange={(enabled) => saveNotificationSettings({ enabled })}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="notifications-content">{t("settings.notificationsShowContent")}</Label>
        <Switch
          id="notifications-content"
          checked={settings.showContent}
          disabled={!settings.enabled}
          onCheckedChange={(showContent) => saveNotificationSettings({ showContent })}
        />
      </div>

      {settings.enabled && permission === "default" && (
        <Button size="sm" variant="outline" onClick={requestPermission} className="w-full">
          {t("settings.notificationsAllow")}
        </Button>
      )}
      {settings.enabled && permission === "denied" && (
        <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{t("settings.notificationsBlocked")}</p>
      )}

      <p className="text-xs text-muted-foreground">{t("settings.notificationsHint")}</p>
    </div>
  )
}
