"use client"

import { useEffect, useSyncExternalStore } from "react"
import { SyncState, type MatrixClient, type Room } from "matrix-js-sdk"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useMatrix } from "@/components/matrix-provider"
import { JoinRoomDialog } from "@/components/nexspeak/join-room-dialog"
import { useTranslation } from "@/hooks/useTranslation"
import { desktopBridge } from "@/lib/desktop"
import { getPendingLink, setPendingLink, subscribePendingLink, takePendingLink } from "@/lib/pending-link"
import { findDirectRoom, startDirectMessage } from "@nexspeak/core/matrix/direct"
import { describeMatrixError } from "@nexspeak/core/matrix/errors"
import { parseMatrixLink } from "@nexspeak/core/matrix/links"

/** Desktop app only: nexspeak:// links from the OS become pending links. */
export function DesktopDeepLinks() {
  useEffect(() => {
    return desktopBridge()?.onDeepLink((url) => {
      const link = parseMatrixLink(url)
      if (link) setPendingLink(link)
    })
  }, [])
  return null
}

function findJoinedRoom(client: MatrixClient, roomIdOrAlias: string): Room | null {
  const isJoined = (room: Room | null): room is Room => room?.getMyMembership() === "join"
  if (roomIdOrAlias.startsWith("!")) {
    const room = client.getRoom(roomIdOrAlias)
    return isJoined(room) ? room : null
  }
  return (
    client
      .getRooms()
      .find(
        (room) =>
          isJoined(room) && (room.getCanonicalAlias() === roomIdOrAlias || room.getAltAliases().includes(roomIdOrAlias)),
      ) ?? null
  )
}

/**
 * Opens Matrix links to rooms, servers and people once the client has synced: known rooms open
 * directly, unknown ones go through the join dialog, new direct messages need a confirmation.
 */
export function MatrixLinkHandler({
  openRoom,
  selectServer,
  onRoomJoined,
}: {
  openRoom: (roomId: string) => void
  selectServer: (spaceId: string) => void
  onRoomJoined: (roomId: string) => void
}) {
  const { t } = useTranslation()
  const { client, syncState } = useMatrix()
  const pending = useSyncExternalStore(subscribePendingLink, getPendingLink, () => null)
  const isReady = Boolean(client) && (syncState === SyncState.Prepared || syncState === SyncState.Syncing)
  const link = isReady && client && pending && pending.kind !== "sso" ? pending : null

  const joinedRoom = client && link?.kind === "room" ? findJoinedRoom(client, link.roomIdOrAlias) : null
  const isOwnUser = link?.kind === "user" && link.userId === client?.getUserId()
  const directRoom = client && link?.kind === "user" && !isOwnUser ? findDirectRoom(client, link.userId) : null
  // What still needs the user: joining an unknown room, starting a new direct message.
  const joinTarget = link?.kind === "room" && !joinedRoom ? link : null
  const directMessageUserId = link?.kind === "user" && !isOwnUser && !directRoom ? link.userId : null

  // Rooms, servers and direct messages the user already has just open.
  useEffect(() => {
    if (joinedRoom) {
      takePendingLink(["room"])
      if (joinedRoom.isSpaceRoom()) selectServer(joinedRoom.roomId)
      else openRoom(joinedRoom.roomId)
    } else if (directRoom || isOwnUser) {
      takePendingLink(["user"])
      if (directRoom) openRoom(directRoom.roomId)
    }
  }, [joinedRoom, directRoom, isOwnUser, openRoom, selectServer])

  const dismiss = () => takePendingLink(["room", "user"])

  const startDirectMessageWith = async (userId: string) => {
    if (!client) return
    try {
      onRoomJoined(await startDirectMessage(client, [userId]))
    } catch (error) {
      toast.error(describeMatrixError(error, t("dm.startFailed")))
    }
  }

  return (
    <>
      {joinTarget && (
        <JoinRoomDialog
          key={joinTarget.roomIdOrAlias}
          open
          onOpenChange={(open) => !open && dismiss()}
          initialAddress={joinTarget.roomIdOrAlias}
          via={joinTarget.via}
          onJoined={onRoomJoined}
        />
      )}
      <AlertDialog open={directMessageUserId !== null} onOpenChange={(open) => !open && dismiss()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("link.startDmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("link.startDmDescription", { user: directMessageUserId ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => directMessageUserId && void startDirectMessageWith(directMessageUserId)}
            >
              {t("dm.start")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
