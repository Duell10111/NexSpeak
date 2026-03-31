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
    initialSyncLimit: 10,
    lazyLoadMembers: true,
  })

  return matrixClientInstance
}

export function getMatrixClient(): MatrixClient | null {
  return matrixClientInstance
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

  const handler = (event: MatrixEvent) => {
    callback(event)
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
  const handlers = {
    sync: () => callback('SYNCING'),
    prepared: () => callback('PREPARED'),
    stopped: () => callback('STOPPED'),
  }

  client.on('sync', handlers.sync)
  client.on('prepared', handlers.prepared)
  client.on('Client.sync', handlers.sync)

  return () => {
    client.removeListener('sync', handlers.sync)
    client.removeListener('prepared', handlers.prepared)
    client.removeListener('Client.sync', handlers.sync)
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

