/**
 * Matrix Client Initialization & Management
 * Browser-only (use client).
 * Handles SDK initialization, event subscription, and lifecycle.
 */

'use client'

import { createClient } from 'matrix-js-sdk'
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

