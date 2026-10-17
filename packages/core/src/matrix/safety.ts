/**
 * Ignoring people and reporting content to the homeserver admins (spec: m.ignored_user_list,
 * POST /rooms/{roomId}/report/{eventId}, POST /rooms/{roomId}/report).
 */

import { ClientEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk'

export function isIgnored(client: MatrixClient, userId: string): boolean {
  return client.isUserIgnored(userId)
}

export async function setIgnored(client: MatrixClient, userId: string, ignored: boolean): Promise<void> {
  const current = client.getIgnoredUsers()
  if (ignored === current.includes(userId)) return
  await client.setIgnoredUsers(ignored ? [...current, userId] : current.filter((id) => id !== userId))
}

/** Calls `listener` when the ignore list changes (also from other devices). */
export function subscribeIgnoredUsers(client: MatrixClient, listener: () => void): () => void {
  const onAccountData = (event: MatrixEvent) => {
    if (event.getType() === 'm.ignored_user_list') listener()
  }
  client.on(ClientEvent.AccountData, onAccountData)
  return () => {
    client.removeListener(ClientEvent.AccountData, onAccountData)
  }
}

export const MAX_REPORT_REASON_LENGTH = 1000

/**
 * Reports a message to the homeserver admins. The score is deprecated in the spec; -100 ("most
 * offensive") is what Element sends.
 */
export async function reportMessage(client: MatrixClient, roomId: string, eventId: string, reason: string): Promise<void> {
  await client.reportEvent(roomId, eventId, -100, reason.trim().slice(0, MAX_REPORT_REASON_LENGTH))
}

export async function reportRoom(client: MatrixClient, roomId: string, reason: string): Promise<void> {
  await client.reportRoom(roomId, reason.trim().slice(0, MAX_REPORT_REASON_LENGTH))
}
