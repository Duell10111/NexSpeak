/** MSC2545 image packs, using the interoperable im.ponies unstable event type. */
import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk'

export const ROOM_EMOTES_EVENT = 'im.ponies.room_emotes'
export const USER_EMOTES_EVENT = 'im.ponies.user_emotes'
export const EMOTE_ROOMS_EVENT = 'im.ponies.emote_rooms'
export const EMOJI_FILE_TYPES = 'image/png,image/jpeg,image/gif,image/webp'
export const MAX_EMOJI_BYTES = 2 * 1024 * 1024
const SHORTCODE = /^[a-zA-Z0-9_-]{1,100}$/
const MXC = /^mxc:\/\/[^/\s]+\/[^/?#\s]+$/

export interface CustomEmoji {
  name: string
  url: string
  /** The mxc URI is also the interoperable reaction key. */
  key: string
  packId: string
}

export function validShortcode(value: string): boolean { return SHORTCODE.test(value) }
export function isEmojiMxc(value: string): boolean { return MXC.test(value) }

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export type ImageUsage = 'emoticon' | 'sticker'

/** MSC2545: a missing or empty usage means the image is usable as both. */
function imageUsage(image: Record<string, unknown>, pack: Record<string, unknown>): string[] {
  const usage = image.usage ?? pack.usage
  return Array.isArray(usage) && usage.length ? usage.filter((value): value is string => typeof value === 'string') : ['emoticon', 'sticker']
}

export interface Sticker extends CustomEmoji {
  body: string
  info: { mimetype?: string; w?: number; h?: number; size?: number }
  packName: string
}

/** Ignore untrusted metadata fields; never send thumbnail URLs supplied by a pack. */
export function stickerInfo(value: unknown): Sticker['info'] {
  const info = object(value)
  const result: Sticker['info'] = {}
  if (typeof info.mimetype === 'string' && EMOJI_FILE_TYPES.split(',').includes(info.mimetype)) result.mimetype = info.mimetype
  for (const key of ['w', 'h', 'size'] as const) {
    const number = info[key]
    if (typeof number === 'number' && Number.isSafeInteger(number) && number > 0) result[key] = number
  }
  return result
}

export function parseStickerPack(content: unknown, packId = '', packName = ''): Sticker[] {
  const pack = object(content)
  const metadata = object(pack.pack)
  return Object.entries(object(pack.images)).flatMap(([name, value]) => {
    const image = object(value)
    // Older im.ponies clients allow an image's usage to override the pack default.
    if (!imageUsage(image, metadata).includes('sticker')) return []
    if (typeof image.url !== 'string' || !isEmojiMxc(image.url)) return []
    return [{ name, url: image.url, key: image.url, packId,
      body: typeof image.body === 'string' && image.body ? image.body : name,
      info: stickerInfo(image.info),
      packName: typeof metadata.display_name === 'string' ? metadata.display_name : packName,
    }]
  })
}

/** Read already-synced server, personal and globally enabled room packs; no network requests. */
export function availableStickers(client: MatrixClient, serverId?: string): Sticker[] {
  const stickers: Sticker[] = []
  const seen = new Set<string>()
  const addRoomPack = (roomId: string, stateKey: string) => {
    const id = JSON.stringify([roomId, stateKey])
    if (seen.has(id)) return
    seen.add(id)
    const room = client.getRoom(roomId)
    const event = room?.currentState.getStateEvents(ROOM_EMOTES_EVENT, stateKey)
    if (event) stickers.push(...parseStickerPack(event.getContent(), id, room?.name))
  }
  // Legacy personal packs remain widely used by im.ponies clients.
  // The SDK's account-data type map only lists stable event types.
  const accountData = (type: string) => (client.getAccountData as (type: string) => MatrixEvent | undefined).call(client, type)?.getContent()
  stickers.push(...parseStickerPack(accountData(USER_EMOTES_EVENT), 'personal'))
  const rooms = object(accountData(EMOTE_ROOMS_EVENT)?.rooms)
  for (const [roomId, packs] of Object.entries(rooms)) {
    for (const stateKey of Object.keys(object(packs))) addRoomPack(roomId, stateKey)
  }
  if (serverId) {
    for (const event of client.getRoom(serverId)?.currentState.getStateEvents(ROOM_EMOTES_EVENT) ?? []) {
      addRoomPack(serverId, event.getStateKey() ?? '')
    }
  }
  return stickers
}

export function parseEmojiPack(content: unknown, packId = ''): CustomEmoji[] {
  const pack = object(content)
  return Object.entries(object(pack.images)).flatMap(([name, value]) => {
    const image = object(value)
    if (typeof image.url !== 'string' || !isEmojiMxc(image.url)) return []
    if (!imageUsage(image, object(pack.pack)).includes('emoticon')) return []
    return [{ name, url: image.url, key: image.url, packId }]
  })
}

function serverPack<T extends CustomEmoji>(client: MatrixClient, serverId: string, parse: (content: unknown, packId: string) => T[]): T[] {
  return (client.getRoom(serverId)?.currentState.getStateEvents(ROOM_EMOTES_EVENT) ?? [])
    .flatMap((event) => parse(event.getContent(), event.getStateKey() ?? ''))
    .sort((a, b) => a.name.localeCompare(b.name) || a.packId.localeCompare(b.packId))
}

export function serverEmojis(client: MatrixClient, serverId: string): CustomEmoji[] {
  return serverPack(client, serverId, parseEmojiPack)
}

export function serverStickers(client: MatrixClient, serverId: string): Sticker[] {
  return serverPack(client, serverId, parseStickerPack)
}

export function canManageEmoji(client: MatrixClient, serverId: string): boolean {
  const room = client.getRoom(serverId)
  const ownId = client.getUserId() ?? ''
  return Boolean(room && (room.getMember(ownId)?.powerLevel ?? 0) >= 50 && room.currentState.maySendStateEvent(ROOM_EMOTES_EVENT, ownId))
}

/** Preserve pack metadata and other clients' image fields when renaming or deleting. */
export async function changeServerEmoji(
  client: MatrixClient, serverId: string,
  change: { packId?: string; oldName?: string; name?: string; image?: Record<string, unknown>; usage?: ImageUsage },
): Promise<void> {
  if (!canManageEmoji(client, serverId)) throw new Error('Insufficient permission to manage server emoji')
  const packId = change.packId ?? ''
  const content = { ...client.getRoom(serverId)?.currentState.getStateEvents(ROOM_EMOTES_EVENT, packId)?.getContent() }
  const images = { ...object(content.images) }
  if (change.name !== undefined) {
    if (!validShortcode(change.name)) throw new Error('Invalid emoji shortcode')
    if (change.name !== change.oldName && Object.hasOwn(images, change.name)) throw new Error('Emoji shortcode already exists')
    const image = change.image ?? object(images[change.oldName ?? ''])
    if (typeof image.url !== 'string' || !isEmojiMxc(image.url)) throw new Error('Invalid emoji image URL')
    Object.defineProperty(images, change.name, { value: image, enumerable: true, configurable: true, writable: true })
  }
  if (change.oldName && change.name === undefined && change.usage) {
    // Unrestricted images are emoji and sticker at once; deleting one usage keeps the other.
    const image = object(images[change.oldName])
    const remaining = imageUsage(image, object(content.pack)).filter((usage) => usage !== change.usage)
    if (remaining.length) {
      Object.defineProperty(images, change.oldName, { value: { ...image, usage: remaining }, enumerable: true, configurable: true, writable: true })
    } else delete images[change.oldName]
  } else if (change.oldName && change.oldName !== change.name) delete images[change.oldName]
  const next = { ...content, images }
  if (new TextEncoder().encode(JSON.stringify(next)).length > 50_000) throw new Error('Emoji pack is full')
  // The SDK permits custom state events, although its event map only lists stable types.
  type StateSender = (roomId: string, type: string, content: Record<string, unknown>, stateKey: string) => Promise<unknown>
  await (client.sendStateEvent as unknown as StateSender).call(client, serverId, ROOM_EMOTES_EVENT, next, packId)
}

export function findEmojiTrigger(text: string, caret: number): { start: number; query: string } | null {
  const match = /(?:^|\s):([a-zA-Z0-9_-]{0,100})$/.exec(text.slice(0, caret))
  return match ? { start: caret - match[1].length - 1, query: match[1] } : null
}
