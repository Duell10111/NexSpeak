/**
 * useRoomInfo Hook
 * Snapshot of a room's header data that stays current when the room is renamed,
 * gets a new topic or enables encryption.
 */

'use client'

import { useEffect, useState } from 'react'
import { ClientEvent, RoomEvent, RoomStateEvent, type MatrixClient, type Room } from 'matrix-js-sdk'

export interface RoomInfo {
  roomId: string
  exists: boolean
  name: string
  topic: string
  isEncrypted: boolean
}

function readRoomInfo(client: MatrixClient, roomId: string): RoomInfo {
  const room = client.getRoom(roomId)
  if (!room) return { roomId, exists: false, name: '', topic: '', isEncrypted: false }

  const topic = room.currentState.getStateEvents('m.room.topic', '')?.getContent().topic
  return {
    roomId,
    exists: true,
    name: room.name || room.getCanonicalAlias() || 'Unbenannter Raum',
    topic: typeof topic === 'string' ? topic : '',
    isEncrypted: room.hasEncryptionStateEvent(),
  }
}

export function useRoomInfo(client: MatrixClient | null, roomId: string): RoomInfo | null {
  const [info, setInfo] = useState<RoomInfo | null>(null)

  useEffect(() => {
    if (!client || !roomId) return

    const refresh = () => setInfo(readRoomInfo(client, roomId))
    const onRoom = (room: Room | undefined) => {
      if (!room || room.roomId === roomId) refresh()
    }
    const onStateEvent = (event: { getRoomId: () => string | undefined }) => {
      if (event.getRoomId() === roomId) refresh()
    }

    queueMicrotask(refresh)
    client.on(ClientEvent.Room, onRoom)
    client.on(RoomEvent.Name, onRoom)
    client.on(RoomStateEvent.Events, onStateEvent)

    return () => {
      client.removeListener(ClientEvent.Room, onRoom)
      client.removeListener(RoomEvent.Name, onRoom)
      client.removeListener(RoomStateEvent.Events, onStateEvent)
    }
  }, [client, roomId])

  return info && info.roomId === roomId ? info : null
}
