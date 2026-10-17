'use client'

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { MatrixClient } from 'matrix-js-sdk'
import { subscribeIgnoredUsers } from '@nexspeak/core/matrix/safety'

function useIgnoredSnapshot(client: MatrixClient | null): string {
  const subscribe = useCallback(
    (onChange: () => void) => (client ? subscribeIgnoredUsers(client, onChange) : () => {}),
    [client],
  )
  // Joined to a string so the snapshot is stable until the list changes.
  return useSyncExternalStore(subscribe, () => client?.getIgnoredUsers().join('\n') ?? '', () => '')
}

export function useIgnoredUsers(client: MatrixClient | null): string[] {
  const joined = useIgnoredSnapshot(client)
  return useMemo(() => (joined ? joined.split('\n') : []), [joined])
}

export function useIsIgnored(client: MatrixClient | null, userId: string): boolean {
  return useIgnoredUsers(client).includes(userId)
}
