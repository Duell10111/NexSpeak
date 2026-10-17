import { useEffect, useRef, useSyncExternalStore } from "react"
import type { MatrixClient } from "matrix-js-sdk"
import { watchNotifications } from "@nexspeak/core/matrix/notifications"
import { useTranslation } from "@/hooks/useTranslation"
import { desktopBridge } from "@/lib/desktop"
import {
  getDefaultNotificationSettings,
  loadNotificationSettings,
  subscribeNotificationSettings,
} from "@/lib/notification-settings"

/**
 * System notifications for new messages (native in the desktop app, where Electron shows web
 * notifications through the OS). A click brings the window back and opens the room.
 */
export function useMessageNotifications(
  client: MatrixClient | null,
  activeRoomId: string,
  openRoom: (roomId: string) => void,
): void {
  const { t } = useTranslation()
  const settings = useSyncExternalStore(
    subscribeNotificationSettings,
    loadNotificationSettings,
    getDefaultNotificationSettings,
  )
  const activeRoomIdRef = useRef(activeRoomId)
  const openRoomRef = useRef(openRoom)
  useEffect(() => {
    activeRoomIdRef.current = activeRoomId
    openRoomRef.current = openRoom
  })

  const { enabled, showContent } = settings
  useEffect(() => {
    if (!client || !enabled || typeof Notification === "undefined") return
    return watchNotifications(client, (message) => {
      if (Notification.permission !== "granted") return
      // The room is open in front of the user: nothing to tell.
      if (message.roomId === activeRoomIdRef.current && document.hasFocus()) return

      const title = message.isDirect
        ? message.senderName
        : t("notification.titleInRoom", { sender: message.senderName, room: message.roomName })
      // One notification per room: a new message replaces the previous one.
      const notification = new Notification(title, {
        body: showContent ? message.body : t("notification.newMessage"),
        tag: message.roomId,
      })
      notification.onclick = () => {
        desktopBridge()?.showWindow()
        window.focus()
        openRoomRef.current(message.roomId)
        notification.close()
      }
    })
  }, [client, enabled, showContent, t])
}

/** Unread count in the window title and on the desktop app's badge. */
export function useAttentionBadge(count: number): void {
  useEffect(() => {
    const title = document.title.replace(/^\(\d+\+?\) /, "")
    document.title = count > 0 ? `(${count > 99 ? "99+" : count}) ${title}` : title
    desktopBridge()?.setBadgeCount(count)
  }, [count])
}
