/**
 * useRoomTimeline Hook
 * Subscribes to room timeline events and manages message state
 * Handles deduplication, pagination, and live updates
 *
 * Usage:
 *   const { messages, isLoading, hasMore, loadMore } = useRoomTimeline(client, roomId)
 */

'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk'
import { eventToMatrixMessage } from '@/lib/matrix/types'
import type { MatrixMessage } from '@/lib/matrix/types'

const BACKFILL_LIMIT = 30

interface UseRoomTimelineReturn {
  messages: MatrixMessage[]
  isLoading: boolean
  hasMore: boolean
  loadMore: () => Promise<void>
}

export function useRoomTimeline(
  client: MatrixClient | null,
  roomId: string,
): UseRoomTimelineReturn {
  const [messages, setMessages] = useState<MatrixMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const messageMapRef = useRef<Map<string, MatrixMessage>>(new Map())
  const unsubscribeRef = useRef<(() => void) | null>(null)

  // Load initial messages from room timeline
  useEffect(() => {
    if (!client || !roomId) return

    const emitter = client as unknown as {
      on: (event: string, listener: (...args: unknown[]) => void) => void
      removeListener: (event: string, listener: (...args: unknown[]) => void) => void
    }

    const room = client.getRoom(roomId)
    if (!room) return

    // Clear previous messages and subscription
    messageMapRef.current.clear()
    if (unsubscribeRef.current) {
      unsubscribeRef.current()
    }

    // Load initial timeline
    const timeline = room.getLiveTimeline()
    const events = timeline.getEvents()

    // Add all events to map (newest first in state, so we reverse)
    events.forEach((event) => {
      const msg = eventToMatrixMessage(event, roomId)
      if (msg) {
        messageMapRef.current.set(msg.id, msg)
      }
    })

    // Update state with sorted messages
    const sortedMessages = Array.from(messageMapRef.current.values()).sort(
      (a, b) => a.timestamp - b.timestamp,
    )
    setMessages(sortedMessages)

    // Subscribe to new messages
    const syncMessagesFromMap = () => {
      setMessages(
        Array.from(messageMapRef.current.values()).sort(
          (a, b) => a.timestamp - b.timestamp,
        ),
      )
    }

    const handleTimelineEvent = (event: MatrixEvent) => {
      const msg = eventToMatrixMessage(event, roomId)
      if (!msg) return

      // Upsert by event ID to support decrypted/edited updates.
      messageMapRef.current.set(msg.id, msg)
      syncMessagesFromMap()
    }

    // Listen to room timeline
    const wrappedHandler = (event: unknown, eventRoom: unknown) => {
      if (!eventRoom || typeof eventRoom !== 'object' || !('roomId' in eventRoom)) return
      if (!event || typeof event !== 'object' || !('getType' in event)) return

      const matrixRoom = eventRoom as Room
      const matrixEvent = event as MatrixEvent

      // Only process events for this room
      if (matrixRoom.roomId === roomId) {
        handleTimelineEvent(matrixEvent)
      }
    }

    const decryptedHandler = (event: unknown) => {
      if (!event || typeof event !== 'object' || !('getRoomId' in event)) return

      const matrixEvent = event as MatrixEvent
      if (matrixEvent.getRoomId() !== roomId) return

      handleTimelineEvent(matrixEvent)
    }

    emitter.on('Room.timeline', wrappedHandler)
    emitter.on('Event.decrypted', decryptedHandler)

    unsubscribeRef.current = () => {
      emitter.removeListener('Room.timeline', wrappedHandler)
      emitter.removeListener('Event.decrypted', decryptedHandler)
    }

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
      }
    }
  }, [client, roomId])

  // Load more messages (backfill)
  const loadMore = useCallback(async () => {
    if (!client || !roomId || isLoading || !hasMore) return

    setIsLoading(true)
    try {
      const room = client.getRoom(roomId)
      if (!room) return

      const timeline = room.getLiveTimeline()
      const events = timeline.getEvents()

      if (events.length === 0) {
        setHasMore(false)
        return
      }

      const previousEventIds = new Set(
        events
          .map((event) => event.getId())
          .filter((id): id is string => Boolean(id)),
      )

      // Paginate backwards
      const didPaginate = await client.paginateEventTimeline(timeline, {
        backwards: true,
        limit: BACKFILL_LIMIT,
      })

      if (!didPaginate) {
        setHasMore(false)
        return
      }

      const updatedEvents = timeline.getEvents()
      const newlyLoadedEvents = updatedEvents.filter((event) => {
        const eventId = event.getId()
        return !!eventId && !previousEventIds.has(eventId)
      })

      // Add new messages to map
      const newMessages: MatrixMessage[] = []
      newlyLoadedEvents.forEach((event) => {
        const msg = eventToMatrixMessage(event, roomId)
        if (msg) {
          const exists = messageMapRef.current.has(msg.id)
          messageMapRef.current.set(msg.id, msg)
          if (!exists) {
            newMessages.push(msg)
          }
        }
      })

      // Update state
      if (newMessages.length > 0) {
        setMessages((prev) => {
          const all = [...prev, ...newMessages]
          return all.sort((a, b) => a.timestamp - b.timestamp)
        })
      }

      if (newlyLoadedEvents.length < BACKFILL_LIMIT) {
        setHasMore(false)
      }
    } catch (error) {
      console.error('Failed to load more messages:', error)
    } finally {
      setIsLoading(false)
    }
  }, [client, roomId, isLoading, hasMore])

  return {
    messages,
    isLoading,
    hasMore,
    loadMore,
  }
}

