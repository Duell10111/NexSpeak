/**
 * useRoomList Hook
 * Subscribes to room list and membership changes
 * Handles room filtering and unread counts
 *
 * Usage:
 *   const { rooms, isLoading } = useRoomList(client)
 */

'use client'

import { useEffect, useState, useRef } from 'react'
import type { MatrixClient, Room } from 'matrix-js-sdk'
import {
  getSpaceChildRoomIds,
  isSpaceRoom,
  roomToMatrixRoom,
  roomToMatrixSpace,
} from '@/lib/matrix/types'
import type { MatrixRoom } from '@/lib/matrix/types'
import type { MatrixSpace } from '@/lib/matrix/types'

interface UseRoomListReturn {
  rooms: MatrixRoom[]
  isLoading: boolean
}

interface UseSpaceListReturn {
  spaces: MatrixSpace[]
  roomsBySpace: Record<string, MatrixRoom[]>
  isLoading: boolean
}

interface UseDirectRoomListReturn {
  rooms: MatrixRoom[]
  isLoading: boolean
}

export function useRoomList(client: MatrixClient | null): UseRoomListReturn {
  const [rooms, setRooms] = useState<MatrixRoom[]>([])
  const [isLoading, setIsLoading] = useState(!!client)
  const unsubscribersRef = useRef<Array<() => void>>([])
  const initializedRef = useRef(false)

  useEffect(() => {
    if (!client || initializedRef.current) return

    const emitter = client as unknown as {
      on: (event: string, listener: (...args: unknown[]) => void) => void
      removeListener: (event: string, listener: (...args: unknown[]) => void) => void
    }

    initializedRef.current = true

    try {
      // Get initial rooms
      const initialRooms = client
        .getRooms()
        .map((room) => roomToMatrixRoom(room))
        .sort((a, b) => {
          // Sort by last message timestamp (newest first)
          const aTime = a.lastMessage?.timestamp || 0
          const bTime = b.lastMessage?.timestamp || 0
          return bTime - aTime
        })

      queueMicrotask(() => {
        setRooms(initialRooms)
        setIsLoading(false)
      })

      // Subscribe to room events
      const handleRoomCreated = (room: Room) => {
        setRooms((prev) => {
          // Check if already exists
          if (prev.find((r) => r.id === room.roomId)) return prev

          const newRoom = roomToMatrixRoom(room)
          return [newRoom, ...prev]
        })
      }

      const handleRoomStateEvent = () => {
        // Room state changed (name, topic, etc)
        setRooms((prev) =>
          prev.map((room) => {
            const matrixRoom = client.getRoom(room.id)
            if (matrixRoom) {
              return roomToMatrixRoom(matrixRoom)
            }
            return room
          }),
        )
      }

      const onRoomCreated = (room: unknown) => {
        if (room && typeof room === 'object' && 'roomId' in room) {
          handleRoomCreated(room as Room)
        }
      }

      emitter.on('Room', onRoomCreated)
      emitter.on('RoomState.events', handleRoomStateEvent)
      emitter.on('Room.receipt', handleRoomStateEvent)

      unsubscribersRef.current = [
        () => emitter.removeListener('Room', onRoomCreated),
        () => emitter.removeListener('RoomState.events', handleRoomStateEvent),
        () => emitter.removeListener('Room.receipt', handleRoomStateEvent),
      ]
    } catch (error) {
      console.error('Failed to initialize room list:', error)
      queueMicrotask(() => {
        setIsLoading(false)
      })
    }

    return () => {
      unsubscribersRef.current.forEach((unsub) => unsub())
      unsubscribersRef.current = []
    }
  }, [client])

  return {
    rooms,
    isLoading,
  }
}

export function useSpaceList(client: MatrixClient | null): UseSpaceListReturn {
  const [spaces, setSpaces] = useState<MatrixSpace[]>([])
  const [roomsBySpace, setRoomsBySpace] = useState<Record<string, MatrixRoom[]>>({})
  const [isLoading, setIsLoading] = useState(!!client)

  useEffect(() => {
    if (!client) {
      return
    }

    const emitter = client as unknown as {
      on: (event: string, listener: (...args: unknown[]) => void) => void
      removeListener: (event: string, listener: (...args: unknown[]) => void) => void
    }

    const toLastTs = (room: Room): number => {
      const events = room.getLiveTimeline().getEvents()
      const lastMessage = [...events].reverse().find((event) => event.getType() === 'm.room.message')
      return lastMessage?.getTs() || 0
    }

    const recompute = () => {
      const joinedRooms = client.getRooms()
      const spaceRooms = joinedRooms.filter((room) => isSpaceRoom(room))
      const nextRoomsBySpace: Record<string, MatrixRoom[]> = {}

      const nextSpaces = spaceRooms
        .map((spaceRoom) => {
          try {
            const childIds = getSpaceChildRoomIds(spaceRoom)

            const childRooms = childIds
              .map((id) => client.getRoom(id))
              .filter((room): room is Room => Boolean(room && !isSpaceRoom(room)))
              .sort((a, b) => toLastTs(b) - toLastTs(a))

            nextRoomsBySpace[spaceRoom.roomId] = childRooms.map((room) => roomToMatrixRoom(room))

            return {
              space: roomToMatrixSpace(spaceRoom, childRooms),
              sortKey: Math.max(toLastTs(spaceRoom), ...childRooms.map((room) => toLastTs(room)), 0),
            }
          } catch (error) {
            console.error('Failed to map Matrix space:', error)
            return null
          }
        })
        .filter((entry): entry is { space: MatrixSpace; sortKey: number } => entry !== null)
        .sort((a, b) => b.sortKey - a.sortKey)
        .map((entry) => entry.space)

      setSpaces(nextSpaces)
      setRoomsBySpace(nextRoomsBySpace)
      setIsLoading(false)
    }

    recompute()

    emitter.on('Room', recompute)
    emitter.on('RoomState.events', recompute)
    emitter.on('Room.timeline', recompute)
    emitter.on('Room.receipt', recompute)
    emitter.on('Room.myMembership', recompute)

    return () => {
      emitter.removeListener('Room', recompute)
      emitter.removeListener('RoomState.events', recompute)
      emitter.removeListener('Room.timeline', recompute)
      emitter.removeListener('Room.receipt', recompute)
      emitter.removeListener('Room.myMembership', recompute)
    }
  }, [client])

  return {
    spaces,
    roomsBySpace,
    isLoading,
  }
}

export function useDirectRoomList(client: MatrixClient | null): UseDirectRoomListReturn {
  const [rooms, setRooms] = useState<MatrixRoom[]>([])
  const [isLoading, setIsLoading] = useState(!!client)

  useEffect(() => {
    if (!client) return

    const emitter = client as unknown as {
      on: (event: string, listener: (...args: unknown[]) => void) => void
      removeListener: (event: string, listener: (...args: unknown[]) => void) => void
    }

    const recompute = () => {
      const directData = client.getAccountData('m.direct')?.getContent() as
        | Record<string, string[]>
        | undefined
      const userId = client.getUserId()

      const directRoomIds = new Set<string>(
        Object.values(directData || {}).flatMap((ids) => ids || []),
      )

      const directRooms = client
        .getRooms()
        .filter((room) => !isSpaceRoom(room))
        .filter((room) => {
          if (directRoomIds.has(room.roomId)) {
            return true
          }

          // Fallback: treat joined 1:1 rooms as DMs when m.direct is missing or delayed.
          if (!userId) return false
          const joinedMembers = room.getMembers().filter((member) => member.membership === 'join')
          const otherJoinedMembers = joinedMembers.filter((member) => member.userId !== userId)
          return joinedMembers.length <= 2 && otherJoinedMembers.length === 1
        })
        .map((room) => roomToMatrixRoom(room))
        .sort((a, b) => (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0))

      setRooms(directRooms)
      setIsLoading(false)
    }

    recompute()

    emitter.on('AccountData', recompute)
    emitter.on('Room', recompute)
    emitter.on('Room.timeline', recompute)
    emitter.on('Room.receipt', recompute)
    emitter.on('Room.myMembership', recompute)

    return () => {
      emitter.removeListener('AccountData', recompute)
      emitter.removeListener('Room', recompute)
      emitter.removeListener('Room.timeline', recompute)
      emitter.removeListener('Room.receipt', recompute)
      emitter.removeListener('Room.myMembership', recompute)
    }
  }, [client])

  return {
    rooms,
    isLoading,
  }
}


