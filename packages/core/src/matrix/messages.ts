/**
 * Sending, editing, reacting to and deleting messages.
 */

import {
  EventType,
  MsgType,
  RelationType,
  THREAD_RELATION_TYPE,
  type MatrixClient,
  type MatrixEvent,
} from 'matrix-js-sdk'
import type { RoomMessageEventContent } from 'matrix-js-sdk/lib/@types/events'
import { encryptAttachment } from './attachments'
import { markdownToHtml } from './markdown'
import { parseMatrixLink } from './links'
import { t } from '@nexspeak/i18n'

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
  /** "@room" was picked and we may notify the whole room. */
  mentionsRoom?: boolean
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
function textContent(body: string, msgtype: MsgType, mentions: MessageMention[] = []) {
  const html = markdownToHtml(body, mentions)
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
    ...textContent(isEmote ? body.slice(4) : body, isEmote ? MsgType.Emote : MsgType.Text, options.mentions),
    ...relation(options),
    ...intentionalMentions(client, options),
  } as RoomMessageEventContent
  return client.sendMessage(roomId, content)
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
): Promise<unknown> {
  const eventId = original.getId()
  if (!eventId) throw new Error(t('error.messageNotSent'))
  const msgtype = original.getContent().msgtype === MsgType.Emote ? MsgType.Emote : MsgType.Text
  const newContent = textContent(body, msgtype, links)
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
  return client.sendMessage(roomId, content)
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

  let source: { url: string } | { file: Record<string, unknown> }
  if (encrypt) {
    const { ciphertext, info: encryptionInfo } = await encryptAttachment(await file.arrayBuffer())
    const { content_uri: url } = await client.uploadContent(new Blob([ciphertext]), {
      type: 'application/octet-stream',
      includeFilename: false,
    })
    source = { file: { ...encryptionInfo, url } }
  } else {
    const { content_uri: url } = await client.uploadContent(file, { name: file.name, type: file.type })
    source = { url }
  }

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
