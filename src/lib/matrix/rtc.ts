/**
 * MatrixRTC helpers: LiveKit transport discovery and SFU token exchange.
 * Mirrors what Element Call does so both clients can share a call.
 */

import { EventType, type MatrixClient, type Room } from 'matrix-js-sdk'
import type { CallMembership, LivekitTransport, Transport } from 'matrix-js-sdk/lib/matrixrtc'

export interface SfuConfig {
  url: string
  jwt: string
}

function isLivekitServiceTransport(transport: unknown): transport is Transport & { livekit_service_url: string } {
  return (
    typeof transport === 'object' &&
    transport !== null &&
    (transport as Transport).type === 'livekit' &&
    typeof (transport as { livekit_service_url?: unknown }).livekit_service_url === 'string'
  )
}

async function fromWellKnown(baseUrl: string): Promise<string | null> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/.well-known/matrix/client`)
    if (!response.ok) return null
    const foci = (await response.json())['org.matrix.msc4143.rtc_foci']
    const focus = Array.isArray(foci) ? foci.find(isLivekitServiceTransport) : undefined
    return focus?.livekit_service_url ?? null
  } catch {
    return null
  }
}

/**
 * Find the LiveKit JWT service the user's homeserver offers (MSC4143),
 * falling back to .well-known and finally to NEXT_PUBLIC_LIVEKIT_SERVICE_URL.
 */
export async function discoverLivekitServiceUrl(client: MatrixClient): Promise<string> {
  try {
    const transports = await client._unstable_getRTCTransports()
    const transport = transports.find(isLivekitServiceTransport)
    if (transport) return transport.livekit_service_url
  } catch {
    // Endpoint not supported by this homeserver; try the other mechanisms.
  }

  const domain = client.getDomain()
  const fromDomain = domain ? await fromWellKnown(`https://${domain}`) : null
  if (fromDomain) return fromDomain

  const fromHomeserver = await fromWellKnown(client.getHomeserverUrl())
  if (fromHomeserver) return fromHomeserver

  const fallback = process.env.NEXT_PUBLIC_LIVEKIT_SERVICE_URL
  if (fallback) return fallback

  throw new Error('Dein Homeserver bietet keine Sprachkanäle an (kein MatrixRTC/LiveKit-Dienst konfiguriert).')
}

/**
 * The SFU everybody in the call has to use: the one of the oldest membership
 * ("oldest_membership" focus selection), or our own when we start the call.
 */
export function selectActiveServiceUrl(
  memberships: CallMembership[],
  oldest: CallMembership | undefined,
  ownServiceUrl: string,
): string {
  if (!oldest) return ownServiceUrl
  const transport = memberships.length > 0 ? oldest.getTransport(oldest) : undefined
  return isLivekitServiceTransport(transport) ? transport.livekit_service_url : ownServiceUrl
}

export function ownLivekitTransport(serviceUrl: string, roomId: string): LivekitTransport {
  return { type: 'livekit', livekit_service_url: serviceUrl, livekit_alias: roomId }
}

/**
 * Exchange a Matrix OpenID token for a LiveKit token at the JWT service.
 * Uses the legacy /sfu/get endpoint, which assigns the "<user_id>:<device_id>" identity
 * that all MatrixRTC clients match memberships against.
 */
export async function getSfuConfig(client: MatrixClient, serviceUrl: string, roomId: string): Promise<SfuConfig> {
  const openIdToken = await client.getOpenIdToken()
  const response = await fetch(`${serviceUrl.replace(/\/+$/, '')}/sfu/get`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room: roomId, openid_token: openIdToken, device_id: client.getDeviceId() }),
  })

  if (!response.ok) {
    throw new Error(`Der Sprachdienst hat die Anmeldung abgelehnt (${response.status}).`)
  }

  const config = (await response.json()) as Partial<SfuConfig>
  if (!config.url || !config.jwt) throw new Error('Ungültige Antwort vom Sprachdienst.')
  return { url: config.url, jwt: config.jwt }
}

/** LiveKit identities are "<user_id>:<device_id>"; device ids never contain ':'. */
export function userIdFromIdentity(identity: string): string {
  const separator = identity.lastIndexOf(':')
  const candidate = separator > 0 ? identity.slice(0, separator) : identity
  return candidate.startsWith('@') && candidate.includes(':') ? candidate : identity
}

/** State event every call participant has to send (MSC3401/MSC4143 membership). */
export const CALL_MEMBER_EVENT_TYPE = 'org.matrix.msc3401.call.member'

export class CallPermissionError extends Error {
  constructor(readonly canEnable: boolean) {
    super(
      canEnable
        ? 'Anrufe sind in diesem Raum noch nicht für alle Mitglieder freigegeben.'
        : 'Du hast keine Berechtigung, in diesem Raum an Anrufen teilzunehmen. Bitte einen Admin, Anrufe zu erlauben.',
    )
    this.name = 'CallPermissionError'
  }
}

export function canJoinCalls(room: Room, userId: string): boolean {
  return room.currentState.maySendStateEvent(CALL_MEMBER_EVENT_TYPE, userId)
}

/**
 * Let all members join calls, the same power level change Element applies when it creates
 * a room ("org.matrix.msc3401.call.member" at user level).
 */
export async function enableCallsInRoom(client: MatrixClient, roomId: string): Promise<void> {
  const room = client.getRoom(roomId)
  const current = room?.currentState.getStateEvents('m.room.power_levels', '')?.getContent() ?? {}
  const events = { ...(current.events as Record<string, number> | undefined), [CALL_MEMBER_EVENT_TYPE]: 0 }
  await client.sendStateEvent(roomId, EventType.RoomPowerLevels, { ...current, events } as never, '')
}

/** Whether ordinary members (default power level) are allowed to join calls in this room. */
export function membersCanJoinCalls(room: Room): boolean {
  const content = room.currentState.getStateEvents('m.room.power_levels', '')?.getContent() ?? {}
  const events = (content.events ?? {}) as Record<string, number>
  const required = events[CALL_MEMBER_EVENT_TYPE] ?? (content.state_default as number | undefined) ?? 50
  return ((content.users_default as number | undefined) ?? 0) >= required
}
