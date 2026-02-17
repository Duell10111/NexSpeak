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
import { roomToMatrixRoom } from '@/lib/matrix/types'
import type { MatrixRoom } from '@/lib/matrix/types'

interface UseRoomListReturn {
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

      setRooms(initialRooms)
      setIsLoading(false)

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

      client.on('Room' as any, handleRoomCreated)
      client.on('RoomState.events' as any, handleRoomStateEvent)
      client.on('Room.receipt' as any, handleRoomStateEvent)

      unsubscribersRef.current = [
        () => client.removeListener('Room' as any, handleRoomCreated),
        () => client.removeListener('RoomState.events' as any, handleRoomStateEvent),
        () => client.removeListener('Room.receipt' as any, handleRoomStateEvent),
      ]
    } catch (error) {
      console.error('Failed to initialize room list:', error)
      setIsLoading(false)
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


