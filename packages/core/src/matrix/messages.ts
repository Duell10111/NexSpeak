/**
 * Sending, editing, reacting to and deleting messages.
 */

import { EventType, MsgType, RelationType, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk'
import type { RoomMessageEventContent } from 'matrix-js-sdk/lib/@types/events'
import { encryptAttachment } from './attachments'
import { t } from '@nexspeak/i18n'

function replyRelation(replyTo: MatrixEvent | undefined) {
  const eventId = replyTo?.getId()
  if (!replyTo || !eventId) return {}
  const sender = replyTo.getSender()
  return {
    'm.relates_to': { 'm.in_reply_to': { event_id: eventId } },
    // Notify the author of the message we reply to.
    'm.mentions': sender ? { user_ids: [sender] } : {},
  }
}

export function sendTextMessage(
  client: MatrixClient,
  roomId: string,
  body: string,
  replyTo?: MatrixEvent,
): Promise<unknown> {
  const isEmote = body.startsWith('/me ')
  const content = {
    msgtype: isEmote ? MsgType.Emote : MsgType.Text,
    body: isEmote ? body.slice(4) : body,
    ...replyRelation(replyTo),
  } as RoomMessageEventContent
  return client.sendMessage(roomId, content)
}

export function editTextMessage(client: MatrixClient, roomId: string, original: MatrixEvent, body: string): Promise<unknown> {
  const eventId = original.getId()
  if (!eventId) throw new Error(t('error.messageNotSent'))
  const msgtype = original.getContent().msgtype === MsgType.Emote ? MsgType.Emote : MsgType.Text

  const content = {
    msgtype,
    body: `* ${body}`,
    'm.new_content': { msgtype, body },
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
  replyTo?: MatrixEvent,
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
    ...replyRelation(replyTo),
  } as RoomMessageEventContent

  return client.sendMessage(roomId, content)
}
