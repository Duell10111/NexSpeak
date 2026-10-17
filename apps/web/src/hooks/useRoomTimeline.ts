/**
 * useRoomTimeline Hook
 * Derives the visible messages of a room (or of one thread) straight from the SDK's live
 * timeline plus pending local echoes. Re-deriving (instead of patching a local copy) keeps
 * edits, redactions, decryption and timeline resets after a gappy sync correct.
 *
 * Usage:
 *   const { messages, isLoading, hasMore, loadMore } = useRoomTimeline(client, roomId)
 *   const thread = useRoomTimeline(client, roomId, threadRootId)
 */

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ClientEvent,
  Direction,
  MatrixEventEvent,
  RoomEvent,
  ThreadEvent,
  type EventTimeline,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk'
import { eventToMatrixMessage, isThreadReply } from '@nexspeak/core/matrix/types'
import { subscribeIgnoredUsers } from '@nexspeak/core/matrix/safety'
import { ensureThread } from '@nexspeak/core/matrix/threads'
import type { MatrixMessage } from '@nexspeak/core/matrix/types'

const BACKFILL_LIMIT = 30

interface UseRoomTimelineReturn {
  messages: MatrixMessage[]
  isLoading: boolean
  hasMore: boolean
  loadMore: () => Promise<void>
}

interface TimelineState {
  roomId: string
  threadId?: string
  messages: MatrixMessage[]
  hasMore: boolean
}

/** The timeline to show and paginate: the room's, or the thread's (null until it exists). */
function liveTimelineOf(room: Room, threadId?: string): EventTimeline | null {
  if (!threadId) return room.getLiveTimeline()
  return room.getThread(threadId)?.liveTimeline ?? null
}

function timelineEvents(room: Room, threadId?: string): MatrixEvent[] {
  // Local echoes of all threads share one list (detached pending events).
  const pending = room.getPendingEvents().filter((event) => (threadId ? event.threadRootId === threadId : !isThreadReply(event)))
  if (!threadId) return [...room.getLiveTimeline().getEvents().filter((event) => !isThreadReply(event)), ...pending]

  // The root comes first, also while the thread has no replies yet (or isn't loaded).
  const thread = room.getThread(threadId)
  const root = thread?.rootEvent ?? room.findEventById(threadId)
  const replies = (thread?.liveTimeline.getEvents() ?? []).filter((event) => event.getId() !== threadId)
  return [...(root ? [root] : []), ...replies, ...pending]
}

function buildMessages(room: Room, threadId?: string): MatrixMessage[] {
  const events = timelineEvents(room, threadId)
  const context = { room, ownUserId: room.client.getUserId() }
  const messages: MatrixMessage[] = []
  events.forEach((event) => {
    // The server stops sending their new events; this hides what was already loaded.
    const sender = event.getSender()
    if (sender && room.client.isUserIgnored(sender)) return
    const message = eventToMatrixMessage(event, room.roomId, context)
    if (message) messages.push(message)
  })
  return messages
}

function canPaginateBackwards(room: Room, threadId?: string): boolean {
  const timeline = liveTimelineOf(room, threadId)
  return Boolean(timeline && timeline.getPaginationToken(Direction.Backward) !== null)
}

export function useRoomTimeline(client: MatrixClient | null, roomId: string, threadId?: string): UseRoomTimelineReturn {
  const [state, setState] = useState<TimelineState | null>(null)
  const [loadingRoomId, setLoadingRoomId] = useState<string | null>(null)
  const loadingRef = useRef(false)
  // Room objects can appear after the room was selected (e.g. right after joining).
  const [roomAvailableTick, setRoomAvailableTick] = useState(0)

  useEffect(() => {
    if (!client || !roomId) return

    const room = client.getRoom(roomId)
    if (!room) {
      const onRoom = (newRoom: Room) => {
        if (newRoom.roomId === roomId) setRoomAvailableTick((tick) => tick + 1)
      }
      client.on(ClientEvent.Room, onRoom)
      return () => {
        client.removeListener(ClientEvent.Room, onRoom)
      }
    }

    if (threadId) ensureThread(room, threadId)

    let frame: number | null = null
    const recomputeNow = () => {
      frame = null
      setState({ roomId, threadId, messages: buildMessages(room, threadId), hasMore: canPaginateBackwards(room, threadId) })
    }
    const scheduleRecompute = () => {
      if (frame === null) frame = requestAnimationFrame(recomputeNow)
    }
    const onRoomEvent = (_event: unknown, eventRoom: Room | undefined) => {
      if (eventRoom?.roomId === roomId) scheduleRecompute()
    }
    const onEventChanged = (event: MatrixEvent) => {
      if (event.getRoomId() === roomId) scheduleRecompute()
    }
    const onTimelineReset = (resetRoom: Room | undefined) => {
      if (resetRoom?.roomId === roomId) scheduleRecompute()
    }

    scheduleRecompute()

    const unsubscribeIgnored = subscribeIgnoredUsers(client, scheduleRecompute)
    // Thread summaries (reply count, latest reply) and new threads; only emitted by the room.
    room.on(ThreadEvent.New, scheduleRecompute)
    room.on(ThreadEvent.Update, scheduleRecompute)
    client.on(RoomEvent.Timeline, onRoomEvent)
    client.on(RoomEvent.Redaction, onRoomEvent)
    client.on(RoomEvent.LocalEchoUpdated, onRoomEvent)
    client.on(RoomEvent.TimelineReset, onTimelineReset)
    client.on(MatrixEventEvent.Decrypted, onEventChanged)
    client.on(MatrixEventEvent.Replaced, onEventChanged)

    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      unsubscribeIgnored()
      room.removeListener(ThreadEvent.New, scheduleRecompute)
      room.removeListener(ThreadEvent.Update, scheduleRecompute)
      client.removeListener(RoomEvent.Timeline, onRoomEvent)
      client.removeListener(RoomEvent.Redaction, onRoomEvent)
      client.removeListener(RoomEvent.LocalEchoUpdated, onRoomEvent)
      client.removeListener(RoomEvent.TimelineReset, onTimelineReset)
      client.removeListener(MatrixEventEvent.Decrypted, onEventChanged)
      client.removeListener(MatrixEventEvent.Replaced, onEventChanged)
    }
  }, [client, roomId, threadId, roomAvailableTick])

  const loadMore = useCallback(async () => {
    if (!client || !roomId || loadingRef.current) return
    const room = client.getRoom(roomId)
    const timeline = room ? liveTimelineOf(room, threadId) : null
    if (!room || !timeline || !canPaginateBackwards(room, threadId)) return

    loadingRef.current = true
    setLoadingRoomId(roomId)
    try {
      // New events arrive through RoomEvent.Timeline, which triggers a recompute.
      const hasMore = await client.paginateEventTimeline(timeline, {
        backwards: true,
        limit: BACKFILL_LIMIT,
      })
      setState((prev) => (prev && prev.roomId === roomId && prev.threadId === threadId ? { ...prev, hasMore } : prev))
    } catch (error) {
      console.error('Failed to load more messages:', error)
    } finally {
      loadingRef.current = false
      setLoadingRoomId(null)
    }
  }, [client, roomId, threadId])

  const current = state && state.roomId === roomId && state.threadId === threadId ? state : null

  return {
    messages: current?.messages ?? [],
    isLoading: loadingRoomId === roomId || (Boolean(roomId) && !current),
    hasMore: current?.hasMore ?? false,
    loadMore,
  }
}
