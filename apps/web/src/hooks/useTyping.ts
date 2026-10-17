/**
 * Typing notifications: who else is typing in a room, and announcing our own typing.
 */

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { RoomMemberEvent, type MatrixClient, type MatrixEvent, type RoomMember } from 'matrix-js-sdk'

const TYPING_TIMEOUT_MS = 6000
const TYPING_REFRESH_MS = 4000

export function useTypingMembers(client: MatrixClient | null, roomId: string): string[] {
  const [state, setState] = useState<{ roomId: string; names: string[] } | null>(null)

  useEffect(() => {
    if (!client || !roomId) return
    const ownUserId = client.getUserId()

    const refresh = () => {
      const room = client.getRoom(roomId)
      const names =
        room
          ?.getMembers()
          .filter((member) => member.typing && member.userId !== ownUserId)
          .map((member) => member.name) ?? []
      setState({ roomId, names })
    }
    const onTyping = (_event: MatrixEvent, member: RoomMember) => {
      if (member.roomId === roomId) refresh()
    }

    queueMicrotask(refresh)
    client.on(RoomMemberEvent.Typing, onTyping)
    return () => {
      client.removeListener(RoomMemberEvent.Typing, onTyping)
    }
  }, [client, roomId])

  return state && state.roomId === roomId ? state.names : []
}

/** Returns a callback to call on every keystroke; stops automatically after inactivity. */
export function useTypingNotifier(client: MatrixClient | null, roomId: string) {
  const lastSentRef = useRef(0)
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stop = useCallback(() => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current)
    stopTimerRef.current = null
    if (!client || !roomId || lastSentRef.current === 0) return
    lastSentRef.current = 0
    client.sendTyping(roomId, false, 0).catch(() => {})
  }, [client, roomId])

  const notify = useCallback(
    (isComposing: boolean) => {
      if (!client || !roomId) return
      if (!isComposing) {
        stop()
        return
      }

      const now = Date.now()
      if (now - lastSentRef.current > TYPING_REFRESH_MS) {
        lastSentRef.current = now
        client.sendTyping(roomId, true, TYPING_TIMEOUT_MS).catch(() => {})
      }
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current)
      stopTimerRef.current = setTimeout(stop, TYPING_REFRESH_MS)
    },
    [client, roomId, stop],
  )

  useEffect(() => stop, [stop])

  return { notifyTyping: notify, stopTyping: stop }
}
