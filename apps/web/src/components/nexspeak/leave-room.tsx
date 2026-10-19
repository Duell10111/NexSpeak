"use client"

import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useTranslation } from "@/hooks/useTranslation"
import { runAction } from "@/lib/run-action"
import { useCallContext } from "@/components/nexspeak/call-context"
import { useFriends } from "@/components/nexspeak/friends-context"
import { useNavigation } from "@/components/nexspeak/navigation-context"
import { ConfirmDialog } from "@/components/nexspeak/server-dialogs"
import { leaveRoom } from "@nexspeak/core/matrix/leave"
import { DIRECT_MESSAGES_ID } from "@nexspeak/core/matrix/types"

/**
 * Confirms leaving a DM or a room under Home; ends a call there first and goes back to Home.
 * Mount it only while it is open.
 */
export function LeaveRoomDialog({
  room,
  onClose,
}: {
  room: { id: string; name: string; isDirect: boolean }
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const { endCallIn } = useCallContext()
  const { openRoom, activeRoomId } = useNavigation()
  const isFriend = useFriends().some((friend) => friend.roomId === room.id && friend.status === "friend")

  const leave = () => {
    onClose()
    if (!client) return
    // Right away: by the time the requests finish, the user may have opened another room.
    if (activeRoomId === room.id) openRoom("", DIRECT_MESSAGES_ID)
    // The call membership has to be withdrawn while we are still in the room.
    runAction(
      endCallIn(room.id).then(() => leaveRoom(client, room.id)),
      t("leave.failed"),
    )
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("leave.title", { name: room.name })}
      description={
        isFriend ? t("leave.friendDescription") : room.isDirect ? t("leave.directDescription") : t("leave.roomDescription")
      }
      confirmLabel={t("leave.confirm")}
      onConfirm={leave}
    />
  )
}
