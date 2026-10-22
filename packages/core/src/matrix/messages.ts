/**
 * Sending, editing, reacting to and deleting messages.
 */

import {
  EventType,
  EventStatus,
  MsgType,
  RelationType,
  THREAD_RELATION_TYPE,
  type MatrixClient,
  type MatrixEvent,
} from 'matrix-js-sdk'
import type { RoomMessageEventContent } from 'matrix-js-sdk/lib/@types/events'
import { encryptAttachment } from './attachments'
import { markdownToHtml, type MarkdownEmoji } from './markdown'
import { formattedEmojis, parseFormattedBody } from './formatted-body'
import { parseMatrixLink } from './links'
import { HIDE_LINK_PREVIEWS } from './link-previews'
import { t } from '@nexspeak/i18n'
import { isEmojiMxc, stickerInfo, type Sticker } from './custom-emojis'

/** A mention picked in the composer: its text in the message and whom it points to. */
export interface MessageMention {
  /** As written in the message, e.g. "@Alice" or "#general". */
  text: string
  /** matrix.to link (the pill). */
  href: string
  /** For people: they get notified (m.mentions). */
  userId?: string
}

export interface SendOptions {
  replyTo?: MatrixEvent
  /** Thread root, when the message goes into a thread. */
  threadRootId?: string
  /** Latest event in that thread: older clients show the message as a reply to it. */
  threadLatestEventId?: string
  mentions?: MessageMention[]
  customEmojis?: MarkdownEmoji[]
  /** "@room" was picked and we may notify the whole room. */
  mentionsRoom?: boolean
  hideLinkPreviews?: boolean
}

const HTML_FORMAT = 'org.matrix.custom.html'

function relation(options: SendOptions): Record<string, unknown> {
  const replyId = options.replyTo?.getId()
  if (options.threadRootId) {
    // In a thread a reply is a real reply; otherwise point older clients at the latest message.
    const fallbackId = replyId ?? options.threadLatestEventId ?? options.threadRootId
    return {
      'm.relates_to': {
        rel_type: THREAD_RELATION_TYPE.name,
        event_id: options.threadRootId,
        is_falling_back: !replyId,
        'm.in_reply_to': { event_id: fallbackId },
      },
    }
  }
  return replyId ? { 'm.relates_to': { 'm.in_reply_to': { event_id: replyId } } } : {}
}

/** Who is notified: picked mentions plus the author of the message we reply to (m.mentions). */
function intentionalMentions(client: MatrixClient, options: SendOptions): Record<string, unknown> {
  const userIds = new Set(options.mentions?.flatMap((mention) => (mention.userId ? [mention.userId] : [])))
  const replySender = options.replyTo?.getSender()
  if (replySender) userIds.add(replySender)
  userIds.delete(client.getUserId() ?? '')
  return { 'm.mentions': { ...(userIds.size > 0 && { user_ids: [...userIds] }), ...(options.mentionsRoom && { room: true }) } }
}

/** Plain body (the markdown source) and, if the markdown formats anything, the HTML. */
function textContent(body: string, msgtype: MsgType, mentions: MessageMention[] = [], emojis: MarkdownEmoji[] = []) {
  const html = markdownToHtml(body, mentions, emojis)
  return { msgtype, body, ...(html !== null && { format: HTML_FORMAT, formatted_body: html }) }
}

export function sendTextMessage(
  client: MatrixClient,
  roomId: string,
  body: string,
  options: SendOptions = {},
): Promise<unknown> {
  const isEmote = body.startsWith('/me ')
  const content = {
    ...textContent(isEmote ? body.slice(4) : body, isEmote ? MsgType.Emote : MsgType.Text, options.mentions, options.customEmojis),
    ...relation(options),
    ...intentionalMentions(client, options),
    ...(options.hideLinkPreviews && { [HIDE_LINK_PREVIEWS]: true }),
  } as RoomMessageEventContent
  return client.sendMessage(roomId, content)
}

/** The SDK handles encryption, local echoes and retries just like other timeline events. */
export function sendSticker(client: MatrixClient, roomId: string, sticker: Sticker, options: SendOptions = {}): Promise<unknown> {
  // Reject instead of throwing so callers' .catch() also handles invalid packs.
  if (!isEmojiMxc(sticker.url)) return Promise.reject(new Error('Invalid sticker image URL'))
  return client.sendEvent(roomId, EventType.Sticker, {
    body: sticker.body || sticker.name,
    url: sticker.url,
    info: stickerInfo(sticker.info),
    ...relation(options),
    ...intentionalMentions(client, options),
  })
}

/**
 * Replace a message's text. `links` are the pills of the original (formatted body), so mentions
 * survive editing without the composer's picker.
 */
export function editTextMessage(
  client: MatrixClient,
  roomId: string,
  original: MatrixEvent,
  body: string,
  links: MessageMention[] = [],
  hideLinkPreviews = original.getContent()[HIDE_LINK_PREVIEWS] === true,
): Promise<unknown> {
  const eventId = original.getId()
  if (!eventId) throw new Error(t('error.messageNotSent'))
  const msgtype = original.getContent().msgtype === MsgType.Emote ? MsgType.Emote : MsgType.Text
  const formatted = original.getContent().formatted_body
  const emojis = typeof formatted === 'string' ? formattedEmojis(parseFormattedBody(formatted)) : []
  const newContent = { ...textContent(body, msgtype, links, emojis), ...(hideLinkPreviews && { [HIDE_LINK_PREVIEWS]: true }) }
  const mentionedUserIds = links.flatMap((link) => {
    if (!body.includes(link.text)) return []
    const target = parseMatrixLink(link.href)
    return target?.kind === 'user' ? [target.userId] : []
  })

  const content = {
    ...newContent,
    body: `* ${body}`,
    ...(newContent.formatted_body !== undefined && { formatted_body: `* ${newContent.formatted_body}` }),
    // The new content lists everybody mentioned; the edit itself notifies nobody again.
    'm.new_content': { ...newContent, 'm.mentions': mentionedUserIds.length > 0 ? { user_ids: [...new Set(mentionedUserIds)] } : {} },
    'm.mentions': {},
    'm.relates_to': { rel_type: 'm.replace', event_id: eventId },
  } as RoomMessageEventContent
  return sendMessageEdit(client, roomId, eventId, content)
}

/** Preserve rich content and all relations when the sender suppresses a card. */
export function hideLinkPreview(client: MatrixClient, roomId: string, original: MatrixEvent): Promise<unknown> {
  const eventId = original.getId()
  if (!eventId) return Promise.reject(new Error(t('error.messageNotSent')))
  const newContent = { ...original.getContent<RoomMessageEventContent>(), [HIDE_LINK_PREVIEWS]: true }
  const content = {
    ...newContent,
    body: `* ${newContent.body ?? ''}`,
    ...('formatted_body' in newContent && typeof newContent.formatted_body === 'string' && { formatted_body: `* ${newContent.formatted_body}` }),
    'm.new_content': newContent,
    'm.mentions': {},
    'm.relates_to': { rel_type: 'm.replace', event_id: eventId },
  } as RoomMessageEventContent
  return sendMessageEdit(client, roomId, eventId, content)
}

function sendMessageEdit(client: MatrixClient, roomId: string, eventId: string, content: RoomMessageEventContent): Promise<unknown> {
  return client.sendMessage(roomId, content).catch((error: unknown) => {
    // The inline editor owns the retry draft. A failed local edit must not keep replacing
    // the original message or block later sends in the SDK's pending-event queue.
    const failed = client.getRoom(roomId)?.getPendingEvents().find((event) =>
      event.status === EventStatus.NOT_SENT && event.error === error &&
      event.getRelation()?.rel_type === 'm.replace' && event.getRelation()?.event_id === eventId,
    )
    if (failed) client.cancelPendingEvent(failed)
    throw error
  })
}

export function deleteMessage(client: MatrixClient, roomId: string, eventId: string): Promise<unknown> {
  return client.redactEvent(roomId, eventId)
}

/** Add our reaction, or take it back if we already reacted with this key. */
export function toggleReaction(
  client: MatrixClient,
  roomId: string,
  eventId: string,
  key: string,
  ownReactionEventId?: string,
): Promise<unknown> {
  if (ownReactionEventId) return client.redactEvent(roomId, ownReactionEventId)
  return client.sendEvent(roomId, EventType.Reaction, {
    'm.relates_to': { rel_type: RelationType.Annotation, event_id: eventId, key },
  })
}

async function readImageSize(file: File): Promise<{ w: number; h: number } | undefined> {
  try {
    const bitmap = await createImageBitmap(file)
    const size = { w: bitmap.width, h: bitmap.height }
    bitmap.close()
    return size
  } catch {
    return undefined
  }
}

/** In encrypted rooms the homeserver only ever stores ciphertext. */
async function uploadMedia(
  client: MatrixClient,
  data: Blob,
  name: string,
  type: string,
  encrypt: boolean,
): Promise<{ url: string } | { file: Record<string, unknown> }> {
  if (encrypt) {
    const { ciphertext, info } = await encryptAttachment(await data.arrayBuffer())
    const { content_uri: url } = await client.uploadContent(new Blob([ciphertext]), {
      type: 'application/octet-stream',
      includeFilename: false,
    })
    return { file: { ...info, url } }
  }
  const { content_uri: url } = await client.uploadContent(data, { name, type })
  return { url }
}

/**
 * Looping, silent playback without controls. The fi.mau.* flags are the convention of the mautrix
 * bridges, so GIFs bridged from Discord or Telegram play the same way.
 */
export const GIF_VIDEO_INFO = {
  'fi.mau.gif': true,
  'fi.mau.loop': true,
  'fi.mau.autoplay': true,
  'fi.mau.hide_controls': true,
  'fi.mau.no_audio': true,
} as const

export interface GifUpload {
  title: string
  data: Blob
  mimetype: string
  width: number
  height: number
  durationMs?: number
  /** First frame, so clients can show something before (or instead of) playing. */
  thumbnail?: { data: Blob; mimetype: string; width: number; height: number }
}

/** A picked GIF as a normal media message: a looping video, or m.image for real GIF files. */
export async function sendGif(
  client: MatrixClient,
  roomId: string,
  gif: GifUpload,
  encrypt: boolean,
  options: SendOptions = {},
): Promise<unknown> {
  const isVideo = gif.mimetype.startsWith('video/')
  const title = gif.title.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'GIF'
  const name = `${title}.${isVideo ? gif.mimetype.slice('video/'.length) : 'gif'}`
  const source = await uploadMedia(client, gif.data, name, gif.mimetype, encrypt)
  const thumbnail = isVideo && gif.thumbnail
    ? { ...gif.thumbnail, source: await uploadMedia(client, gif.thumbnail.data, 'thumbnail', gif.thumbnail.mimetype, encrypt) }
    : undefined
  const info = {
    mimetype: gif.mimetype,
    size: gif.data.size,
    ...(gif.width && gif.height && { w: gif.width, h: gif.height }),
    ...(isVideo && gif.durationMs && { duration: Math.round(gif.durationMs) }),
    ...(thumbnail && {
      ...('url' in thumbnail.source ? { thumbnail_url: thumbnail.source.url } : { thumbnail_file: thumbnail.source.file }),
      thumbnail_info: { mimetype: thumbnail.mimetype, size: thumbnail.data.size, w: thumbnail.width, h: thumbnail.height },
    }),
    ...(isVideo && GIF_VIDEO_INFO),
  }
  const content = {
    msgtype: isVideo ? MsgType.Video : MsgType.Image,
    body: gif.title.trim() || 'GIF',
    filename: name,
    info,
    ...source,
    ...relation(options),
    ...intentionalMentions(client, options),
  } as RoomMessageEventContent
  return client.sendMessage(roomId, content)
}

/**
 * Upload a file and post it. In encrypted rooms the file is encrypted client-side first,
 * so the homeserver only ever stores ciphertext.
 */
export async function sendAttachment(
  client: MatrixClient,
  roomId: string,
  file: File,
  encrypt: boolean,
  options: SendOptions = {},
): Promise<unknown> {
  const isImage = file.type.startsWith('image/')
  const imageSize = isImage ? await readImageSize(file) : undefined
  const info = { mimetype: file.type || undefined, size: file.size, ...imageSize }
  const source = await uploadMedia(client, file, file.name, file.type, encrypt)

  const content = {
    msgtype: isImage ? MsgType.Image : file.type.startsWith('video/') ? MsgType.Video : file.type.startsWith('audio/') ? MsgType.Audio : MsgType.File,
    body: file.name,
    filename: file.name,
    info,
    ...source,
    ...relation(options),
    ...intentionalMentions(client, options),
  } as RoomMessageEventContent

  return client.sendMessage(roomId, content)
}
