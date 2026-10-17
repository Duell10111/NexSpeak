/**
 * Matrix Client Initialization & Management
 * Browser-only (use client).
 * Handles SDK initialization, crypto setup and media URLs.
 */

'use client'

import { createClient, PendingEventOrdering } from 'matrix-js-sdk'
import { secretStorageCallbacks } from './secret-storage'
import type { MatrixClient } from 'matrix-js-sdk'

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
    cryptoCallbacks: secretStorageCallbacks,
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
