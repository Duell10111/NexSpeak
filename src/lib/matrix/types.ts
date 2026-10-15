/**
 * Matrix Integration Type Definitions
 * Plain view models derived from matrix-js-sdk objects. Never mutate SDK state in here.
 */

import { EventStatus, NotificationCountType, type MatrixEvent, type Room } from 'matrix-js-sdk'

export interface MatrixRoom {
  id: string
  name: string
  avatarMxc?: string
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
    /** Encrypted attachments need client-side decryption, which is not supported yet. */
    encrypted: boolean
    mimetype?: string
    width?: number
    height?: number
    size?: number
  }
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
    name: spaceRoom.name || spaceRoom.getCanonicalAlias() || 'Unbenannter Server',
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
    name: room.name || room.getCanonicalAlias() || 'Unbenannter Raum',
    avatarMxc,
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

/**
 * Convert matrix-js-sdk MatrixEvent to MatrixMessage.
 * Returns null for events that should not show up in the chat (state, reactions, edits, ...).
 */
export function eventToMatrixMessage(event: MatrixEvent, roomId: string): MatrixMessage | null {
  // Edits are folded into the original event by the SDK; don't show them twice.
  if (event.isRelation('m.replace')) return null

  const type = event.getType()
  const isEncryptedPlaceholder = type === 'm.room.encrypted'
  if (type !== 'm.room.message' && !isEncryptedPlaceholder) return null

  const senderId = event.getSender() || ''
  const base = {
    id: event.getId() || event.getTxnId() || `${roomId}-${event.getTs()}-${senderId}`,
    roomId,
    senderId,
    senderName: event.sender?.name || senderId || 'Unbekannt',
    senderAvatarMxc: event.sender?.getMxcAvatarUrl() || undefined,
    timestamp: event.getTs(),
    edited: Boolean(event.replacingEventId()),
    status: toStatus(event),
    event,
  }

  if (event.isRedacted()) {
    return { ...base, kind: 'redacted', body: 'Nachricht gelöscht', edited: false }
  }

  if (event.isDecryptionFailure()) {
    return { ...base, kind: 'undecryptable', body: 'Nachricht konnte nicht entschlüsselt werden' }
  }

  if (isEncryptedPlaceholder) {
    return { ...base, kind: 'decrypting', body: 'Wird entschlüsselt…' }
  }

  const content = event.getContent()
  const body = typeof content.body === 'string' ? content.body : ''

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
      const encryptedFile = content.file as { url?: string } | undefined
      return {
        ...base,
        kind: content.msgtype.slice(2) as 'image' | 'video' | 'audio' | 'file',
        body: (typeof content.filename === 'string' && content.filename) || body || 'Datei',
        media: {
          mxc: typeof content.url === 'string' ? content.url : encryptedFile?.url,
          encrypted: Boolean(encryptedFile),
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
