'use client'

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { EventType, RoomStateEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk'
import { getPinnedEventIds } from '@nexspeak/core/matrix/pins'

const EMPTY: string[] = []

/** The pinned event ids of a room, updated when the pins change (only that state event). */
export function usePinnedEventIds(client: MatrixClient | null, roomId: string): string[] {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!client) return () => {}
      const onStateEvent = (event: MatrixEvent) => {
        if (event.getRoomId() === roomId && event.getType() === EventType.RoomPinnedEvents) onChange()
      }
      client.on(RoomStateEvent.Events, onStateEvent)
      return () => {
        client.removeListener(RoomStateEvent.Events, onStateEvent)
      }
    },
    [client, roomId],
  )
  // Joined to a string so the snapshot only changes when the list does.
  const getSnapshot = useCallback(() => getPinnedEventIds(client?.getRoom(roomId)).join('\n'), [client, roomId])
  const joined = useSyncExternalStore(subscribe, getSnapshot, () => '')
  return useMemo(() => (joined ? joined.split('\n') : EMPTY), [joined])
}
