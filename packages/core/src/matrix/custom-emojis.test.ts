import { describe, expect, it, vi } from 'vitest'
import type { MatrixClient } from 'matrix-js-sdk'
import { availableStickers, parseStickerPack, USER_EMOTES_EVENT, canManageEmoji, changeServerEmoji, findEmojiTrigger, parseEmojiPack, validShortcode } from './custom-emojis'

function clientWith(content: Record<string, unknown>, level = 100, maySend = true) {
  return {
    getUserId: () => '@me:test',
    getRoom: () => ({ getMember: () => ({ powerLevel: level }), currentState: {
      maySendStateEvent: () => maySend,
      getStateEvents: () => ({ getContent: () => content }),
    } }),
    sendStateEvent: vi.fn().mockResolvedValue({}),
  }
}

describe('server emoji packs', () => {
  it('accepts MXC emoji only and excludes sticker-only packs and images', () => {
    expect(parseEmojiPack({ images: { cat: { url: 'mxc://test/cat' }, tracker: { url: 'https://tracker.test/pixel' }, sticker: { url: 'mxc://test/sticker', usage: ['sticker'] } } })).toEqual([
      { name: 'cat', url: 'mxc://test/cat', key: 'mxc://test/cat', packId: '' },
    ])
    expect(parseEmojiPack({ pack: { usage: ['sticker'] }, images: { cat: { url: 'mxc://test/cat' } } })).toEqual([])
  })

  it('preserves foreign pack metadata and image info on rename and delete', async () => {
    const image = { url: 'mxc://test/cat', body: 'Cat', info: { mimetype: 'image/png' }, extension: 1 }
    const content = { images: { cat: image, other: { url: 'mxc://test/other' } }, pack: { attribution: 'Artist' }, extension: true }
    const client = clientWith(content)
    await changeServerEmoji(client as unknown as MatrixClient, '!server', { packId: 'foreign', oldName: 'cat', name: 'kitten' })
    expect(client.sendStateEvent).toHaveBeenCalledWith('!server', 'im.ponies.room_emotes', {
      ...content, images: { kitten: image, other: content.images.other },
    }, 'foreign')
    await changeServerEmoji(client as unknown as MatrixClient, '!server', { oldName: 'cat' })
    expect(client.sendStateEvent.mock.calls[1][2]).toMatchObject({ images: { other: content.images.other } })
    expect(client.sendStateEvent.mock.calls[1][2].images).not.toHaveProperty('cat')
  })

  it('deletes only one usage of an unrestricted image and removes it once no usage is left', async () => {
    const image = { url: 'mxc://test/cat', body: 'Cat' }
    const client = clientWith({ images: { cat: image, sticker: { url: 'mxc://test/sticker', usage: ['sticker'] } } })
    await changeServerEmoji(client as unknown as MatrixClient, '!server', { oldName: 'cat', usage: 'sticker' })
    expect(client.sendStateEvent.mock.calls[0][2].images.cat).toEqual({ ...image, usage: ['emoticon'] })
    await changeServerEmoji(client as unknown as MatrixClient, '!server', { oldName: 'sticker', usage: 'sticker' })
    expect(client.sendStateEvent.mock.calls[1][2].images).not.toHaveProperty('sticker')
  })

  it('requires moderator role and the actual state-event permission', async () => {
    for (const client of [clientWith({}, 0, true), clientWith({}, 50, false)]) {
      expect(canManageEmoji(client as unknown as MatrixClient, '!server')).toBe(false)
      await expect(changeServerEmoji(client as unknown as MatrixClient, '!server', { name: 'cat', image: { url: 'mxc://test/cat' } })).rejects.toThrow('permission')
      expect(client.sendStateEvent).not.toHaveBeenCalled()
    }
  })

  it('rejects collisions, invalid names, unsafe URLs and oversized state', async () => {
    const client = clientWith({ images: { cat: { url: 'mxc://test/cat' } } }) as unknown as MatrixClient
    await expect(changeServerEmoji(client, '!server', { name: 'cat', image: { url: 'mxc://test/new' } })).rejects.toThrow('exists')
    await expect(changeServerEmoji(client, '!server', { name: '__proto__', image: { url: 'https://bad' } })).rejects.toThrow('URL')
    await expect(changeServerEmoji(client, '!server', { name: 'bad name', image: { url: 'mxc://test/new' } })).rejects.toThrow('shortcode')
    await expect(changeServerEmoji(client, '!server', { name: 'huge', image: { url: 'mxc://test/new', body: 'x'.repeat(51_000) } })).rejects.toThrow('full')
  })

  it('finds shortcode triggers without treating URLs or completed emoji as triggers', () => {
    expect(findEmojiTrigger('hi :ca', 6)).toEqual({ start: 3, query: 'ca' })
    expect(findEmojiTrigger(':', 1)).toEqual({ start: 0, query: '' })
    expect(findEmojiTrigger('https://example', 15)).toBeNull()
    expect(findEmojiTrigger(':cat:', 5)).toBeNull()
    expect(validShortcode('Cat-1_ok')).toBe(true)
    expect(validShortcode('x'.repeat(101))).toBe(false)
  })

  it('treats prototype-like shortcodes as ordinary image names', async () => {
    const client = clientWith({ images: {} })
    await changeServerEmoji(client as unknown as MatrixClient, '!server', { name: '__proto__', image: { url: 'mxc://test/cat' } })
    const images = client.sendStateEvent.mock.calls[0][2].images
    expect(Object.hasOwn(images, '__proto__')).toBe(true)
    expect(JSON.parse(JSON.stringify(images))).toEqual({ ['__proto__']: { url: 'mxc://test/cat' } })
  })
})

describe('sticker packs', () => {
  it('respects image overrides, pack defaults and unrestricted packs while rejecting unsafe URLs', () => {
    const images = {
      cat: { url: 'mxc://test/cat', body: 'Happy cat', info: { w: 256, h: -1, size: 'bad', mimetype: 'image/gif', thumbnail_url: 'https://tracker' } },
      emoji: { url: 'mxc://test/emoji', usage: ['emoticon'] },
      override: { url: 'mxc://test/override', usage: ['sticker'] },
      unsafe: { url: 'https://tracker.test/pixel' },
    }
    expect(parseStickerPack({ pack: { display_name: 'Cats', usage: ['sticker'] }, images }, 'cats')).toEqual([
      { name: 'cat', url: 'mxc://test/cat', key: 'mxc://test/cat', packId: 'cats', packName: 'Cats', body: 'Happy cat', info: { w: 256, mimetype: 'image/gif' } },
      { name: 'override', url: 'mxc://test/override', key: 'mxc://test/override', packId: 'cats', packName: 'Cats', body: 'override', info: {} },
    ])
    expect(parseStickerPack({ pack: { usage: ['emoticon'] }, images }).map((image) => image.name)).toEqual(['override'])
    expect(parseStickerPack({ images }).map((image) => image.name)).toEqual(['cat', 'override'])
    expect(parseStickerPack({ pack: { usage: [] }, images: { cat: images.cat } })).toHaveLength(1)
    expect(parseEmojiPack({ pack: { usage: ['sticker'] }, images }).map((image) => image.name)).toEqual(['emoji'])
  })

  it('combines personal, enabled room and server packs without duplicate room packs or fetching', () => {
    const content = { pack: { usage: ['sticker'] }, images: { cat: { url: 'mxc://test/cat' } } }
    const event = { getStateKey: () => '', getContent: () => content }
    const client = {
      getAccountData: (type: string) => ({ getContent: () => type === USER_EMOTES_EVENT ? content : { rooms: { '!server': { '': {} }, '!other': { '': {} }, '!missing': { '': {} } } } }),
      getRoom: (id: string) => id === '!missing' ? undefined : { name: id, currentState: { getStateEvents: (_type: string, stateKey?: string) => stateKey === undefined ? [event] : event } },
    } as unknown as MatrixClient
    const result = availableStickers(client, '!server')
    expect(result).toHaveLength(3)
    expect(new Set(result.map((sticker) => sticker.packId)).size).toBe(3)
    expect(availableStickers(client)).toHaveLength(3)
  })
})
