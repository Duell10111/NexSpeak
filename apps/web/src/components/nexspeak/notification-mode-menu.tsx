"use client"

import { toast } from "sonner"
import { Bell, BellOff, BellRing, AtSign } from "lucide-react"
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu"
import { ContextMenuRadioGroup, ContextMenuRadioItem } from "@/components/ui/context-menu"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useNotificationMode } from "@/hooks/useNotificationMode"
import { useTranslation } from "@/hooks/useTranslation"
import { describeMatrixError } from "@nexspeak/core/matrix/errors"
import {
  ROOM_NOTIFICATION_MODES,
  setNotificationModeForRooms,
  type RoomNotificationMode,
} from "@nexspeak/core/matrix/room-notifications"
import type { MessageKey } from "@nexspeak/i18n"

export const NOTIFICATION_MODE_LABELS: Record<RoomNotificationMode, MessageKey> = {
  default: "notify.default",
  all: "notify.all",
  mentions: "notify.mentions",
  mute: "notify.mute",
}

export function NotificationModeIcon({ mode, className }: { mode: RoomNotificationMode | null; className?: string }) {
  if (mode === "mute") return <BellOff className={className} />
  if (mode === "mentions") return <AtSign className={className} />
  if (mode === "all") return <BellRing className={className} />
  return <Bell className={className} />
}

/** Current mode of the rooms and a setter that reports failures. */
function useNotificationModeControl(roomIds: string[]) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const mode = useNotificationMode(client, roomIds)

  const setMode = (value: string) => {
    if (!client || roomIds.length === 0) return
    setNotificationModeForRooms(client, roomIds, value as RoomNotificationMode).catch((error: unknown) => {
      toast.error(describeMatrixError(error, t("notify.failed")))
    })
  }

  return { mode, setMode }
}

/** Radio items for a dropdown (channel header, server menu). */
export function NotificationModeDropdownItems({ roomIds }: { roomIds: string[] }) {
  const { t } = useTranslation()
  const { mode, setMode } = useNotificationModeControl(roomIds)
  return (
    <DropdownMenuRadioGroup value={mode ?? ""} onValueChange={setMode}>
      {ROOM_NOTIFICATION_MODES.map((option) => (
        <DropdownMenuRadioItem key={option} value={option} onSelect={(event) => event.preventDefault()}>
          {t(NOTIFICATION_MODE_LABELS[option])}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}

/** The same as radio items of a right-click menu (channel list). */
export function NotificationModeContextItems({ roomIds }: { roomIds: string[] }) {
  const { t } = useTranslation()
  const { mode, setMode } = useNotificationModeControl(roomIds)
  return (
    <ContextMenuRadioGroup value={mode ?? ""} onValueChange={setMode}>
      {ROOM_NOTIFICATION_MODES.map((option) => (
        <ContextMenuRadioItem key={option} value={option}>
          {t(NOTIFICATION_MODE_LABELS[option])}
        </ContextMenuRadioItem>
      ))}
    </ContextMenuRadioGroup>
  )
}
