'use client'

import { useEffect, useMemo, useReducer } from 'react'
import { ClientEvent, type MatrixEvent } from 'matrix-js-sdk'
import { GIF_FAVOURITES_EVENT, gifFavourites } from '@nexspeak/core/matrix/gif-favourites'
import { useMatrixClient } from '@/hooks/useMatrixClient'

/** Favourite GIF ids from synced account data; only an open picker listens for changes. */
export function useGifFavourites(active: boolean): string[] {
  const { client } = useMatrixClient()
  const [version, changed] = useReducer((version: number) => version + 1, 0)
  useEffect(() => {
    if (!active || !client) return
    const update = (event: MatrixEvent) => { if (event.getType() === GIF_FAVOURITES_EVENT) changed() }
    client.on(ClientEvent.AccountData, update)
    return () => { client.removeListener(ClientEvent.AccountData, update) }
  }, [active, client])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- version marks account data changes
  return useMemo(() => active && client ? gifFavourites(client) : [], [active, client, version])
}
