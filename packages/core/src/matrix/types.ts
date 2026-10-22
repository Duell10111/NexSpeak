/**
 * Matrix Integration Type Definitions
 * Plain view models derived from matrix-js-sdk objects. Never mutate SDK state in here.
 */

import { EventStatus, NotificationCountType, THREAD_RELATION_TYPE, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk'
import { isEncryptedFile, type EncryptedFile } from './attachments'
import { parseFormattedBody, type FormattedNode } from './formatted-body'
import { t } from '@nexspeak/i18n'
import { isEmojiMxc, stickerInfo } from './custom-emojis'
import { isPollStart, pollFromRoom, type MatrixPoll } from './polls'
import { isIgnoredEvent } from './safety'

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
  /** For 1:1 direct messages: the other person. */
  directUserId?: string
}

export type MessageKind =
  | 'text'
  | 'poll'
  | 'notice'
  | 'emote'
  | 'image'
  | 'sticker'
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

export interface ThreadSummary {
  /** Replies, not counting the root. */
  count: number
  latestSenderName: string
  latestBody: string
  latestTimestamp: number
  /** We wrote in it (Discord highlights threads you follow). */
  participated: boolean
}

export interface MatrixMessage {
  id: string
  roomId: string
  senderId: string
  senderName: string
  senderAvatarMxc?: string
  kind: MessageKind
  body: string
  /** Sanitized `formatted_body` of text messages (Markdown, mentions), when there is one. */
  formatted?: FormattedNode[]
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
    /** A separate preview supplied by the sender, never the video itself. */
    thumbnail?: { mxc?: string; file?: EncryptedFile; mimetype?: string }
    /** Plays like a GIF: looping and silent, only while visible (videos flagged as GIF, image/gif). */
    gif?: boolean
  }
  poll?: MatrixPoll
  reactions: MessageReaction[]
  replyTo?: MessageReply
  /** Set on thread roots that have replies. */
  thread?: ThreadSummary
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
/** The friends view on Home, selected like a room. */
export const FRIENDS_VIEW_ID = '__friends__'

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

/** Videos flagged as GIF (our own and the mautrix bridges' fi.mau.* flags) and image/gif files. */
export function isGifContent(content: Record<string, unknown>): boolean {
  const info = (content.info && typeof content.info === 'object' ? content.info : {}) as Record<string, unknown>
  if (content.msgtype === 'm.image') return info.mimetype === 'image/gif'
  return content.msgtype === 'm.video' && (info['fi.mau.gif'] === true || (info['fi.mau.loop'] === true && info['fi.mau.autoplay'] === true))
}

/** One-line text for a message: its body, or "Image", "File", … for attachments. */
export function summarizeEvent(event: MatrixEvent): string {
  if (event.isRedacted()) return t('message.redacted')
  if (event.isDecryptionFailure()) return t('message.encrypted')
  const content = event.getContent()
  if (isPollStart(event)) return pollFromRoom(event)?.question ?? ''
  if (isGifContent(content)) return t('message.gif')
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

const HTML_FORMAT = 'org.matrix.custom.html'
// Timelines are re-derived often; parse each formatted body once.
const formattedCache = new WeakMap<MatrixEvent, { html: string; nodes: FormattedNode[] }>()

function formattedNodes(event: MatrixEvent, content: Record<string, unknown>): FormattedNode[] | undefined {
  if (content.format !== HTML_FORMAT || typeof content.formatted_body !== 'string') return undefined
  const html = content.formatted_body
  const cached = formattedCache.get(event)
  if (cached?.html === html) return cached.nodes
  const nodes = parseFormattedBody(html)
  formattedCache.set(event, { html, nodes })
  return nodes
}

export function threadSummary(event: MatrixEvent, client?: MatrixClient): ThreadSummary | undefined {
  if (!event.isThreadRoot) return undefined
  const thread = event.getThread()
  if (!thread || thread.length === 0) return undefined
  const latest = isIgnoredEvent(client, thread.replyToEvent) ? undefined : thread.replyToEvent
  return {
    count: thread.length,
    latestSenderName: latest ? latest.sender?.name || latest.getSender() || '' : '',
    latestBody: latest ? summarizeEvent(latest) : '',
    latestTimestamp: latest?.getTs() ?? event.getTs(),
    participated: thread.hasCurrentUserParticipated,
  }
}

/** Replies in a thread live in the thread's own timeline, not in the channel. */
export function isThreadReply(event: MatrixEvent): boolean {
  return Boolean(event.threadRootId) && !event.isThreadRoot
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
  if (type !== 'm.room.message' && type !== 'm.sticker' && !isPollStart(event) && !isEncryptedPlaceholder) return null

  const senderId = event.getSender() || ''
  const eventId = event.getId()
  // In threads, "is_falling_back" replies only exist for clients without thread support.
  const relation = event.getWireContent()['m.relates_to'] as { is_falling_back?: unknown } | undefined
  const replyEventId = event.isRelation(THREAD_RELATION_TYPE.name) && relation?.is_falling_back === true ? undefined : event.replyEventId
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
    replyTo: replyEventId && !isIgnoredEvent(context.room?.client, repliedEvent)
      ? {
          eventId: replyEventId,
          senderName: repliedEvent ? repliedEvent.sender?.name || repliedEvent.getSender() || '' : '',
          body: repliedEvent ? summarizeEvent(repliedEvent) : t('message.replyNotLoaded'),
        }
      : undefined,
    thread: threadSummary(event, context.room?.client),
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

  if (isPollStart(event)) {
    const poll = pollFromRoom(event, context.room, context.ownUserId)
    return poll ? { ...base, kind: 'poll', body: poll.question, poll } : { ...base, kind: 'unsupported', body: t('poll.invalid') }
  }

  const content = event.getContent()
  const rawBody = typeof content.body === 'string' ? content.body : ''
  const body = replyEventId ? stripReplyFallback(rawBody) : rawBody

  if (type === 'm.sticker') {
    const info = stickerInfo(content.info)
    return { ...base, kind: 'sticker', body: rawBody || t('sticker.label'), media: {
      mxc: typeof content.url === 'string' && isEmojiMxc(content.url) ? content.url : undefined,
      mimetype: info.mimetype, width: info.w, height: info.h, size: info.size,
    } }
  }

  switch (content.msgtype) {
    case 'm.text':
      return { ...base, kind: 'text', body, formatted: formattedNodes(event, content) }
    case 'm.notice':
      return { ...base, kind: 'notice', body, formatted: formattedNodes(event, content) }
    case 'm.emote':
      return { ...base, kind: 'emote', body, formatted: formattedNodes(event, content) }
    case 'm.image':
    case 'm.video':
    case 'm.audio':
    case 'm.file': {
      const info = (content.info ?? {}) as { mimetype?: string; w?: number; h?: number; size?: number;
        thumbnail_url?: unknown; thumbnail_file?: unknown; thumbnail_info?: { mimetype?: string } }
      const file = isEncryptedFile(content.file) ? content.file : undefined
      // A malformed preview must never cause the full attachment to load before Play.
      const originals = [content.url, file?.url]
      const thumbnailFile = isEncryptedFile(info.thumbnail_file) && !originals.includes(info.thumbnail_file.url) ? info.thumbnail_file : undefined
      const thumbnailMxc = typeof info.thumbnail_url === 'string' && isEmojiMxc(info.thumbnail_url) && !originals.includes(info.thumbnail_url) ? info.thumbnail_url : undefined
      const gif = isGifContent(content)
      return {
        ...base,
        kind: content.msgtype.slice(2) as 'image' | 'video' | 'audio' | 'file',
        // A GIF's body is its title; its file name is made up.
        body: (gif && body) || (typeof content.filename === 'string' && content.filename) || body || t('message.file'),
        media: {
          mxc: typeof content.url === 'string' ? content.url : undefined,
          file,
          mimetype: info.mimetype,
          width: info.w,
          height: info.h,
          size: info.size,
          thumbnail: thumbnailFile || thumbnailMxc ? {
            mxc: thumbnailMxc, file: thumbnailFile, mimetype: info.thumbnail_info?.mimetype,
          } : undefined,
          ...(gif && { gif }),
        },
      }
    }
    default:
      return body ? { ...base, kind: 'unsupported', body } : null
  }
}
