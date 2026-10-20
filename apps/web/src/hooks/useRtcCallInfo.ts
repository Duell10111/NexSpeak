/**
 * useRtcCallInfo Hook
 * Who is currently in a MatrixRTC call, per room — for the "in call" hints in the room list.
 * Covers calls from any MatrixRTC client (NexSpeak, Element Call, Element X).
 */

'use client'

import { useEffect, useState } from 'react'
import { ClientEvent, KnownMembership, RoomEvent, type MatrixClient } from 'matrix-js-sdk'
import {
  MatrixRTCSessionEvent,
  MatrixRTCSessionManagerEvents,
  type MatrixRTCSession,
} from 'matrix-js-sdk/lib/matrixrtc/index.js'

export interface RoomCallMember {
  userId: string
  name: string
  avatarMxc?: string
}

export interface RoomCallInfo {
  /** One entry per user, even when they joined with several devices. */
  members: RoomCallMember[]
  /** Oldest current membership's creation time, in milliseconds since the epoch. */
  startedTs?: number
}

/**
 * The session manager only registers sessions it sees starting after the initial sync:
 * its start() checks memberships before they are computed (matrix-js-sdk 41). So calls that
 * were already running at login would never show up. Ask for every joined room's session
 * ourselves instead; the manager keeps exactly one session object per room either way.
 */
function joinedRoomSessions(client: MatrixClient): MatrixRTCSession[] {
  return client
    .getRooms()
    .filter((room) => room.getMyMembership() === KnownMembership.Join)
    .map((room) => client.matrixRTC.getRoomSession(room))
}

function readCallInfo(sessions: MatrixRTCSession[]): Record<string, RoomCallInfo> {
  const result: Record<string, RoomCallInfo> = {}
  sessions.forEach((session) => {
    if (session.memberships.length === 0) return
    const room = session.room

    const members = new Map<string, RoomCallMember>()
    session.memberships.forEach((membership) => {
      if (!membership.sender || members.has(membership.sender)) return
      const member = room.getMember(membership.sender)
      members.set(membership.sender, {
        userId: membership.sender,
        name: member?.name || membership.sender,
        avatarMxc: member?.getMxcAvatarUrl() || undefined,
      })
    })
    // Session memberships keep created_ts across renewals. For the experimental sticky
    // "rtc" kind the SDK still returns the latest event time (CallMembership.createdTs TODO).
    // NexSpeak does not enable unstableSendStickyEvents when joining calls.
    result[room.roomId] = {
      members: Array.from(members.values()).sort((a, b) => a.name.localeCompare(b.name)),
      startedTs: session.getOldestMembership()?.createdTs(),
    }
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
    let frame: number | null = null

    const refresh = () => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        const sessions = joinedRoomSessions(client)
        sessions.forEach((session) => {
          if (watched.has(session)) return
          // Memberships are computed asynchronously; this fires once they are known.
          session.on(MatrixRTCSessionEvent.MembershipsChanged, refresh)
          watched.add(session)
        })
        setState({ client, info: readCallInfo(sessions) })
      })
    }

    refresh()
    client.on(ClientEvent.Room, refresh)
    client.on(RoomEvent.MyMembership, refresh)
    client.matrixRTC.on(MatrixRTCSessionManagerEvents.SessionStarted, refresh)
    client.matrixRTC.on(MatrixRTCSessionManagerEvents.SessionEnded, refresh)

    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      client.off(ClientEvent.Room, refresh)
      client.off(RoomEvent.MyMembership, refresh)
      client.matrixRTC.off(MatrixRTCSessionManagerEvents.SessionStarted, refresh)
      client.matrixRTC.off(MatrixRTCSessionManagerEvents.SessionEnded, refresh)
      watched.forEach((session) => session.off(MatrixRTCSessionEvent.MembershipsChanged, refresh))
    }
  }, [client])

  return state.client === client ? state.info : {}
}
