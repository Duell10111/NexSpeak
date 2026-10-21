'use client'

import { useContext, useEffect, useReducer } from 'react'
import { ClientEvent, RoomStateEvent } from 'matrix-js-sdk'
import { availableStickers, EMOTE_ROOMS_EVENT, ROOM_EMOTES_EVENT, USER_EMOTES_EVENT } from '@nexspeak/core/matrix/custom-emojis'
import { EmojiServerContext } from '@/hooks/useServerEmojis'
import { useMatrixClient } from '@/hooks/useMatrixClient'

/** Only an open sticker tab listens for changes; all packs come from the SDK's sync cache. */
export function useStickers(active: boolean) {
  const serverId = useContext(EmojiServerContext)
  const { client } = useMatrixClient()
  const [, changed] = useReducer((version: number) => version + 1, 0)
  useEffect(() => {
    if (!active || !client) return
    let frame: number | null = null
    const update = () => {
      if (frame === null) frame = requestAnimationFrame(() => { frame = null; changed() })
    }
    const state = (event: { getType(): string }) => { if (event.getType() === ROOM_EMOTES_EVENT) update() }
    const account = (event: { getType(): string }) => {
      if ([USER_EMOTES_EVENT, EMOTE_ROOMS_EVENT].includes(event.getType())) update()
    }
    client.on(RoomStateEvent.Events, state)
    client.on(ClientEvent.AccountData, account)
    client.on(ClientEvent.Room, update)
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      client.removeListener(RoomStateEvent.Events, state)
      client.removeListener(ClientEvent.AccountData, account)
      client.removeListener(ClientEvent.Room, update)
    }
  }, [active, client])
  return active && client ? availableStickers(client, serverId) : []
}
