/**
 * Matrix Context
 * Owns the session, the single MatrixClient instance and its sync lifecycle.
 * All components read the client from here instead of starting their own.
 */

'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { ClientEvent, HttpApiEvent, SyncState, type MatrixClient } from 'matrix-js-sdk'
import { toast } from 'sonner'
import {
  clearSession,
  loadSession,
  saveSession,
  subscribeSession,
  type MatrixSession,
} from '@/lib/matrix/storage'
import {
  createMatrixClient,
  createUnauthenticatedMatrixClient,
  disposeMatrixClient,
  getMatrixClient,
  startMatrixClient,
} from '@/lib/matrix/client'
import { describeLoginError, resolveHomeserverUrl, serverNameFromUserId } from '@/lib/matrix/errors'
import { t } from '@/lib/i18n'

interface MatrixContextType {
  /** undefined until the session has been read from storage on the client. */
  session: MatrixSession | null | undefined
  client: MatrixClient | null
  syncState: SyncState | null
  isCryptoReady: boolean
  startError: Error | null

  isLoggingIn: boolean
  loginError: string | null
  login: (homeserver: string, username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const MatrixContext = createContext<MatrixContextType | undefined>(undefined)

async function teardownClient(client: MatrixClient | null): Promise<void> {
  if (!client) return
  try {
    client.stopClient()
    await client.clearStores()
  } catch (error) {
    console.warn('Failed to clear Matrix stores:', error)
  }
  disposeMatrixClient()
}

export function MatrixAuthProvider({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(subscribeSession, loadSession, () => undefined)
  const sessionKey = session ? `${session.userId}|${session.accessToken}` : ''

  // The client is derived from the session; createMatrixClient is idempotent per session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const client = useMemo(() => (session ? createMatrixClient(session) : null), [sessionKey])

  const [cryptoState, setCryptoState] = useState<{ client: MatrixClient | null; ready: boolean }>({
    client: null,
    ready: false,
  })
  const [startError, setStartError] = useState<Error | null>(null)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)

  const subscribeSync = useCallback(
    (onChange: () => void) => {
      if (!client) return () => {}
      client.on(ClientEvent.Sync, onChange)
      return () => {
        client.removeListener(ClientEvent.Sync, onChange)
      }
    },
    [client],
  )
  const syncState = useSyncExternalStore(subscribeSync, () => client?.getSyncState() ?? null, () => null)

  // Start syncing once per client.
  useEffect(() => {
    if (!client) return
    let cancelled = false

    startMatrixClient(client)
      .then((ready) => {
        if (cancelled) return
        setCryptoState({ client, ready })
        setStartError(null)
      })
      .catch((error: unknown) => {
        console.error('Failed to start Matrix client:', error)
        if (!cancelled) setStartError(error instanceof Error ? error : new Error(String(error)))
      })

    return () => {
      cancelled = true
    }
  }, [client])

  // The homeserver revoked our token (logged out elsewhere, password changed, ...).
  useEffect(() => {
    if (!client) return

    const onLoggedOut = () => {
      toast.error(t('error.sessionExpired'))
      void teardownClient(client).finally(clearSession)
    }

    client.on(HttpApiEvent.SessionLoggedOut, onLoggedOut)
    return () => {
      client.removeListener(HttpApiEvent.SessionLoggedOut, onLoggedOut)
    }
  }, [client])

  const login = useCallback(async (homeserver: string, username: string, password: string) => {
    setIsLoggingIn(true)
    setLoginError(null)

    try {
      const trimmedUser = username.trim()
      const serverFromUser = serverNameFromUserId(trimmedUser)
      const homeserverUrl = await resolveHomeserverUrl(homeserver.trim() || serverFromUser || '')

      const response = await createUnauthenticatedMatrixClient(homeserverUrl).loginRequest({
        type: 'm.login.password',
        identifier: { type: 'm.id.user', user: trimmedUser },
        password,
        initial_device_display_name: 'NexSpeak Web',
      })

      if (!response.access_token || !response.user_id || !response.device_id) {
        throw new Error(t('login.invalidResponse'))
      }

      // Drop any leftover client (and its crypto store) from a previous account.
      await teardownClient(getMatrixClient())

      saveSession({
        homeserverUrl: response.well_known?.['m.homeserver']?.base_url?.replace(/\/+$/, '') || homeserverUrl,
        userId: response.user_id,
        accessToken: response.access_token,
        deviceId: response.device_id,
      })
    } catch (error) {
      const message = describeLoginError(error)
      setLoginError(message)
      throw error
    } finally {
      setIsLoggingIn(false)
    }
  }, [])

  const logout = useCallback(async () => {
    const current = getMatrixClient()
    if (current) {
      try {
        await current.logout(true)
      } catch (error) {
        // Continue with local cleanup even if the server request fails.
        console.warn('Error logging out from homeserver:', error)
      }
    }
    await teardownClient(current)
    clearSession()
  }, [])

  const value: MatrixContextType = {
    session,
    client,
    syncState,
    isCryptoReady: cryptoState.client === client && cryptoState.ready,
    startError,
    isLoggingIn,
    loginError,
    login,
    logout,
  }

  return <MatrixContext.Provider value={value}>{children}</MatrixContext.Provider>
}

export function useMatrix(): MatrixContextType {
  const context = useContext(MatrixContext)
  if (context === undefined) {
    throw new Error('useMatrix must be used within MatrixAuthProvider')
  }
  return context
}
