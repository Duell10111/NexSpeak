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
  RoomEvent,
  RoomStateEvent,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk'
import { getSpaceChildRoomIds, roomToMatrixRoom, roomToMatrixSpace } from '@/lib/matrix/types'
import { getDirectRoomIds, isDirectRoom, looksLikeDirectRoom } from '@/lib/matrix/direct'
import { getOrderedChildIds } from '@/lib/matrix/server'
import type { MatrixRoom, MatrixSpace } from '@/lib/matrix/types'

const RECOMPUTE_DELAY_MS = 150

/** A block of channels: the server's own channels (no name) or a category (sub-space). */
export interface ServerSection {
  id: string
  /** Category name; undefined for the channels directly in the server. */
  name?: string
  isCategory: boolean
  rooms: MatrixRoom[]
}

export interface RoomDirectory {
  spaces: MatrixSpace[]
  /** All channels of a server in display order, categories flattened. */
  roomsBySpace: Record<string, MatrixRoom[]>
  sectionsBySpace: Record<string, ServerSection[]>
  /** Changes when channels or categories are added to or removed from a server. */
  structureKeyBySpace: Record<string, string>
  directRooms: MatrixRoom[]
  /** Joined rooms that are neither DMs nor part of a joined space. */
  otherRooms: MatrixRoom[]
  invites: MatrixRoom[]
}

const EMPTY_DIRECTORY: RoomDirectory = {
  spaces: [],
  roomsBySpace: {},
  sectionsBySpace: {},
  structureKeyBySpace: {},
  directRooms: [],
  otherRooms: [],
  invites: [],
}

function byActivity(a: MatrixRoom, b: MatrixRoom): number {
  return b.lastActivityTs - a.lastActivityTs
}

function joinedChildren(client: MatrixClient, space: Room): Room[] {
  return getOrderedChildIds(space)
    .map((id) => client.getRoom(id))
    .filter((room): room is Room => Boolean(room && room.getMyMembership() === 'join'))
}

/** Channels of a category, including those of deeper sub-spaces (Discord has one level). */
function collectChannels(client: MatrixClient, space: Room, visited: Set<string>): Room[] {
  if (visited.has(space.roomId)) return []
  visited.add(space.roomId)
  const channels: Room[] = []
  joinedChildren(client, space).forEach((child) => {
    if (child.isSpaceRoom()) {
      channels.push(...collectChannels(client, child, visited))
    } else if (!visited.has(child.roomId)) {
      visited.add(child.roomId)
      channels.push(child)
    }
  })
  return channels
}

export function computeRoomDirectory(client: MatrixClient): RoomDirectory {
  const allRooms = client.getRooms()
  const joined = allRooms.filter((room) => room.getMyMembership() === 'join')
  const invites = allRooms
    .filter((room) => room.getMyMembership() === 'invite')
    .map(roomToMatrixRoom)
    .sort(byActivity)

  const joinedSpaces = joined.filter((room) => room.isSpaceRoom())
  // Sub-spaces are categories of their server, not servers of their own.
  const nestedSpaceIds = new Set(joinedSpaces.flatMap((space) => getSpaceChildRoomIds(space)))
  const serverRooms = joinedSpaces
    .filter((space) => !nestedSpaceIds.has(space.roomId))
    .sort((a, b) => a.name.localeCompare(b.name))
  const directIds = getDirectRoomIds(client)
  const isListedDirect = (room: Room): boolean => isDirectRoom(client, room, directIds)

  const roomsBySpace: Record<string, MatrixRoom[]> = {}
  const sectionsBySpace: Record<string, ServerSection[]> = {}
  const structureKeyBySpace: Record<string, string> = {}
  const roomIdsInSpaces = new Set<string>()

  const spaces = serverRooms.map((server) => {
    const visited = new Set<string>([server.roomId])
    // Discord lists the channels without category first, then the categories.
    const sections: ServerSection[] = [{ id: server.roomId, isCategory: false, rooms: [] }]
    const structure: string[] = getSpaceChildRoomIds(server)
    const serverChannels: Room[] = []

    joinedChildren(client, server).forEach((child) => {
      if (child.isSpaceRoom()) {
        structure.push(...getSpaceChildRoomIds(child))
        const channels = collectChannels(client, child, visited).filter((room) => !isListedDirect(room))
        serverChannels.push(...channels)
        sections.push({ id: child.roomId, name: child.name, isCategory: true, rooms: channels.map(roomToMatrixRoom) })
      } else if (!visited.has(child.roomId) && !isListedDirect(child)) {
        visited.add(child.roomId)
        serverChannels.push(child)
        sections[0].rooms.push(roomToMatrixRoom(child))
      }
    })

    serverChannels.forEach((room) => roomIdsInSpaces.add(room.roomId))
    roomsBySpace[server.roomId] = sections.flatMap((section) => section.rooms)
    sectionsBySpace[server.roomId] = sections
    structureKeyBySpace[server.roomId] = structure.join(',')
    return roomToMatrixSpace(server, serverChannels)
  })
  const directRooms: MatrixRoom[] = []
  const otherRooms: MatrixRoom[] = []

  joined.forEach((room) => {
    if (room.isSpaceRoom()) return

    if (isListedDirect(room)) {
      directRooms.push(roomToMatrixRoom(room))
      return
    }
    if (roomIdsInSpaces.has(room.roomId)) return

    // Outside any space, a 1:1 room without m.direct entry is most likely a DM too.
    if (looksLikeDirectRoom(client, room)) {
      directRooms.push(roomToMatrixRoom(room))
    } else {
      otherRooms.push(roomToMatrixRoom(room))
    }
  })

  return {
    spaces,
    roomsBySpace,
    sectionsBySpace,
    structureKeyBySpace,
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
