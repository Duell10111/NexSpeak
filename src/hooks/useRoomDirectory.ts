/**
 * useRoomDirectory Hook
 * Groups the user's rooms into spaces ("servers"), direct messages, rooms outside
 * any space and pending invites. Recomputes are throttled because the SDK emits
 * many events during sync.
 */

'use client'

import { useEffect, useState } from 'react'
import {
  ClientEvent,
  EventType,
  RoomEvent,
  RoomStateEvent,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk'
import { getSpaceChildRoomIds, roomToMatrixRoom, roomToMatrixSpace } from '@/lib/matrix/types'
import type { MatrixRoom, MatrixSpace } from '@/lib/matrix/types'

const RECOMPUTE_DELAY_MS = 150

export interface RoomDirectory {
  spaces: MatrixSpace[]
  roomsBySpace: Record<string, MatrixRoom[]>
  directRooms: MatrixRoom[]
  /** Joined rooms that are neither DMs nor part of a joined space. */
  otherRooms: MatrixRoom[]
  invites: MatrixRoom[]
}

const EMPTY_DIRECTORY: RoomDirectory = {
  spaces: [],
  roomsBySpace: {},
  directRooms: [],
  otherRooms: [],
  invites: [],
}

function byActivity(a: MatrixRoom, b: MatrixRoom): number {
  return b.lastActivityTs - a.lastActivityTs
}

function getDirectRoomIds(client: MatrixClient): Set<string> {
  const content = client.getAccountData(EventType.Direct)?.getContent() ?? {}
  return new Set(Object.values(content).flatMap((ids) => (Array.isArray(ids) ? ids : [])))
}

/** Rooms of a space, including rooms of nested sub-spaces, in the order the space defines. */
function collectSpaceRooms(client: MatrixClient, space: Room, visited: Set<string>): Room[] {
  if (visited.has(space.roomId)) return []
  visited.add(space.roomId)

  const orderOf = (roomId: string): string => {
    const order = space.currentState.getStateEvents('m.space.child', roomId)?.getContent().order
    return typeof order === 'string' ? order : '￿'
  }

  const result: Room[] = []
  const children = getSpaceChildRoomIds(space)
    .map((id) => client.getRoom(id))
    .filter((room): room is Room => Boolean(room && room.getMyMembership() === 'join'))
    .sort((a, b) => orderOf(a.roomId).localeCompare(orderOf(b.roomId)) || a.name.localeCompare(b.name))

  children.forEach((child) => {
    if (child.isSpaceRoom()) {
      result.push(...collectSpaceRooms(client, child, visited))
    } else {
      result.push(child)
    }
  })

  return result
}

export function computeRoomDirectory(client: MatrixClient): RoomDirectory {
  const allRooms = client.getRooms()
  const joined = allRooms.filter((room) => room.getMyMembership() === 'join')
  const invites = allRooms
    .filter((room) => room.getMyMembership() === 'invite')
    .map(roomToMatrixRoom)
    .sort(byActivity)

  const spaceRooms = joined
    .filter((room) => room.isSpaceRoom())
    .sort((a, b) => a.name.localeCompare(b.name))
  const directIds = getDirectRoomIds(client)
  const userId = client.getUserId()

  const isDirect = (room: Room): boolean => directIds.has(room.roomId) || Boolean(room.getDMInviter())

  const roomsBySpace: Record<string, MatrixRoom[]> = {}
  const roomIdsInSpaces = new Set<string>()
  const spaces = spaceRooms.map((spaceRoom) => {
    const rooms = collectSpaceRooms(client, spaceRoom, new Set()).filter((room) => !isDirect(room))
    rooms.forEach((room) => roomIdsInSpaces.add(room.roomId))
    roomsBySpace[spaceRoom.roomId] = rooms.map(roomToMatrixRoom)
    return roomToMatrixSpace(spaceRoom, rooms)
  })

  const directRooms: MatrixRoom[] = []
  const otherRooms: MatrixRoom[] = []

  joined.forEach((room) => {
    if (room.isSpaceRoom()) return

    if (isDirect(room)) {
      directRooms.push(roomToMatrixRoom(room))
      return
    }
    if (roomIdsInSpaces.has(room.roomId)) return

    // Fallback for when m.direct is missing: a 1:1 room outside any space is most likely a DM.
    const joinedMembers = room.getJoinedMembers()
    const looksDirect =
      Boolean(userId) &&
      joinedMembers.length === 2 &&
      joinedMembers.some((member) => member.userId === userId) &&
      !room.getCanonicalAlias()

    if (looksDirect) {
      directRooms.push(roomToMatrixRoom(room))
    } else {
      otherRooms.push(roomToMatrixRoom(room))
    }
  })

  return {
    spaces,
    roomsBySpace,
    directRooms: directRooms.sort(byActivity),
    otherRooms: otherRooms.sort(byActivity),
    invites,
  }
}

const CLIENT_EVENTS = [ClientEvent.Room, ClientEvent.DeleteRoom, ClientEvent.AccountData] as const
const ROOM_EVENTS = [
  RoomEvent.MyMembership,
  RoomEvent.Name,
  RoomEvent.Timeline,
  RoomEvent.Receipt,
  RoomEvent.UnreadNotifications,
  RoomEvent.LocalEchoUpdated,
  RoomStateEvent.Events,
] as const

export function useRoomDirectory(client: MatrixClient | null): RoomDirectory {
  const [state, setState] = useState<{ client: MatrixClient | null; directory: RoomDirectory }>({
    client: null,
    directory: EMPTY_DIRECTORY,
  })

  useEffect(() => {
    if (!client) return

    let timer: ReturnType<typeof setTimeout> | null = null
    const recomputeNow = () => {
      timer = null
      try {
        setState({ client, directory: computeRoomDirectory(client) })
      } catch (error) {
        console.error('Failed to compute room list:', error)
      }
    }
    const scheduleRecompute = () => {
      if (timer === null) timer = setTimeout(recomputeNow, RECOMPUTE_DELAY_MS)
    }

    // The SDK emitter is strongly typed per event; the listener signature doesn't matter here.
    const emitter = client as unknown as {
      on: (event: string, listener: () => void) => void
      removeListener: (event: string, listener: () => void) => void
    }

    const events = [...CLIENT_EVENTS, ...ROOM_EVENTS, ClientEvent.Sync]
    events.forEach((event) => emitter.on(event, scheduleRecompute))
    scheduleRecompute()

    return () => {
      if (timer !== null) clearTimeout(timer)
      events.forEach((event) => emitter.removeListener(event, scheduleRecompute))
    }
  }, [client])

  return state.client === client ? state.directory : EMPTY_DIRECTORY
}
