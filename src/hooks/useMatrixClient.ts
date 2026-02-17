/**
 * useMatrixClient Hook
 * Initializes and manages Matrix client lifecycle
 * Handles login, sync, and logout
 *
 * Usage:
 *   const { client, isReady, error, logout } = useMatrixClient(homeserver)
 */

'use client'

import { useEffect, useState, useCallback } from 'react'
import type { MatrixClient } from 'matrix-js-sdk'
import {
  createMatrixClient,
  getMatrixClient,
  disposeMatrixClient,
  subscribeSyncStatus,
} from '@/lib/matrix/client'
import { loadSession, saveSession, clearSession } from '@/lib/matrix/storage'
import type { MatrixSession, SyncStatus } from '@/lib/matrix/types'

export interface UseMatrixClientReturn {
  client: MatrixClient | null
  isReady: boolean
  isSyncing: boolean
  syncStatus: SyncStatus
  error: Error | null
  logout: () => Promise<void>
}

export function useMatrixClient(): UseMatrixClientReturn {
  const [client, setClient] = useState<MatrixClient | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('INITIAL')
  const [error, setError] = useState<Error | null>(null)

  // Initialize from persisted session
  useEffect(() => {
    if (typeof window === 'undefined') return

    const session = loadSession()
    if (!session) {
      setIsReady(false)
      return
    }

    try {
      const matrixClient = createMatrixClient({
        homeserverUrl: session.homeserverUrl,
        userId: session.userId,
        accessToken: session.accessToken,
        deviceId: session.deviceId,
      })

      setClient(matrixClient)

      // Subscribe to sync status
      const unsubscribeSyncStatus = subscribeSyncStatus(matrixClient, (status) => {
        if (status === 'SYNCING') {
          setSyncStatus('SYNCING')
          setIsSyncing(true)
        } else if (status === 'PREPARED') {
          setSyncStatus('SYNCED')
          setIsSyncing(false)
          setIsReady(true)
        } else if (status === 'STOPPED') {
          setSyncStatus('INITIAL')
          setIsSyncing(false)
        }
      })

      // Start sync
      matrixClient
        .startClient({ initialSyncLimit: 10 })
        .catch((err) => {
          console.error('Failed to start Matrix client:', err)
          setError(err)
          setSyncStatus('ERROR')
        })

      return () => {
        unsubscribeSyncStatus()
        // Don't stop client here - let it continue syncing
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      setError(error)
      setSyncStatus('ERROR')
    }
  }, [])

  // Logout handler
  const logout = useCallback(async () => {
    if (!client) return

    try {
      await client.logout()
    } catch (err) {
      console.warn('Error logging out from homeserver:', err)
      // Continue with local cleanup even if remote logout fails
    }

    disposeMatrixClient()
    clearSession()
    setClient(null)
    setIsReady(false)
    setSyncStatus('INITIAL')
    setError(null)
  }, [client])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Note: We don't dispose here to allow client to persist across page navigations
      // Only dispose on explicit logout
    }
  }, [])

  return {
    client,
    isReady,
    isSyncing,
    syncStatus,
    error,
    logout,
  }
}

