/**
 * Matrix Client Initialization & Management
 * Browser-only (use client).
 * Handles SDK initialization, event subscription, and lifecycle.
 */

'use client'

import { createClient } from 'matrix-js-sdk'
import { GroupCallIntent, GroupCallType } from 'matrix-js-sdk'
import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk'

export interface MatrixClientConfig {
  homeserverUrl: string
  userId: string
  accessToken: string
  deviceId: string
}

let matrixClientInstance: MatrixClient | null = null

interface CryptoCapableMatrixClient {
  getCrypto?: () => unknown
  initRustCrypto?: () => Promise<void>
  initCrypto?: () => Promise<void>
}

const groupCallStartInFlight = new Map<string, Promise<void>>()

interface GroupCallLike {
  state?: string
  enter: () => Promise<void>
  initLocalCallFeed?: () => Promise<void>
  cleanMemberState?: () => Promise<void>
  participants?: Map<unknown, Map<string, unknown>>
}

async function refreshParticipantKeysForGroupCall(
  client: MatrixClient,
  groupCall: GroupCallLike,
): Promise<void> {
  if (!groupCall.participants || groupCall.participants.size === 0) return

  const userIds = new Set<string>()
  groupCall.participants.forEach((_, member) => {
    if (!member || typeof member !== 'object') return
    const userId = (member as { userId?: string }).userId
    if (userId) {
      userIds.add(userId)
    }
  })

  if (userIds.size === 0) return

  const keyClient = client as unknown as {
    downloadKeys?: (userIds: string[], forceDownload?: boolean) => Promise<unknown>
  }

  if (!keyClient.downloadKeys) return

  try {
    await keyClient.downloadKeys(Array.from(userIds), true)
  } catch (error) {
    console.warn('Failed to refresh participant keys before group call enter:', error)
  }
}

async function waitForGroupCallState(
  groupCall: GroupCallLike,
  allowedStates: string[],
  timeoutMs: number = 6000,
): Promise<void> {
  const startedAt = Date.now()

  while (!allowedStates.includes(groupCall.state || '')) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for group call state. Current state: ${groupCall.state || 'unknown'}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

export function createUnauthenticatedMatrixClient(homeserverUrl: string): MatrixClient {
  if (typeof window === 'undefined') {
    throw new Error('Matrix client can only be created in browser context')
  }

  return createClient({
    baseUrl: homeserverUrl,
  })
}

export function createMatrixClient(config: MatrixClientConfig): MatrixClient {
  if (typeof window === 'undefined') {
    throw new Error('Matrix client can only be created in browser context')
  }

  if (matrixClientInstance) {
    return matrixClientInstance
  }

  matrixClientInstance = createClient({
    baseUrl: config.homeserverUrl,
    userId: config.userId,
    accessToken: config.accessToken,
    deviceId: config.deviceId,
    // Avoid device-to-device call signalling issues for mixed clients/sessions.
    useE2eForGroupCall: false,
  })

  return matrixClientInstance
}

export function getMatrixClient(): MatrixClient | null {
  return matrixClientInstance
}

export async function initMatrixCrypto(client: MatrixClient): Promise<void> {
  if (typeof window === 'undefined') return

  const cryptoClient = client as unknown as CryptoCapableMatrixClient
  if (cryptoClient.getCrypto?.()) {
    return
  }

  if (cryptoClient.initRustCrypto) {
    try {
      await cryptoClient.initRustCrypto()
      return
    } catch (error) {
      console.warn('Rust crypto init failed, trying legacy crypto init:', error)
    }
  }

  if (cryptoClient.initCrypto) {
    await cryptoClient.initCrypto()
  }
}

export function disposeMatrixClient(): void {
  if (matrixClientInstance) {
    try {
      matrixClientInstance.stopClient()
      matrixClientInstance.removeAllListeners()
    } catch (error) {
      console.error('Error disposing Matrix client:', error)
    }
    matrixClientInstance = null
  }
}

export function subscribeToRoomTimeline(
  client: MatrixClient,
  roomId: string,
  callback: (event: MatrixEvent) => void,
): () => void {
  const emitter = client as unknown as {
    on: (event: string, listener: (...args: unknown[]) => void) => void
    removeListener: (event: string, listener: (...args: unknown[]) => void) => void
  }

  const handler = (...args: unknown[]) => {
    const [event, eventRoom] = args
    if (!event || typeof event !== 'object' || !('getType' in event)) return
    if (!eventRoom || typeof eventRoom !== 'object' || !('roomId' in eventRoom)) return

    const matrixRoom = eventRoom as { roomId: string }
    if (matrixRoom.roomId !== roomId) return

    callback(event as MatrixEvent)
  }

  emitter.on('Room.timeline', handler)

  return () => {
    emitter.removeListener('Room.timeline', handler)
  }
}

export function subscribeSyncStatus(
  client: MatrixClient,
  callback: (status: 'PREPARED' | 'SYNCING' | 'STOPPED') => void,
): () => void {
  const emitter = client as unknown as {
    on: (event: string, listener: (...args: unknown[]) => void) => void
    removeListener: (event: string, listener: (...args: unknown[]) => void) => void
  }

  const handlers = {
    sync: () => callback('SYNCING'),
    prepared: () => callback('PREPARED'),
  }

  emitter.on('sync', handlers.sync)
  emitter.on('prepared', handlers.prepared)
  emitter.on('Client.sync', handlers.sync)

  return () => {
    emitter.removeListener('sync', handlers.sync)
    emitter.removeListener('prepared', handlers.prepared)
    emitter.removeListener('Client.sync', handlers.sync)
  }
}

export function getDisplayName(
  client: MatrixClient,
  userId: string,
): string {
  const user = client.getUser(userId)
  return user?.displayName || userId
}

export function getAvatarUrl(
  client: MatrixClient,
  userId: string,
  size: number = 32,
): string | null {
  const user = client.getUser(userId)
  if (!user?.avatarUrl) return null

  const mxcUrl = user.avatarUrl
  const [serverName, mediaId] = mxcUrl.replace('mxc://', '').split('/')

  return `${client.getHomeserverUrl()}/_matrix/media/r0/thumbnail/${serverName}/${mediaId}?width=${size}&height=${size}&method=crop`
}

export async function startOrJoinVoiceGroupCall(
  client: MatrixClient,
  roomId: string,
): Promise<void> {
  const existingStart = groupCallStartInFlight.get(roomId)
  if (existingStart) {
    await existingStart
    return
  }

  const startPromise = (async () => {
  const voipClient = client as unknown as {
    supportsVoip?: () => boolean
    waitUntilRoomReadyForGroupCalls?: (id: string) => Promise<void>
    getGroupCallForRoom?: (id: string) => unknown | null
    createGroupCall?: (
      id: string,
      type: GroupCallType,
      isPtt: boolean,
      intent: GroupCallIntent,
    ) => Promise<unknown>
  }

  if (voipClient.supportsVoip && !voipClient.supportsVoip()) {
    throw new Error('VoIP is not supported in this browser')
  }

  if (voipClient.waitUntilRoomReadyForGroupCalls) {
    await voipClient.waitUntilRoomReadyForGroupCalls(roomId)
  }

  let groupCall = voipClient.getGroupCallForRoom?.(roomId) as
    | { enter: () => Promise<void> }
    | null
    | undefined

  if (!groupCall) {
    if (!voipClient.createGroupCall) {
      throw new Error('Group calls are not available on this client')
    }

    groupCall = (await voipClient.createGroupCall(
      roomId,
      GroupCallType.Voice,
      false,
      GroupCallIntent.Room,
    )) as { enter: () => Promise<void> }
  }

    const enterableGroupCall = groupCall as GroupCallLike

    if (enterableGroupCall.state === 'local_call_feed_uninitialized' && enterableGroupCall.initLocalCallFeed) {
      await enterableGroupCall.initLocalCallFeed()
    }

    if (enterableGroupCall.state === 'initializing_local_call_feed') {
      await waitForGroupCallState(enterableGroupCall, ['local_call_feed_initialized', 'entered'])
    }

    // Clean stale device entries before placing outgoing calls.
    // This helps when remote users changed devices/sessions and room member call state is outdated.
    if (enterableGroupCall.cleanMemberState) {
      try {
        await enterableGroupCall.cleanMemberState()
      } catch (error) {
        console.warn('Failed to clean group call member state before enter:', error)
      }
    }

    await refreshParticipantKeysForGroupCall(client, enterableGroupCall)

    if (enterableGroupCall.state !== 'entered') {
      try {
        await enterableGroupCall.enter()
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('initializing_local_call_feed')
        ) {
          await waitForGroupCallState(enterableGroupCall, ['local_call_feed_initialized', 'entered'])
          if (enterableGroupCall.state !== 'entered') {
            await enterableGroupCall.enter()
          }
        } else if (error instanceof Error && error.message.includes('No device found')) {
          if (enterableGroupCall.cleanMemberState) {
            try {
              await enterableGroupCall.cleanMemberState()
            } catch (cleanupError) {
              console.warn('Failed to clean member state after No device found:', cleanupError)
            }
          }

          await refreshParticipantKeysForGroupCall(client, enterableGroupCall)
          await new Promise((resolve) => setTimeout(resolve, 300))

          if (enterableGroupCall.state !== 'entered') {
            await enterableGroupCall.enter()
          }
        } else {
          throw error
        }
      }
    }
  })()

  groupCallStartInFlight.set(roomId, startPromise)

  try {
    await startPromise
  } finally {
    groupCallStartInFlight.delete(roomId)
  }
}

