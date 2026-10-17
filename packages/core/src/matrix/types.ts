/**
 * Matrix Integration Type Definitions
 * Plain view models derived from matrix-js-sdk objects. Never mutate SDK state in here.
 */

import { EventStatus, NotificationCountType, type MatrixEvent, type Room } from 'matrix-js-sdk'
import { isEncryptedFile, type EncryptedFile } from './attachments'
import { t } from '@nexspeak/i18n'

export interface MatrixRoom {
  id: string
  name: string
  avatarMxc?: string
  /** The room's own avatar only (channel icon), without the fallback to a member's avatar. */
  iconMxc?: string
  unread: number
  highlights: number
  memberCount: number
  lastActivityTs: number
  membership: string
  /** For invites: who invited us. */
  inviter?: string
}

export type MessageKind =
  | 'text'
  | 'notice'
  | 'emote'
  | 'image'
  | 'video'
  | 'audio'
  | 'file'
  | 'redacted'
  | 'decrypting'
  | 'undecryptable'
  | 'unsupported'

export type MessageStatus = 'sent' | 'sending' | 'failed'

export interface MessageReaction {
  key: string
  count: number
  senderIds: string[]
  /** Our own reaction event, needed to take the reaction back. */
  ownEventId?: string
}

export interface MessageReply {
  eventId: string
  senderName: string
  body: string
}

export interface MatrixMessage {
  id: string
  roomId: string
  senderId: string
  senderName: string
  senderAvatarMxc?: string
  kind: MessageKind
  body: string
  timestamp: number
  edited: boolean
  status: MessageStatus
  media?: {
    mxc?: string
    /** Set for end-to-end encrypted attachments. */
    file?: EncryptedFile
    mimetype?: string
    width?: number
    height?: number
    size?: number
  }
  reactions: MessageReaction[]
  replyTo?: MessageReply
  /** The underlying event, needed to retry or cancel failed local echoes. */
  event: MatrixEvent
}

export interface MatrixSpace {
  id: string
  name: string
  avatarMxc?: string
  unread: number
  mentions: number
  childRoomIds: string[]
}

export const DIRECT_MESSAGES_ID = '__dm__'

export function isSpaceRoom(room: Room): boolean {
  return room.isSpaceRoom()
}

export function getSpaceChildRoomIds(spaceRoom: Room): string[] {
  return spaceRoom.currentState
    .getStateEvents('m.space.child')
    // An m.space.child event with empty content means the child was removed.
    .filter((event) => Array.isArray(event.getContent().via))
    .map((event) => event.getStateKey())
    .filter((id): id is string => Boolean(id))
}

export function roomToMatrixSpace(spaceRoom: Room, childRooms: Room[]): MatrixSpace {
  const unread = childRooms.reduce((sum, room) => sum + room.getUnreadNotificationCount(NotificationCountType.Total), 0)
  const mentions = childRooms.reduce(
    (sum, room) => sum + room.getUnreadNotificationCount(NotificationCountType.Highlight),
    0,
  )

  return {
    id: spaceRoom.roomId,
    name: spaceRoom.name || spaceRoom.getCanonicalAlias() || t('server.unnamed'),
    avatarMxc: spaceRoom.getMxcAvatarUrl() || undefined,
    unread,
    mentions,
    childRoomIds: childRooms.map((room) => room.roomId),
  }
}

/**
 * Convert matrix-js-sdk Room to MatrixRoom
 */
export function roomToMatrixRoom(room: Room): MatrixRoom {
  const membership = room.getMyMembership()
  const avatarMxc =
    room.getMxcAvatarUrl() || room.getAvatarFallbackMember()?.getMxcAvatarUrl() || undefined

  return {
    id: room.roomId,
    name: room.name || room.getCanonicalAlias() || t('room.unnamed'),
    avatarMxc,
    iconMxc: room.getMxcAvatarUrl() || undefined,
    unread: room.getUnreadNotificationCount(NotificationCountType.Total),
    highlights: room.getUnreadNotificationCount(NotificationCountType.Highlight),
    memberCount: room.getJoinedMemberCount(),
    lastActivityTs: room.getLastActiveTimestamp(),
    membership,
    inviter: membership === 'invite' ? room.getDMInviter() || undefined : undefined,
  }
}

function toStatus(event: MatrixEvent): MessageStatus {
  const status = event.status
  if (status === null || status === EventStatus.SENT) return 'sent'
  if (status === EventStatus.NOT_SENT || status === EventStatus.CANCELLED) return 'failed'
  return 'sending'
}

const REPLY_FALLBACK_PATTERN = /^(>.*(\n|$))+\n?/

/** Older clients prepend a quote of the replied-to message ("> <@alice:x> hi"); hide it. */
export function stripReplyFallback(body: string): string {
  return body.replace(REPLY_FALLBACK_PATTERN, '')
}

/** One-line text for a message: its body, or "Image", "File", … for attachments. */
export function summarizeEvent(event: MatrixEvent): string {
  if (event.isRedacted()) return t('message.redacted')
  if (event.isDecryptionFailure()) return t('message.encrypted')
  const content = event.getContent()
  switch (content.msgtype) {
    case 'm.image':
      return t('message.image')
    case 'm.video':
      return t('message.video')
    case 'm.audio':
      return t('message.audio')
    case 'm.file':
      return t('message.file')
    default:
      return typeof content.body === 'string' ? stripReplyFallback(content.body) : ''
  }
}

function collectReactions(room: Room, eventId: string, ownUserId: string | null): MessageReaction[] {
  const annotations = room.relations
    .getChildEventsForEvent(eventId, 'm.annotation', 'm.reaction')
    ?.getSortedAnnotationsByKey()
  if (!annotations) return []

  return annotations
    .map(([key, events]) => {
      const live = Array.from(events).filter((event) => !event.isRedacted())
      const own = live.find((event) => event.getSender() === ownUserId)
      return {
        key,
        count: live.length,
        senderIds: live.map((event) => event.getSender() ?? ''),
        ownEventId: own?.getId(),
      }
    })
    .filter((reaction) => reaction.count > 0)
}

export interface MessageContext {
  room?: Room
  ownUserId?: string | null
}

/**
 * Convert matrix-js-sdk MatrixEvent to MatrixMessage.
 * Returns null for events that should not show up in the chat (state, reactions, edits, ...).
 */
export function eventToMatrixMessage(
  event: MatrixEvent,
  roomId: string,
  context: MessageContext = {},
): MatrixMessage | null {
  // Edits are folded into the original event by the SDK; don't show them twice.
  if (event.isRelation('m.replace')) return null

  const type = event.getType()
  const isEncryptedPlaceholder = type === 'm.room.encrypted'
  if (type !== 'm.room.message' && !isEncryptedPlaceholder) return null

  const senderId = event.getSender() || ''
  const eventId = event.getId()
  const replyEventId = event.replyEventId
  const repliedEvent = replyEventId ? context.room?.findEventById(replyEventId) : undefined

  const base = {
    id: eventId || event.getTxnId() || `${roomId}-${event.getTs()}-${senderId}`,
    roomId,
    senderId,
    senderName: event.sender?.name || senderId || t('message.unknownSender'),
    senderAvatarMxc: event.sender?.getMxcAvatarUrl() || undefined,
    timestamp: event.getTs(),
    edited: Boolean(event.replacingEventId()),
    status: toStatus(event),
    reactions: context.room && eventId ? collectReactions(context.room, eventId, context.ownUserId ?? null) : [],
    replyTo: replyEventId
      ? {
          eventId: replyEventId,
          senderName: repliedEvent ? repliedEvent.sender?.name || repliedEvent.getSender() || '' : '',
          body: repliedEvent ? summarizeEvent(repliedEvent) : t('message.replyNotLoaded'),
        }
      : undefined,
    event,
  }

  if (event.isRedacted()) {
    return { ...base, kind: 'redacted', body: t('message.redacted'), edited: false, reactions: [], replyTo: undefined }
  }

  if (event.isDecryptionFailure()) {
    return { ...base, kind: 'undecryptable', body: t('message.undecryptable') }
  }

  if (isEncryptedPlaceholder) {
    return { ...base, kind: 'decrypting', body: t('message.decrypting') }
  }

  const content = event.getContent()
  const rawBody = typeof content.body === 'string' ? content.body : ''
  const body = replyEventId ? stripReplyFallback(rawBody) : rawBody

  switch (content.msgtype) {
    case 'm.text':
      return { ...base, kind: 'text', body }
    case 'm.notice':
      return { ...base, kind: 'notice', body }
    case 'm.emote':
      return { ...base, kind: 'emote', body }
    case 'm.image':
    case 'm.video':
    case 'm.audio':
    case 'm.file': {
      const info = (content.info ?? {}) as { mimetype?: string; w?: number; h?: number; size?: number }
      const file = isEncryptedFile(content.file) ? content.file : undefined
      return {
        ...base,
        kind: content.msgtype.slice(2) as 'image' | 'video' | 'audio' | 'file',
        body: (typeof content.filename === 'string' && content.filename) || body || t('message.file'),
        media: {
          mxc: typeof content.url === 'string' ? content.url : undefined,
          file,
          mimetype: info.mimetype,
          width: info.w,
          height: info.h,
          size: info.size,
        },
      }
    }
    default:
      return body ? { ...base, kind: 'unsupported', body } : null
  }
}
