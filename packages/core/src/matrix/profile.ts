/**
 * The own profile (display name, avatar) and presence. Presence is sent with every sync
 * (`set_presence`), so the chosen value is remembered per device and applied before syncing;
 * otherwise the next sync would reset it to "online".
 */

import { SetPresence, type MatrixClient } from 'matrix-js-sdk'

export type OwnPresence = 'online' | 'unavailable' | 'offline'

export const OWN_PRESENCE_OPTIONS: readonly OwnPresence[] = ['online', 'unavailable', 'offline']

const PRESENCE_KEY = 'nexspeak_presence'
const listeners = new Set<() => void>()

function isOwnPresence(value: unknown): value is OwnPresence {
  return value === 'online' || value === 'unavailable' || value === 'offline'
}

export function loadOwnPresence(): OwnPresence {
  try {
    const stored = localStorage.getItem(PRESENCE_KEY)
    return isOwnPresence(stored) ? stored : 'online'
  } catch {
    return 'online'
  }
}

export function subscribeOwnPresence(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const SYNC_PRESENCE: Record<OwnPresence, SetPresence> = {
  online: SetPresence.Online,
  unavailable: SetPresence.Unavailable,
  offline: SetPresence.Offline,
}

/**
 * Applies the remembered presence; call right after startClient (the sync loop only exists
 * then). The first sync request may already have said "online", so set it explicitly as well.
 */
export async function applyStoredPresence(client: MatrixClient): Promise<void> {
  const presence = loadOwnPresence()
  if (presence === 'online') return
  await client.setSyncPresence(SYNC_PRESENCE[presence])
  await client.setPresence({ presence })
}

export async function setOwnPresence(client: MatrixClient, presence: OwnPresence): Promise<void> {
  // Sync first, so a sync running meanwhile doesn't flip it back.
  await client.setSyncPresence(SYNC_PRESENCE[presence])
  await client.setPresence({ presence })
  try {
    localStorage.setItem(PRESENCE_KEY, presence)
  } catch {
    // Without storage the choice lasts until the app reloads.
  }
  listeners.forEach((listener) => listener())
}

export function clearStoredPresence(): void {
  try {
    localStorage.removeItem(PRESENCE_KEY)
  } catch {
    // Nothing stored.
  }
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
