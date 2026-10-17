/**
 * useRoomInfo Hook
 * Snapshot of a room's header data that stays current when the room is renamed,
 * gets a new topic or enables encryption.
 */

'use client'

import { useEffect, useState } from 'react'
import { ClientEvent, RoomEvent, RoomStateEvent, type MatrixClient, type Room } from 'matrix-js-sdk'
import { t } from '@nexspeak/i18n'
import { isDirectRoom } from '@nexspeak/core/matrix/direct'

export interface RoomInfo {
  roomId: string
  exists: boolean
  name: string
  topic: string
  isEncrypted: boolean
  /** Direct message: shown with the person instead of a channel "#". */
  isDirect: boolean
}

function readRoomInfo(client: MatrixClient, roomId: string): RoomInfo {
  const room = client.getRoom(roomId)
  if (!room) return { roomId, exists: false, name: '', topic: '', isEncrypted: false, isDirect: false }

  const topic = room.currentState.getStateEvents('m.room.topic', '')?.getContent().topic
  return {
    roomId,
    exists: true,
    name: room.name || room.getCanonicalAlias() || t('room.unnamed'),
    topic: typeof topic === 'string' ? topic : '',
    isEncrypted: room.hasEncryptionStateEvent(),
    isDirect: isDirectRoom(client, room),
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
    client.on(ClientEvent.AccountData, refresh)

    return () => {
      client.removeListener(ClientEvent.Room, onRoom)
      client.removeListener(RoomEvent.Name, onRoom)
      client.removeListener(RoomStateEvent.Events, onStateEvent)
      client.removeListener(ClientEvent.AccountData, refresh)
    }
  }, [client, roomId])

  return info && info.roomId === roomId ? info : null
}
