import { describe, expect, it, vi } from 'vitest'
import { MatrixEvent, type MatrixClient } from 'matrix-js-sdk'
import { GIF_FAVOURITES_EVENT, gifFavourites, toggleGifFavourite } from './gif-favourites'

function fakeClient(content?: unknown) {
  const event = content === undefined ? undefined : new MatrixEvent({ type: GIF_FAVOURITES_EVENT, content: content as Record<string, unknown> })
  return {
    getAccountData: (type: string) => (type === GIF_FAVOURITES_EVENT ? event : undefined),
    setAccountData: vi.fn().mockResolvedValue({}),
  }
}

describe('GIF favourites', () => {
  it('reads KLIPY ids and ignores malformed entries', () => {
    const client = fakeClient({ gifs: [{ provider: 'klipy', id: 'a' }, { provider: 'other', id: 'x' }, { id: 'b' }, null, { provider: 'klipy', id: '' }] })
    expect(gifFavourites(client as unknown as MatrixClient)).toEqual(['a'])
    expect(gifFavourites(fakeClient() as unknown as MatrixClient)).toEqual([])
    expect(gifFavourites(fakeClient({ gifs: 'nope' }) as unknown as MatrixClient)).toEqual([])
  })

  it('adds new favourites in front and keeps other providers', async () => {
    const client = fakeClient({ gifs: [{ provider: 'klipy', id: 'a' }, { provider: 'other', id: 'x' }] })
    await toggleGifFavourite(client as unknown as MatrixClient, 'b')
    expect(client.setAccountData).toHaveBeenCalledWith(GIF_FAVOURITES_EVENT, {
      gifs: [{ provider: 'klipy', id: 'b' }, { provider: 'klipy', id: 'a' }, { provider: 'other', id: 'x' }],
    })
  })

  it('removes an existing favourite', async () => {
    const client = fakeClient({ gifs: [{ provider: 'klipy', id: 'a' }, { provider: 'klipy', id: 'b' }] })
    await toggleGifFavourite(client as unknown as MatrixClient, 'a')
    expect(client.setAccountData).toHaveBeenCalledWith(GIF_FAVOURITES_EVENT, { gifs: [{ provider: 'klipy', id: 'b' }] })
  })

  it('drops the oldest favourites beyond the limit', async () => {
    const gifs = Array.from({ length: 50 }, (_, index) => ({ provider: 'klipy', id: String(index) }))
    const client = fakeClient({ gifs })
    await toggleGifFavourite(client as unknown as MatrixClient, 'new')
    const stored = client.setAccountData.mock.calls[0][1].gifs
    expect(stored).toHaveLength(50)
    expect(stored[0].id).toBe('new')
    expect(stored.at(-1).id).toBe('48')
  })
})
