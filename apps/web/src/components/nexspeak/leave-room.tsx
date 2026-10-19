"use client"

import { toast } from "sonner"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useTranslation } from "@/hooks/useTranslation"
import { useCallContext } from "@/components/nexspeak/call-context"
import { useFriends } from "@/components/nexspeak/friends-context"
import { useNavigation } from "@/components/nexspeak/navigation-context"
import { ConfirmDialog } from "@/components/nexspeak/server-dialogs"
import { describeMatrixError } from "@nexspeak/core/matrix/errors"
import { leaveRoom } from "@nexspeak/core/matrix/leave"
import { DIRECT_MESSAGES_ID } from "@nexspeak/core/matrix/types"

/** Confirms leaving a DM or a room under Home; ends a call there first and goes back to Home. */
export function LeaveRoomDialog({
  room,
  open,
  onOpenChange,
}: {
  room: { id: string; name: string; isDirect: boolean }
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const { call, leaveCall } = useCallContext()
  const { openRoom, activeRoomId } = useNavigation()
  const isFriend = useFriends().some((friend) => friend.roomId === room.id && friend.status === "friend")

  const leave = () => {
    onOpenChange(false)
    if (!client) return
    if (call?.roomId === room.id) leaveCall()
    const wasActive = activeRoomId === room.id
    leaveRoom(client, room.id)
      .then(() => {
        if (wasActive) openRoom("", DIRECT_MESSAGES_ID)
      })
      .catch((error: unknown) => toast.error(describeMatrixError(error, t("leave.failed"))))
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("leave.title", { name: room.name })}
      description={
        isFriend ? t("leave.friendDescription") : room.isDirect ? t("leave.directDescription") : t("leave.roomDescription")
      }
      confirmLabel={t("leave.confirm")}
      onConfirm={leave}
    />
  )
}
