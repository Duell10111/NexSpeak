/**
 * MatrixRTC helpers: LiveKit transport discovery and SFU token exchange.
 * Mirrors what Element Call does so both clients can share a call.
 */

import { EventType, Method, type IOpenIDToken, type MatrixClient, type Room } from 'matrix-js-sdk'
import type { CallMembership, LivekitTransport, Transport } from 'matrix-js-sdk/lib/matrixrtc'
import { t } from '@nexspeak/i18n'

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
  url?: string
}
// Weak keys release results with the client. Successful cache entries expire on demand.
const discoveryCache = new WeakMap<MatrixClient, DiscoveryEntry>()

function parseServiceUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url : null
  } catch {
    return null
  }
}

/** Services from our own homeserver or build config, which already sees our traffic. */
function isServiceUrl(value: unknown): value is string {
  return parseServiceUrl(value) !== null
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Services advertised by other call members receive our OpenID token:
 * plain HTTP only to this machine (local development), never across the network.
 */
function isSecureServiceUrl(value: unknown): value is string {
  const url = parseServiceUrl(value)
  return url !== null && (url.protocol === 'https:' || LOOPBACK_HOSTS.has(url.hostname) || url.hostname.endsWith('.localhost'))
}

function isLivekitServiceTransport(
  transport: unknown,
  isAcceptedUrl: (value: unknown) => value is string,
): transport is Transport & { livekit_service_url: string } {
  return (
    typeof transport === 'object' &&
    transport !== null &&
    (transport as Transport).type === 'livekit' &&
    isAcceptedUrl((transport as { livekit_service_url?: unknown }).livekit_service_url)
  )
}

/** Our membership tells other clients where to join, so a relative build setting becomes absolute. */
function fallbackServiceUrl(): string | null {
  const value = process.env.NEXT_PUBLIC_LIVEKIT_SERVICE_URL
  if (!value) return null
  try {
    const url = new URL(value, typeof location === 'undefined' ? undefined : location.href).href
    return isServiceUrl(url) ? url : null
  } catch {
    return null
  }
}

async function fromWellKnown(baseUrl: string, signal: AbortSignal): Promise<string | null> {
  signal.throwIfAborted()
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/.well-known/matrix/client`, { signal })
    if (!response.ok) return null
    const foci = (await response.json())['org.matrix.msc4143.rtc_foci']
    signal.throwIfAborted()
    const focus = Array.isArray(foci) ? foci.find((transport) => isLivekitServiceTransport(transport, isServiceUrl)) : undefined
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
    (url) => {
      if (discoveryCache.get(client) !== entry) return
      entry.expiresAt = Date.now() + DISCOVERY_CACHE_MS
      entry.cancel = undefined
      entry.url = url
    },
    () => { if (discoveryCache.get(client) === entry) discoveryCache.delete(client) },
  )
  return entry.result
}

const OPENID_PENDING_MS = 10_000
const OPENID_EXPIRY_MARGIN_MS = 60_000
interface OpenIdEntry {
  token: Promise<IOpenIDToken>
  expiresAt: number
}
const openIdCache = new WeakMap<MatrixClient, OpenIdEntry>()

/**
 * OpenID tokens stay valid for their whole lifetime (usually an hour), so joins share one
 * instead of requesting a new token each time, also across attempts whose discovery failed.
 */
export function getOpenIdToken(client: MatrixClient): Promise<IOpenIDToken> {
  const cached = openIdCache.get(client)
  if (cached && Date.now() < cached.expiresAt) return cached.token

  // A hung request is shared only briefly, so it cannot block later joins.
  const entry: OpenIdEntry = { token: client.getOpenIdToken(), expiresAt: Date.now() + OPENID_PENDING_MS }
  openIdCache.set(client, entry)
  void entry.token.then(
    (token) => {
      if (openIdCache.get(client) !== entry) return
      entry.expiresAt = Date.now() + token.expires_in * 1000 - OPENID_EXPIRY_MARGIN_MS
    },
    () => { if (openIdCache.get(client) === entry) openIdCache.delete(client) },
  )
  return entry.token
}

/** Drop the shared OpenID token, e.g. after a service rejected it. */
export function forgetOpenIdToken(client: MatrixClient): void {
  openIdCache.delete(client)
}

/**
 * Drop a cached discovery result after its service failed, so the next join looks again
 * instead of reusing a dead service for the rest of the cache lifetime.
 */
export function forgetLivekitServiceUrl(client: MatrixClient, serviceUrl: string | undefined): void {
  const cached = discoveryCache.get(client)
  if (serviceUrl && cached?.url === serviceUrl) discoveryCache.delete(client)
}

async function discoverUncached(client: MatrixClient, signal: AbortSignal): Promise<string> {
  try {
    // Same endpoint as _unstable_getRTCTransports, whose wrapper accepts no abort signal.
    const { rtc_transports: transports } = await client.http.authedRequest<{ rtc_transports: Transport[] }>(
      Method.Get, '/rtc/transports', undefined, undefined,
      { prefix: '/_matrix/client/unstable/org.matrix.msc4143', abortSignal: signal },
    )
    signal.throwIfAborted()
    const transport = transports.find((transport) => isLivekitServiceTransport(transport, isServiceUrl))
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

  const fallback = fallbackServiceUrl()
  if (fallback) return fallback

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
  return isLivekitServiceTransport(transport, isSecureServiceUrl) ? transport.livekit_service_url : ownServiceUrl
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
  serviceUrl: string,
  roomId: string,
  openIdToken: IOpenIDToken,
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
