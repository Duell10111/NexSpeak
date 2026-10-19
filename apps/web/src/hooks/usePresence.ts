/**
 * usePresence Hook
 * Presence of a few people (DM partners, friends), updated from the SDK's presence events and
 * batched per frame. Only subscribed while a component showing it is mounted.
 */

'use client'

import { useEffect, useState } from 'react'
import { UserEvent, type MatrixClient } from 'matrix-js-sdk'
import { getUserPresence, type UserPresence } from '@nexspeak/core/matrix/presence'

function readPresence(client: MatrixClient, userIds: string[]): Record<string, UserPresence> {
  return Object.fromEntries(userIds.map((userId) => [userId, getUserPresence(client, userId)]))
}

function samePresence(a: Record<string, UserPresence>, b: Record<string, UserPresence>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

export function usePresence(client: MatrixClient | null, userIds: string[]): Record<string, UserPresence> {
  // Joined so the effect only re-subscribes when the set of people changes.
  const key = [...new Set(userIds)].sort().join('\n')
  const [state, setState] = useState<{ key: string; presence: Record<string, UserPresence> }>({ key: '', presence: {} })

  useEffect(() => {
    if (!client || !key) return
    const ids = key.split('\n')
    const watched = new Set(ids)
    let frame: number | null = null

    const refresh = () => {
      frame = null
      const presence = readPresence(client, ids)
      setState((current) => (current.key === key && samePresence(current.presence, presence) ? current : { key, presence }))
    }
    const schedule = (_event: unknown, user?: { userId: string }) => {
      if (frame !== null || (user && !watched.has(user.userId))) return
      frame = requestAnimationFrame(refresh)
    }

    refresh()
    client.on(UserEvent.Presence, schedule)
    client.on(UserEvent.CurrentlyActive, schedule)
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      client.removeListener(UserEvent.Presence, schedule)
      client.removeListener(UserEvent.CurrentlyActive, schedule)
    }
  }, [client, key])

  return state.key === key ? state.presence : {}
}
