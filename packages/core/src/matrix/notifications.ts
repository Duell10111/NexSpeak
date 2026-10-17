/**
 * Which incoming messages notify, based on the user's Matrix push rules – the same settings
 * Element shows (mute a room, mentions only, keywords). No polling: the SDK's timeline events
 * drive everything.
 */

import {
  MatrixEventEvent,
  RoomEvent,
  type IRoomTimelineData,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk'
import { isDirectRoom } from './direct'
import { summarizeEvent } from './types'

/** Older events are catch-up after sleep or a reconnect, not something happening right now. */
const MAX_NOTIFICATION_AGE_MS = 2 * 60_000

export interface MessageNotification {
  roomId: string
  eventId: string
  senderName: string
  roomName: string
  isDirect: boolean
  /** Message text or attachment kind ("Image"). */
  body: string
  /** Mentions and keywords (push rule tweak "highlight"). */
  isHighlight: boolean
}

const NOTIFYING_TYPES = new Set(['m.room.message', 'm.sticker'])

export function notificationFor(client: MatrixClient, event: MatrixEvent, room: Room): MessageNotification | null {
  if (event.getSender() === client.getUserId()) return null
  if (!NOTIFYING_TYPES.has(event.getType())) return null
  // Edits update an existing message; they are not new.
  if (event.isRelation('m.replace') || event.isRedacted()) return null
  if (Date.now() - event.getTs() > MAX_NOTIFICATION_AGE_MS) return null

  const actions = client.getPushActionsForEvent(event, true)
  if (!actions?.notify) return null

  const eventId = event.getId()
  if (!eventId) return null
  return {
    roomId: room.roomId,
    eventId,
    senderName: event.sender?.name || event.getSender() || '',
    roomName: room.name,
    isDirect: isDirectRoom(client, room),
    body: summarizeEvent(event),
    isHighlight: Boolean(actions.tweaks?.highlight),
  }
}

/**
 * Calls `onNotification` for new live messages that should notify. Encrypted messages are
 * evaluated once decrypted, because push rules (mentions, keywords) need the clear text.
 * Returns an unsubscribe function.
 */
export function watchNotifications(
  client: MatrixClient,
  onNotification: (notification: MessageNotification) => void,
): () => void {
  const pending = new Set<MatrixEvent>()

  const evaluate = (event: MatrixEvent) => {
    const room = client.getRoom(event.getRoomId())
    if (!room || room.getMyMembership() !== 'join') return
    const notification = notificationFor(client, event, room)
    if (notification) onNotification(notification)
  }

  const onDecrypted = (event: MatrixEvent) => {
    if (!pending.delete(event)) return
    evaluate(event)
  }

  const onTimeline = (
    event: MatrixEvent,
    _room: Room | undefined,
    toStartOfTimeline: boolean | undefined,
    _removed: boolean,
    data: IRoomTimelineData,
  ) => {
    // Only new messages: not history, not the initial sync.
    if (toStartOfTimeline || !data.liveEvent || !client.isInitialSyncComplete()) return
    if (event.isBeingDecrypted() || event.shouldAttemptDecryption()) {
      pending.add(event)
      event.once(MatrixEventEvent.Decrypted, onDecrypted)
      return
    }
    evaluate(event)
  }

  client.on(RoomEvent.Timeline, onTimeline)
  return () => {
    client.off(RoomEvent.Timeline, onTimeline)
    pending.forEach((event) => event.off(MatrixEventEvent.Decrypted, onDecrypted))
    pending.clear()
  }
}

