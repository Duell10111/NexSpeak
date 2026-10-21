'use client'

import { createContext, useContext, useEffect, useReducer } from 'react'
import { RoomStateEvent } from 'matrix-js-sdk'
import { ROOM_EMOTES_EVENT, serverEmojis } from '@nexspeak/core/matrix/custom-emojis'
import { useMatrixClient } from '@/hooks/useMatrixClient'

export const EmojiServerContext = createContext<string | undefined>(undefined)

/** State is already in sync; parsing and subscriptions start only on explicit use. */
export function useServerEmojis(active: boolean, explicitServerId?: string) {
  const contextServerId = useContext(EmojiServerContext)
  const serverId = explicitServerId ?? contextServerId
  const { client } = useMatrixClient()
  const [, changed] = useReducer((version: number) => version + 1, 0)
  useEffect(() => {
    if (!active || !client || !serverId) return
    const listener = (event: { getRoomId(): string | undefined; getType(): string }) => {
      if (event.getRoomId() === serverId && [ROOM_EMOTES_EVENT, 'm.room.power_levels'].includes(event.getType())) changed()
    }
    client.on(RoomStateEvent.Events, listener)
    return () => { client.removeListener(RoomStateEvent.Events, listener) }
  }, [active, client, serverId])
  return active && client && serverId ? serverEmojis(client, serverId) : []
}
