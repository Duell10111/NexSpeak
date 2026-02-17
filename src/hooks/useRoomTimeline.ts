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
import type { MatrixClient, Room } from 'matrix-js-sdk'
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
    const handleTimelineEvent = (event: any) => {
      const msg = eventToMatrixMessage(event, roomId)
      if (!msg) return

      // Avoid duplicates: only add if not already in map
      if (!messageMapRef.current.has(msg.id)) {
        messageMapRef.current.set(msg.id, msg)

        // Update state with new message
        setMessages((prev) => {
          const newMessages = [...prev]
          newMessages.push(msg)
          return newMessages.sort((a, b) => a.timestamp - b.timestamp)
        })
      }
    }

    // Listen to room timeline
    const wrappedHandler = (event: any, room: any) => {
      // Only process events for this room
      if (room && room.roomId === roomId) {
        handleTimelineEvent(event)
      }
    }

    client.on('Room.timeline' as any, wrappedHandler)

    unsubscribeRef.current = () => {
      client.removeListener('Room.timeline' as any, wrappedHandler)
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

      // Get oldest event
      const oldestEvent = events[0]

      // Paginate backwards
      const result = await client.paginateEventTimeline(timeline, {
        backwards: true,
        limit: BACKFILL_LIMIT,
      })

      if (!result || result.length === 0) {
        setHasMore(false)
        return
      }

      // Add new messages to map
      const newMessages: MatrixMessage[] = []
      result.forEach((event) => {
        const msg = eventToMatrixMessage(event, roomId)
        if (msg && !messageMapRef.current.has(msg.id)) {
          messageMapRef.current.set(msg.id, msg)
          newMessages.push(msg)
        }
      })

      // Update state
      if (newMessages.length > 0) {
        setMessages((prev) => {
          const all = [...prev, ...newMessages]
          return all.sort((a, b) => a.timestamp - b.timestamp)
        })
      }

      if (result.length < BACKFILL_LIMIT) {
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

