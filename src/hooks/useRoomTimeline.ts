/**
 * useRoomTimeline Hook
 * Derives the visible messages of a room straight from the SDK's live timeline plus
 * pending local echoes. Re-deriving (instead of patching a local copy) keeps edits,
 * redactions, decryption and timeline resets after a gappy sync correct.
 *
 * Usage:
 *   const { messages, isLoading, hasMore, loadMore } = useRoomTimeline(client, roomId)
 */

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ClientEvent,
  Direction,
  MatrixEventEvent,
  RoomEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk'
import { eventToMatrixMessage } from '@/lib/matrix/types'
import type { MatrixMessage } from '@/lib/matrix/types'

const BACKFILL_LIMIT = 30

interface UseRoomTimelineReturn {
  messages: MatrixMessage[]
  isLoading: boolean
  hasMore: boolean
  loadMore: () => Promise<void>
}

interface TimelineState {
  roomId: string
  messages: MatrixMessage[]
  hasMore: boolean
}

function buildMessages(room: Room): MatrixMessage[] {
  const events = [...room.getLiveTimeline().getEvents(), ...room.getPendingEvents()]
  const context = { room, ownUserId: room.client.getUserId() }
  const messages: MatrixMessage[] = []
  events.forEach((event) => {
    const message = eventToMatrixMessage(event, room.roomId, context)
    if (message) messages.push(message)
  })
  return messages
}

function canPaginateBackwards(room: Room): boolean {
  return room.getLiveTimeline().getPaginationToken(Direction.Backward) !== null
}

export function useRoomTimeline(client: MatrixClient | null, roomId: string): UseRoomTimelineReturn {
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

    let frame: number | null = null
    const recomputeNow = () => {
      frame = null
      setState({ roomId, messages: buildMessages(room), hasMore: canPaginateBackwards(room) })
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

    client.on(RoomEvent.Timeline, onRoomEvent)
    client.on(RoomEvent.Redaction, onRoomEvent)
    client.on(RoomEvent.LocalEchoUpdated, onRoomEvent)
    client.on(RoomEvent.TimelineReset, onTimelineReset)
    client.on(MatrixEventEvent.Decrypted, onEventChanged)
    client.on(MatrixEventEvent.Replaced, onEventChanged)

    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      client.removeListener(RoomEvent.Timeline, onRoomEvent)
      client.removeListener(RoomEvent.Redaction, onRoomEvent)
      client.removeListener(RoomEvent.LocalEchoUpdated, onRoomEvent)
      client.removeListener(RoomEvent.TimelineReset, onTimelineReset)
      client.removeListener(MatrixEventEvent.Decrypted, onEventChanged)
      client.removeListener(MatrixEventEvent.Replaced, onEventChanged)
    }
  }, [client, roomId, roomAvailableTick])

  const loadMore = useCallback(async () => {
    if (!client || !roomId || loadingRef.current) return
    const room = client.getRoom(roomId)
    if (!room || !canPaginateBackwards(room)) return

    loadingRef.current = true
    setLoadingRoomId(roomId)
    try {
      // New events arrive through RoomEvent.Timeline, which triggers a recompute.
      const hasMore = await client.paginateEventTimeline(room.getLiveTimeline(), {
        backwards: true,
        limit: BACKFILL_LIMIT,
      })
      setState((prev) => (prev && prev.roomId === roomId ? { ...prev, hasMore } : prev))
    } catch (error) {
      console.error('Failed to load more messages:', error)
    } finally {
      loadingRef.current = false
      setLoadingRoomId(null)
    }
  }, [client, roomId])

  const current = state && state.roomId === roomId ? state : null

  return {
    messages: current?.messages ?? [],
    isLoading: loadingRoomId === roomId || (Boolean(roomId) && !current),
    hasMore: current?.hasMore ?? false,
    loadMore,
  }
}
