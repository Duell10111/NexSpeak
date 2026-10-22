/** Presence of other people, as the homeserver reports it. */

import type { MatrixClient } from 'matrix-js-sdk'

export type UserPresence = 'online' | 'unavailable' | 'offline' | 'unknown'

/** "unknown" when the server never sent presence for them (e.g. presence disabled). */
export function getUserPresence(client: MatrixClient, userId: string): UserPresence {
  const user = client.getUser(userId)
  // Servers with presence disabled never send any; don't show everybody as offline then.
  if (!user || !(user.lastPresenceTs > 0 || user.currentlyActive)) return 'unknown'
  if (user.presence === 'online' || user.currentlyActive) return 'online'
  return user.presence === 'unavailable' ? 'unavailable' : 'offline'
}

/** Read the latest event: SDK presenceStatusMsg retains an old value when status_msg is cleared. */
export function getUserStatus(client: MatrixClient, userId: string): string {
  const status = client.getUser(userId)?.events.presence?.getContent().status_msg
  return typeof status === 'string' ? status : ''
}
