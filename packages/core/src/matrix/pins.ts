/**
 * Pinned messages: the `m.room.pinned_events` state event, a list of event ids (newest last),
 * shared with Element.
 */

import { EventType, MatrixEvent, type MatrixClient, type Room } from 'matrix-js-sdk'

/** Like Element: enough for a channel's important messages without an endless list. */
export const MAX_PINNED_EVENTS = 100

export function getPinnedEventIds(room: Room | null | undefined): string[] {
  const pinned = room?.currentState.getStateEvents(EventType.RoomPinnedEvents, '')?.getContent().pinned
  return Array.isArray(pinned) ? pinned.filter((id): id is string => typeof id === 'string') : []
}

export function canPinMessages(room: Room | null | undefined, userId: string | null): boolean {
  if (!room || !userId) return false
  return room.currentState.maySendStateEvent(EventType.RoomPinnedEvents, userId)
}

export async function setPinned(client: MatrixClient, roomId: string, eventId: string, pinned: boolean): Promise<void> {
  const current = getPinnedEventIds(client.getRoom(roomId))
  if (pinned === current.includes(eventId)) return
  const next = pinned ? [...current, eventId].slice(-MAX_PINNED_EVENTS) : current.filter((id) => id !== eventId)
  await client.sendStateEvent(roomId, EventType.RoomPinnedEvents, { pinned: next }, '')
}

/**
 * The pinned event, from the loaded timeline or fetched from the server (and decrypted).
 * Null when it no longer exists or we may not see it.
 */
export async function loadPinnedEvent(client: MatrixClient, room: Room, eventId: string): Promise<MatrixEvent | null> {
  const loaded = room.findEventById(eventId)
  if (loaded) return loaded
  try {
    const raw = await client.fetchRoomEvent(room.roomId, eventId)
    const event = new MatrixEvent(raw)
    if (event.isEncrypted()) await client.decryptEventIfNeeded(event)
    // Without this the sender's name and avatar are unknown.
    event.sender = room.getMember(event.getSender() ?? '')
    return event
  } catch (error) {
    console.info('Could not load pinned event:', eventId, error)
    return null
  }
}
