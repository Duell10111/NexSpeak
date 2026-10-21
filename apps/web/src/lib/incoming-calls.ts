import type { MatrixClient } from "matrix-js-sdk"
import { getDirectRoomIds, isDirectRoom } from "@nexspeak/core/matrix/direct"
import type { RoomCallInfo } from "@/hooks/useRtcCallInfo"

export interface IncomingCall {
  roomId: string
  roomName: string
  callerNames: string
}

/** One prompt per continuous call, including after declining or joining on another device. */
export class IncomingCallTracker {
  private suppressed = new Set<string>()

  dismiss(roomId: string): void {
    this.suppressed.add(roomId)
  }

  retry(roomId: string): void {
    this.suppressed.delete(roomId)
  }

  update(client: MatrixClient, calls: Record<string, RoomCallInfo>, localRoomId: string): IncomingCall[] {
    for (const roomId of this.suppressed) {
      if (!calls[roomId]?.members.length) this.suppressed.delete(roomId)
    }

    const directIds = getDirectRoomIds(client)
    const ownId = client.getUserId()
    const incoming: IncomingCall[] = []
    for (const [roomId, info] of Object.entries(calls)) {
      const room = client.getRoom(roomId)
      if (!room || room.getMyMembership() !== "join" || !isDirectRoom(client, room, directIds)) continue
      if (roomId === localRoomId || info.members.some((member) => member.userId === ownId)) {
        this.suppressed.add(roomId)
      }
      if (this.suppressed.has(roomId)) continue
      const callers = info.members.filter((member) => member.userId !== ownId && !client.isUserIgnored(member.userId))
      if (!callers.length) continue
      incoming.push({ roomId, roomName: room.name, callerNames: callers.map((member) => member.name).join(", ") })
    }
    return incoming
  }
}
