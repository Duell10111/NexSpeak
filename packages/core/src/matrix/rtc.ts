/**
 * MatrixRTC helpers: LiveKit transport discovery and SFU token exchange.
 * Mirrors what Element Call does so both clients can share a call.
 */

import { EventType, Method, type MatrixClient, type Room } from 'matrix-js-sdk'
import type { CallMembership, LivekitTransport, Transport } from 'matrix-js-sdk/lib/matrixrtc'
import { t } from '@nexspeak/i18n'
import type { CallTimings } from './call-timings'

export interface SfuConfig {
  url: string
  jwt: string
}

const DISCOVERY_CACHE_MS = 5 * 60_000
const DISCOVERY_TIMEOUT_MS = 10_000
interface DiscoveryEntry {
  result: Promise<string>
  expiresAt: number
  cancel?: () => void
}
// Weak keys release results with the client. Successful cache entries expire on demand.
const discoveryCache = new WeakMap<MatrixClient, DiscoveryEntry>()

function isServiceUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
  } catch {
    return false
  }
}

function isLivekitServiceTransport(transport: unknown): transport is Transport & { livekit_service_url: string } {
  return (
    typeof transport === 'object' &&
    transport !== null &&
    (transport as Transport).type === 'livekit' &&
    isServiceUrl((transport as { livekit_service_url?: unknown }).livekit_service_url)
  )
}

async function fromWellKnown(baseUrl: string, signal: AbortSignal): Promise<string | null> {
  signal.throwIfAborted()
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/.well-known/matrix/client`, { signal })
    if (!response.ok) return null
    const foci = (await response.json())['org.matrix.msc4143.rtc_foci']
    signal.throwIfAborted()
    const focus = Array.isArray(foci) ? foci.find(isLivekitServiceTransport) : undefined
    return focus?.livekit_service_url ?? null
  } catch {
    signal.throwIfAborted()
    return null
  }
}

/**
 * Find the LiveKit JWT service the user's homeserver offers (MSC4143),
 * falling back to .well-known and finally to NEXT_PUBLIC_LIVEKIT_SERVICE_URL.
 */
export function discoverLivekitServiceUrl(client: MatrixClient): Promise<string> {
  const cached = discoveryCache.get(client)
  if (cached && Date.now() < cached.expiresAt) return cached.result
  // Also handles a delayed timeout callback in a background tab before starting a new lookup.
  cached?.cancel?.()

  // Share in-flight discovery too. Failed attempts are never cached.
  const controller = new AbortController()
  let cancel!: () => void
  const timeout = new Promise<never>((_, reject) => {
    cancel = () => {
      const error = new Error(t('call.error.discoveryTimeout'))
      controller.abort(error)
      reject(error)
    }
  })
  const timer = setTimeout(cancel, DISCOVERY_TIMEOUT_MS)
  const entry: DiscoveryEntry = {
    result: Promise.race([discoverUncached(client, controller.signal), timeout]).finally(() => clearTimeout(timer)),
    expiresAt: Date.now() + DISCOVERY_TIMEOUT_MS,
    cancel,
  }
  discoveryCache.set(client, entry)
  void entry.result.then(
    () => {
      if (discoveryCache.get(client) !== entry) return
      entry.expiresAt = Date.now() + DISCOVERY_CACHE_MS
      entry.cancel = undefined
    },
    () => { if (discoveryCache.get(client) === entry) discoveryCache.delete(client) },
  )
  return entry.result
}

async function discoverUncached(client: MatrixClient, signal: AbortSignal): Promise<string> {
  try {
    // Same endpoint as _unstable_getRTCTransports, whose wrapper accepts no abort signal.
    const { rtc_transports: transports } = await client.http.authedRequest<{ rtc_transports: Transport[] }>(
      Method.Get, '/rtc/transports', undefined, undefined,
      { prefix: '/_matrix/client/unstable/org.matrix.msc4143', abortSignal: signal },
    )
    signal.throwIfAborted()
    const transport = transports.find(isLivekitServiceTransport)
    if (transport) return transport.livekit_service_url
  } catch {
    signal.throwIfAborted()
    // Endpoint not supported by this homeserver; try the other mechanisms.
  }

  const domain = client.getDomain()
  const fromDomain = domain ? await fromWellKnown(`https://${domain}`, signal) : null
  if (fromDomain) return fromDomain

  const fromHomeserver = await fromWellKnown(client.getHomeserverUrl(), signal)
  if (fromHomeserver) return fromHomeserver

  const fallback = process.env.NEXT_PUBLIC_LIVEKIT_SERVICE_URL
  if (isServiceUrl(fallback)) return fallback

  throw new Error(t('call.error.noService'))
}

/**
 * Reuse the service advertised by the oldest member, or fall back to discovery.
 * MatrixRTC keeps memberships sorted oldest first.
 */
export function selectActiveServiceUrl(
  memberships: CallMembership[],
  ownServiceUrl?: string,
): string | undefined {
  const oldest = memberships[0]
  if (!oldest) return ownServiceUrl
  const transport = oldest.getTransport()
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
export async function getSfuConfig(
  client: MatrixClient,
  serviceUrl: string | Promise<string>,
  roomId: string,
  timings?: CallTimings,
): Promise<SfuConfig> {
  // Attach both rejection handlers immediately: neither operation depends on the other.
  const [resolvedServiceUrl, openIdToken] = await Promise.all([
    serviceUrl,
    timings ? timings.measure('openid', () => client.getOpenIdToken()) : client.getOpenIdToken(),
  ])
  const exchange = () => exchangeSfuToken(client, resolvedServiceUrl, roomId, openIdToken)
  return timings ? timings.measure('token-exchange', exchange) : exchange()
}

async function exchangeSfuToken(
  client: MatrixClient,
  serviceUrl: string,
  roomId: string,
  openIdToken: Awaited<ReturnType<MatrixClient['getOpenIdToken']>>,
): Promise<SfuConfig> {
  const response = await fetch(`${serviceUrl.replace(/\/+$/, '')}/sfu/get`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room: roomId, openid_token: openIdToken, device_id: client.getDeviceId() }),
  })

  if (!response.ok) {
    throw new Error(t('call.error.serviceRejected', { status: response.status }))
  }

  const config = (await response.json()) as Partial<SfuConfig>
  if (!config.url || !config.jwt) throw new Error(t('call.error.invalidServiceResponse'))
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
        ? t('call.error.notEnabled')
        : t('call.error.noPermission'),
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
