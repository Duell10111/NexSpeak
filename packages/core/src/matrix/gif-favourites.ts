/**
 * Favourite GIFs in account data, so they follow the user across devices.
 * Only provider ids are stored; the picker fetches the renditions when it opens.
 */

import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk'
import { MAX_GIF_IDS } from '../gifs'

export const GIF_FAVOURITES_EVENT = 'io.nexspeak.gif_favourites'
const PROVIDER = 'klipy'

interface StoredFavourite { provider: string; id: string }

function stored(client: MatrixClient): StoredFavourite[] {
  const event = (client.getAccountData as (type: string) => MatrixEvent | undefined).call(client, GIF_FAVOURITES_EVENT)
  const gifs = (event?.getContent() as { gifs?: unknown } | undefined)?.gifs
  if (!Array.isArray(gifs)) return []
  return gifs.filter((gif): gif is StoredFavourite =>
    Boolean(gif) && typeof gif.provider === 'string' && typeof gif.id === 'string' && gif.id.length > 0)
}

/** KLIPY ids, newest first. */
export function gifFavourites(client: MatrixClient): string[] {
  return stored(client).filter((gif) => gif.provider === PROVIDER).map((gif) => gif.id)
}

/** Add a GIF in front or remove it; the oldest favourites drop out beyond the limit. */
export function toggleGifFavourite(client: MatrixClient, id: string): Promise<unknown> {
  const all = stored(client)
  const isFavourite = all.some((gif) => gif.provider === PROVIDER && gif.id === id)
  const others = all.filter((gif) => !(gif.provider === PROVIDER && gif.id === id))
  const gifs = isFavourite ? others : [{ provider: PROVIDER, id }, ...others]
  const ours = gifs.filter((gif) => gif.provider === PROVIDER).slice(0, MAX_GIF_IDS)
  const content = { gifs: [...ours, ...gifs.filter((gif) => gif.provider !== PROVIDER)] }
  return (client.setAccountData as (type: string, content: object) => Promise<unknown>).call(client, GIF_FAVOURITES_EVENT, content)
}
