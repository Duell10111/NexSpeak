'use client'

import { useCallback, useSyncExternalStore } from 'react'
import type { MatrixClient } from 'matrix-js-sdk'
import {
  getCommonNotificationMode,
  subscribePushRules,
  type RoomNotificationMode,
} from '@nexspeak/core/matrix/room-notifications'

/** The notification level of one channel, or of all channels of a server (null: they differ). */
export function useNotificationMode(client: MatrixClient | null, roomIds: string[]): RoomNotificationMode | null {
  const key = roomIds.join('|')
  const subscribe = useCallback(
    (onChange: () => void) => (client ? subscribePushRules(client, onChange) : () => {}),
    [client],
  )
  // A string snapshot keeps useSyncExternalStore stable between push rule changes.
  const getSnapshot = useCallback(
    () => (client && key ? (getCommonNotificationMode(client, key.split('|')) ?? '') : 'default'),
    [client, key],
  )
  const mode = useSyncExternalStore(subscribe, getSnapshot, () => 'default')
  return (mode || null) as RoomNotificationMode | null
}
