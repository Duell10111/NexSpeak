import { describe, expect, it, vi } from 'vitest'
import type { MatrixClient } from 'matrix-js-sdk'
import { canManageEmoji, changeServerEmoji, findEmojiTrigger, parseEmojiPack, validShortcode } from './custom-emojis'

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
