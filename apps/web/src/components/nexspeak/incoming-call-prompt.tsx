"use client"

import { useEffect, useEffectEvent, useState, useSyncExternalStore } from "react"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useTranslation } from "@/hooks/useTranslation"
import { desktopBridge } from "@/lib/desktop"
import type { IncomingCall } from "@/lib/incoming-calls"
import {
  getDefaultNotificationSettings, loadNotificationSettings, subscribeNotificationSettings,
} from "@/lib/notification-settings"

export function IncomingCallPrompt({ incoming, onJoin, onDecline, onOpenRoom }: {
  incoming: IncomingCall
  onJoin: () => void
  onDecline: () => void
  onOpenRoom: (roomId: string) => void
}) {
  const { t } = useTranslation()
  const { enabled, showContent } = useSyncExternalStore(
    subscribeNotificationSettings, loadNotificationSettings, getDefaultNotificationSettings,
  )
  // The parent keys this component by room: membership renewals must not notify again.
  const [initial] = useState(incoming)
  const openConversation = useEffectEvent(() => { onOpenRoom(initial.roomId) })
  useEffect(() => {
    if (!enabled || document.hasFocus() || typeof Notification === "undefined" || Notification.permission !== "granted") return
    let notification: Notification
    try {
      // Electron presents web notifications through the OS, just like message notifications.
      notification = new Notification(t("incomingCall.title"), {
        body: showContent ? t("incomingCall.description", { caller: initial.callerNames, room: initial.roomName }) : t("incomingCall.privateDescription"),
        tag: `incoming-call:${initial.roomId}`,
      })
    } catch (error) {
      console.warn("Failed to show incoming call notification:", error)
      return
    }
    notification.onclick = () => {
      desktopBridge()?.showWindow()
      window.focus()
      openConversation()
      notification.close()
    }
    return () => { notification.close() }
  }, [initial, enabled, showContent, t])

  return (
    <AlertDialog open onOpenChange={(open) => { if (!open) onDecline() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("incomingCall.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("incomingCall.description", { caller: incoming.callerNames, room: incoming.roomName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onDecline}>{t("incomingCall.decline")}</AlertDialogCancel>
          <AlertDialogAction onClick={onJoin}>{t("incomingCall.join")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
