/**
 * Matrix Client Initialization & Management
 * Browser-only (use client).
 * Handles SDK initialization, media URLs, and group call setup.
 */

'use client'

import { createClient, GroupCallIntent, GroupCallType, PendingEventOrdering } from 'matrix-js-sdk'
import type { MatrixClient } from 'matrix-js-sdk'

export interface MatrixClientConfig {
  homeserverUrl: string
  userId: string
  accessToken: string
  deviceId: string
}

let matrixClientInstance: MatrixClient | null = null

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

  // Reuse the instance only if it belongs to the same session; otherwise a stale client
  // from a previous login would keep running with the old token.
  if (matrixClientInstance) {
    if (
      matrixClientInstance.getUserId() === config.userId &&
      matrixClientInstance.getAccessToken() === config.accessToken
    ) {
      return matrixClientInstance
    }
    disposeMatrixClient()
  }

  matrixClientInstance = createClient({
    baseUrl: config.homeserverUrl,
    userId: config.userId,
    accessToken: config.accessToken,
    deviceId: config.deviceId,
    timelineSupport: true,
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
  if (client.getCrypto()) return

  try {
    await client.initRustCrypto()
  } catch (error) {
    // The local crypto store still belongs to a previous login (other user or device).
    // It is useless for this session, so wipe it and start fresh.
    const message = error instanceof Error ? error.message : String(error)
    if (!/does(n't| not) match/i.test(message)) throw error

    console.warn('Crypto store belongs to another session, clearing it:', message)
    await client.clearStores()
    await client.initRustCrypto()
  }
}

const startPromises = new WeakMap<MatrixClient, Promise<boolean>>()

/**
 * Initialise crypto and start syncing exactly once per client instance.
 * Resolves to whether end-to-end encryption is available.
 */
export function startMatrixClient(client: MatrixClient): Promise<boolean> {
  const existing = startPromises.get(client)
  if (existing) return existing

  const startPromise = (async () => {
    let isCryptoReady = false
    try {
      await initMatrixCrypto(client)
      isCryptoReady = true
    } catch (error) {
      console.error('Matrix crypto initialization failed:', error)
    }

    await client.startClient({
      initialSyncLimit: 20,
      lazyLoadMembers: true,
      // Keep local echoes in a separate list so failed sends can be retried or discarded.
      pendingEventOrdering: PendingEventOrdering.Detached,
    })
    return isCryptoReady
  })()

  startPromises.set(client, startPromise)
  startPromise.catch(() => startPromises.delete(client))
  return startPromise
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

/**
 * Resolve an mxc:// URI to an authenticated (v1) media URL.
 * The URL must be fetched with an Authorization header, see useMediaUrl.
 */
export function getMediaUrl(
  client: MatrixClient,
  mxcUrl: string | null | undefined,
  size?: number,
): string | null {
  if (!mxcUrl?.startsWith('mxc://')) return null
  return client.mxcUrlToHttp(mxcUrl, size, size, size ? 'crop' : undefined, false, true, true)
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

