/**
 * Matrix Integration Type Definitions
 */

import type { Room, MatrixEvent } from 'matrix-js-sdk'

export interface MatrixRoom {
  id: string
  name: string
  avatar?: string
  unread: number
  memberCount: number
  lastMessage?: {
    content: string
    timestamp: number
    senderId: string
  }
}

export interface MatrixMessage {
  id: string
  roomId: string
  senderId: string
  senderName: string
  senderAvatar?: string
  content: string
  timestamp: number
  edited?: boolean
  reactions?: { emoji: string; count: number; reacted: boolean }[]
}

export interface MatrixSpace {
  id: string
  name: string
  avatar?: string
  unread: number
  mentions: number
  childRoomIds: string[]
}

export type SyncStatus = 'INITIAL' | 'SYNCING' | 'SYNCED' | 'ERROR'

export function isSpaceRoom(room: Room): boolean {
  const createEvent = room.currentState.getStateEvents('m.room.create', '')
  const createContent = createEvent?.getContent()
  return createContent?.type === 'm.space'
}

export function getSpaceChildRoomIds(spaceRoom: Room): string[] {
  const childEvents = spaceRoom.currentState.getStateEvents('m.space.child')
  if (!Array.isArray(childEvents)) {
    return []
  }

  return childEvents
    .map((event) => event.getStateKey())
    .filter((id): id is string => Boolean(id))
}

export function roomToMatrixSpace(spaceRoom: Room, childRooms: Room[]): MatrixSpace {
  const getHighlightCount = (room: Room): number => {
    const countGetter = room.getUnreadNotificationCount as unknown as (this: Room, type?: string) => number
    return countGetter.call(room, 'highlight') || 0
  }

  const unread = childRooms.reduce((sum, room) => sum + (room.getUnreadNotificationCount() || 0), 0)
  const mentions = childRooms.reduce((sum, room) => sum + getHighlightCount(room), 0)

  return {
    id: spaceRoom.roomId,
    name: spaceRoom.name || spaceRoom.getCanonicalAlias() || 'Unnamed space',
    avatar: spaceRoom.getAvatarUrl(spaceRoom.client.getHomeserverUrl(), 32, 32, 'crop') || undefined,
    unread,
    mentions,
    childRoomIds: childRooms.map((room) => room.roomId),
  }
}

/**
 * Convert matrix-js-sdk Room to MatrixRoom
 */
export function roomToMatrixRoom(room: Room): MatrixRoom {
  const unreadCount = room.getUnreadNotificationCount() || 0
  const memberList = room.getMembers()

  // Get last message
  const timeline = room.getLiveTimeline()
  const events = timeline.getEvents()
  const lastMessageEvent = events
    .reverse()
    .find((e) => e.getType() === 'm.room.message')

  let lastMessage = undefined
  if (lastMessageEvent) {
    const content = lastMessageEvent.getContent()
    lastMessage = {
      content: content.body || '(no preview)',
      timestamp: lastMessageEvent.getTs(),
      senderId: lastMessageEvent.getSender() || '',
    }
  }

  return {
    id: room.roomId,
    name: room.name || room.getCanonicalAlias() || '(unnamed)',
    avatar: room.getAvatarUrl(room.client.getHomeserverUrl(), 32, 32, 'crop') || undefined,
    unread: unreadCount,
    memberCount: memberList.length,
    lastMessage,
  }
}

/**
 * Convert matrix-js-sdk MatrixEvent to MatrixMessage
 */
export function eventToMatrixMessage(
  event: MatrixEvent,
  roomId: string,
): MatrixMessage | null {
  const type = event.getType()

  // Only text messages for now
  if (type !== 'm.room.message') return null

  const content = event.getContent()
  if (content.msgtype !== 'm.text') return null

  const senderMember = event.sender
  const senderName = senderMember?.name || event.getSender() || 'Unknown'
  let senderAvatar: string | undefined = undefined

  if (senderMember?.avatarUrl) {
    senderAvatar = senderMember.avatarUrl
  }

  return {
    id: event.getId() || `fallback-${Date.now()}`,
    roomId,
    senderId: event.getSender() || '',
    senderName,
    senderAvatar,
    content: content.body || '',
    timestamp: event.getTs(),
    edited: event.replacingEventId?.() !== undefined,
  }
}


