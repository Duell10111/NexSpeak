/**
 * useRtcCallInfo Hook
 * Who is currently in a MatrixRTC call, per room — for the "in call" hints in the room list.
 * Covers calls from any MatrixRTC client (NexSpeak, Element Call, Element X).
 */

'use client'

import { useEffect, useState } from 'react'
import type { MatrixClient } from 'matrix-js-sdk'
import {
  MatrixRTCSessionEvent,
  MatrixRTCSessionManagerEvents,
  type MatrixRTCSession,
} from 'matrix-js-sdk/lib/matrixrtc'

export interface RoomCallInfo {
  names: string[]
}

function readCallInfo(client: MatrixClient): Record<string, RoomCallInfo> {
  const result: Record<string, RoomCallInfo> = {}
  client.getRooms().forEach((room) => {
    const session = client.matrixRTC.getActiveRoomSession(room)
    if (!session || session.memberships.length === 0) return

    const names = new Set<string>()
    session.memberships.forEach((membership) => {
      names.add(room.getMember(membership.sender)?.name || membership.sender)
    })
    result[room.roomId] = { names: Array.from(names).sort((a, b) => a.localeCompare(b)) }
  })
  return result
}

export function useRtcCallInfo(client: MatrixClient | null): Record<string, RoomCallInfo> {
  const [state, setState] = useState<{ client: MatrixClient | null; info: Record<string, RoomCallInfo> }>({
    client: null,
    info: {},
  })

  useEffect(() => {
    if (!client) return

    const watched = new Set<MatrixRTCSession>()
    const refresh = () => {
      client.getRooms().forEach((room) => {
        const session = client.matrixRTC.getActiveRoomSession(room)
        if (session && !watched.has(session)) {
          session.on(MatrixRTCSessionEvent.MembershipsChanged, refresh)
          watched.add(session)
        }
      })
      setState({ client, info: readCallInfo(client) })
    }

    queueMicrotask(refresh)
    client.matrixRTC.on(MatrixRTCSessionManagerEvents.SessionStarted, refresh)
    client.matrixRTC.on(MatrixRTCSessionManagerEvents.SessionEnded, refresh)

    return () => {
      client.matrixRTC.off(MatrixRTCSessionManagerEvents.SessionStarted, refresh)
      client.matrixRTC.off(MatrixRTCSessionManagerEvents.SessionEnded, refresh)
      watched.forEach((session) => session.off(MatrixRTCSessionEvent.MembershipsChanged, refresh))
    }
  }, [client])

  return state.client === client ? state.info : {}
}
