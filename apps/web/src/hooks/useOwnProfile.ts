'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { UserEvent, type MatrixClient } from 'matrix-js-sdk'
import {
  loadOwnPresence,
  loadOwnStatus,
  subscribeOwnStatus,
  subscribeOwnPresence,
  subscribeOwnProfileChanges,
  type OwnPresence,
} from '@nexspeak/core/matrix/profile'

export interface OwnProfile {
  userId: string
  name: string
  avatarMxc?: string
}

export function useOwnProfile(client: MatrixClient | null): OwnProfile | null {
  const [profile, setProfile] = useState<OwnProfile | null>(null)

  useEffect(() => {
    const userId = client?.getUserId()
    if (!client || !userId) return

    const refresh = () => {
      const user = client.getUser(userId)
      setProfile({ userId, name: user?.displayName || userId, avatarMxc: user?.avatarUrl || undefined })
    }

    // The own user object is often only populated after the first sync; fetch it explicitly.
    const fetchProfile = () => {
      client
        .getProfileInfo(userId)
        .then((info) => setProfile({ userId, name: info.displayname || userId, avatarMxc: info.avatar_url || undefined }))
        .catch(() => {})
    }

    queueMicrotask(refresh)
    fetchProfile()

    const unsubscribe = subscribeOwnProfileChanges(fetchProfile)
    client.on(UserEvent.DisplayName, refresh)
    client.on(UserEvent.AvatarUrl, refresh)
    return () => {
      unsubscribe()
      client.removeListener(UserEvent.DisplayName, refresh)
      client.removeListener(UserEvent.AvatarUrl, refresh)
    }
  }, [client])

  return profile
}

export function useOwnPresence(): OwnPresence {
  return useSyncExternalStore(subscribeOwnPresence, loadOwnPresence, () => 'online')
}

export function useOwnStatus(client: MatrixClient | null): string {
  return useSyncExternalStore(subscribeOwnStatus, () => loadOwnStatus(client), () => '')
}
