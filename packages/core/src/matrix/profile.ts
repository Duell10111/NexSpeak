/**
 * The own profile (display name, avatar) and presence. Presence is sent with every sync
 * (`set_presence`), so the chosen value is remembered per device and applied before syncing;
 * otherwise the next sync would reset it to "online".
 */

import { MatrixError, SetPresence, type MatrixClient } from 'matrix-js-sdk'

export type OwnPresence = 'online' | 'unavailable' | 'offline' | 'dnd'

export const OWN_PRESENCE_OPTIONS: readonly OwnPresence[] = ['online', 'unavailable', 'dnd', 'offline']
export const STATUS_EXPIRY_OPTIONS = ['30m', '1h', '4h', 'today', 'never'] as const
export type StatusExpiry = typeof STATUS_EXPIRY_OPTIONS[number]
export const MAX_STATUS_LENGTH = 128

const PRESENCE_KEY = 'nexspeak_presence'
const STATUS_KEY = 'nexspeak_status:'
const listeners = new Set<() => void>()
const statusListeners = new Set<() => void>()
let volatilePresence: OwnPresence | undefined
interface CustomStatus { message: string; expiresAt: number | null }
const statuses = new Map<string, CustomStatus>()
interface PresenceSession {
  timer?: ReturnType<typeof setTimeout>
  retryTimer?: ReturnType<typeof setTimeout>
  cancelRetry?: () => void
  stopped: boolean
  queue: Promise<unknown>
}
const sessions = new WeakMap<MatrixClient, PresenceSession>()

function isOwnPresence(value: unknown): value is OwnPresence {
  return value === 'online' || value === 'unavailable' || value === 'offline' || value === 'dnd'
}

export function loadOwnPresence(): OwnPresence {
  try {
    const stored = localStorage.getItem(PRESENCE_KEY)
    return isOwnPresence(stored) ? stored : volatilePresence ?? 'online'
  } catch {
    return volatilePresence ?? 'online'
  }
}

export function subscribeOwnPresence(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function subscribeOwnStatus(listener: () => void): () => void {
  statusListeners.add(listener)
  return () => { statusListeners.delete(listener) }
}

const SYNC_PRESENCE: Record<OwnPresence, SetPresence> = {
  online: SetPresence.Online,
  unavailable: SetPresence.Unavailable,
  offline: SetPresence.Offline,
  // Matrix has no DND value. This device silences alerts; other clients see online.
  dnd: SetPresence.Online,
}

function readStatus(client: MatrixClient): CustomStatus | undefined {
  const userId = client.getUserId()
  if (!userId) return undefined
  if (statuses.has(userId)) return statuses.get(userId)
  try {
    const raw = localStorage.getItem(STATUS_KEY + userId)
    const stored = raw ? JSON.parse(raw) as CustomStatus : null
    if (stored && typeof stored.message === 'string' &&
        (stored.expiresAt === null || (typeof stored.expiresAt === 'number' && Number.isFinite(stored.expiresAt)))) {
      statuses.set(userId, stored)
      return stored
    }
  } catch { /* Storage can be unavailable. */ }
}

function rememberStatus(client: MatrixClient, status: CustomStatus): void {
  const userId = client.getUserId()
  if (!userId) return
  statuses.set(userId, status)
  try { localStorage.setItem(STATUS_KEY + userId, JSON.stringify(status)) } catch { /* Session only. */ }
  statusListeners.forEach((listener) => listener())
}

/** Primitive snapshot for React; an expired message is never displayed after a reload. */
export function loadOwnStatus(client: MatrixClient | null): string {
  if (!client) return ''
  const status = readStatus(client)
  return status && (status.expiresAt === null || status.expiresAt > Date.now()) ? status.message : ''
}

export function statusExpiryTime(expiry: StatusExpiry, now = Date.now()): number | null {
  if (expiry === 'never') return null
  if (expiry === 'today') {
    const midnight = new Date(now)
    midnight.setHours(24, 0, 0, 0)
    return midnight.getTime()
  }
  return now + ({ '30m': 30, '1h': 60, '4h': 240 }[expiry] * 60_000)
}

function sessionFor(client: MatrixClient): PresenceSession {
  let session = sessions.get(client)
  if (!session) {
    session = { stopped: false, queue: Promise.resolve() }
    sessions.set(client, session)
  }
  return session
}

function enqueue(client: MatrixClient, operation: () => Promise<void>): Promise<void> {
  const session = sessionFor(client)
  const result = session.queue.catch(() => {}).then(async () => {
    if (!session.stopped) await operation()
  })
  session.queue = result
  return result
}

/**
 * Presence shares Synapse's deliberately small rate limit with sync updates. Retry only an
 * active write, honoring the server deadline; nothing runs after disposal or while idle.
 */
async function publishPresence(client: MatrixClient, options: () => Parameters<MatrixClient['setPresence']>[0]): Promise<void> {
  const session = sessionFor(client)
  for (let attempt = 0; !session.stopped; attempt++) {
    try {
      await client.setPresence(options())
      return
    } catch (error) {
      if (session.stopped) return
      let delay: number | null = null
      if (error instanceof MatrixError && error.errcode === 'M_LIMIT_EXCEEDED') {
        try { delay = error.getRetryAfterMs() } catch { /* Malformed server retry deadline. */ }
      }
      if (attempt >= 2 || delay === null || !Number.isFinite(delay) || delay < 0 || delay > 60_000) throw error
      const shouldRetry = await new Promise<boolean>((resolve) => {
        const finish = (retry: boolean) => {
          if (session.retryTimer) clearTimeout(session.retryTimer)
          session.retryTimer = undefined
          session.cancelRetry = undefined
          resolve(retry)
        }
        session.cancelRetry = () => finish(false)
        session.retryTimer = setTimeout(() => finish(true), delay)
      })
      if (!shouldRetry) return
    }
  }
}

function scheduleExpiry(client: MatrixClient): void {
  const session = sessionFor(client)
  if (session.timer) clearTimeout(session.timer)
  session.timer = undefined
  const status = readStatus(client)
  if (session.stopped || !status?.message || status.expiresAt === null) return
  // One deadline, no polling or timer at all for an empty/permanent status.
  session.timer = setTimeout(() => {
    session.timer = undefined
    const current = readStatus(client)
    if (!current || current !== status || session.stopped) return
    rememberStatus(client, { message: '', expiresAt: null })
    void enqueue(client, async () => {
      await publishPresence(client, () => ({ presence: SYNC_PRESENCE[loadOwnPresence()], status_msg: loadOwnStatus(client) }))
    }).catch((error: unknown) => console.info('Could not clear expired status:', error))
  }, Math.max(0, status.expiresAt - Date.now()))
}

/** Restore before normal use, including clearing a status that expired while closed. */
export function applyStoredPresence(client: MatrixClient): Promise<void> {
  return enqueue(client, async () => {
    const presence = loadOwnPresence()
    const status = readStatus(client)
    if (status?.expiresAt !== null && status?.expiresAt !== undefined && status.expiresAt <= Date.now()) {
      rememberStatus(client, { message: '', expiresAt: null })
    }
    scheduleExpiry(client)
    if (presence === 'online' && !status) return
    await client.setSyncPresence(SYNC_PRESENCE[presence])
    await publishPresence(client, () => ({ presence: SYNC_PRESENCE[presence], ...(status ? { status_msg: loadOwnStatus(client) } : {}) }))
  })
}

export function setOwnPresence(client: MatrixClient, presence: OwnPresence): Promise<void> {
  return enqueue(client, async () => {
    await client.setSyncPresence(SYNC_PRESENCE[presence])
    try {
      await publishPresence(client, () => ({ presence: SYNC_PRESENCE[presence], ...(readStatus(client) ? { status_msg: loadOwnStatus(client) } : {}) }))
    } catch (error) {
      if (presence !== 'dnd' && !(loadOwnPresence() === 'dnd' && presence === 'online')) {
        await client.setSyncPresence(SYNC_PRESENCE[loadOwnPresence()])
        throw error
      }
      // Silencing this device also works on homeservers with presence disabled.
      console.info('Could not publish DND presence:', error)
    }
    if (sessionFor(client).stopped) return
    volatilePresence = presence
    try { localStorage.setItem(PRESENCE_KEY, presence) } catch { /* Session only. */ }
    listeners.forEach((listener) => listener())
  })
}

/** Emoji can be included in the plain text, interoperable Matrix status_msg. */
export function setOwnStatus(client: MatrixClient, message: string, expiry: StatusExpiry): Promise<void> {
  return enqueue(client, async () => {
    const trimmed = message.trim().slice(0, MAX_STATUS_LENGTH)
    await publishPresence(client, () => ({ presence: SYNC_PRESENCE[loadOwnPresence()], status_msg: trimmed }))
    if (sessionFor(client).stopped) return
    rememberStatus(client, { message: trimmed, expiresAt: trimmed ? statusExpiryTime(expiry) : null })
    scheduleExpiry(client)
  })
}

/** Stop account deadlines before disposing the client or switching sessions. */
export function stopOwnPresence(client: MatrixClient): void {
  const session = sessionFor(client)
  session.stopped = true
  if (session.timer) clearTimeout(session.timer)
  session.cancelRetry?.()
}

export function clearStoredPresence(): void {
  volatilePresence = undefined
  try { localStorage.removeItem(PRESENCE_KEY) } catch { /* Nothing stored. */ }
  listeners.forEach((listener) => listener())
}

export const MAX_DISPLAY_NAME_LENGTH = 256

const profileListeners = new Set<() => void>()

/** Called after the own profile was changed here; the SDK's user object may lag behind. */
export function subscribeOwnProfileChanges(listener: () => void): () => void {
  profileListeners.add(listener)
  return () => {
    profileListeners.delete(listener)
  }
}

export async function setOwnDisplayName(client: MatrixClient, name: string): Promise<void> {
  await client.setDisplayName(name.trim().slice(0, MAX_DISPLAY_NAME_LENGTH))
  profileListeners.forEach((listener) => listener())
}

/** Avatars are profile data, visible to everybody, and therefore never encrypted. */
export async function setOwnAvatar(client: MatrixClient, file: File | null): Promise<void> {
  if (file) {
    const { content_uri: url } = await client.uploadContent(file, { name: file.name, type: file.type })
    await client.setAvatarUrl(url)
  } else {
    await client.setAvatarUrl('')
  }
  profileListeners.forEach((listener) => listener())
}
