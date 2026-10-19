/**
 * Leaving a direct message or a room outside a server. Unlike leaving a server this is a single
 * room: our friend marker is taken back first, then the room is left, dropped from m.direct and
 * forgotten so it doesn't come back in the room list.
 */

import type { MatrixClient } from 'matrix-js-sdk'
import { forgetDirectRoom } from './direct'
import { withdrawFriendMarker } from './friends'

export async function leaveRoom(client: MatrixClient, roomId: string): Promise<void> {
  // Best effort: the other side sees us leave either way.
  await withdrawFriendMarker(client, roomId).catch((error: unknown) => console.warn('Withdrawing the friend marker failed:', error))
  await client.leave(roomId)
  await forgetDirectRoom(client, roomId).catch((error: unknown) => console.warn('Updating m.direct failed:', error))
  await client.forget(roomId).catch((error: unknown) => console.warn('Forgetting the room failed:', error))
}
