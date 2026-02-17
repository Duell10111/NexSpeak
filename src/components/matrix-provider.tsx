/**
 * Matrix Auth Context
 * Manages Matrix login/logout state and session persistence
 */

'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { createClient } from 'matrix-js-sdk'
import { saveSession, clearSession, type MatrixSession } from '@/lib/matrix/storage'
import { createMatrixClient as initializeMatrixClient } from '@/lib/matrix/client'

interface MatrixAuthContextType {
  // Auth state
  isAuthenticated: boolean
  isLoading: boolean
  error: Error | null

  // Login/logout
  login: (homeserverUrl: string, username: string, password: string) => Promise<void>
  logout: () => Promise<void>

  // Current session
  session: MatrixSession | null
}

const MatrixAuthContext = createContext<MatrixAuthContextType | undefined>(undefined)

export function MatrixAuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [session, setSession] = useState<MatrixSession | null>(null)

  const login = useCallback(
    async (homeserverUrl: string, username: string, password: string) => {
      setIsLoading(true)
      setError(null)

      try {
        // Create temporary client for authentication
        const tempClient = createClient({
          baseUrl: homeserverUrl,
        })

        // Perform login
        const loginResponse = await tempClient.loginWithPassword(username, password)

        if (!loginResponse.access_token || !loginResponse.user_id || !loginResponse.device_id) {
          const err = new Error('Invalid login response: missing required fields')
          setError(err)
          throw err
        }

        // Save session
        const newSession: MatrixSession = {
          homeserverUrl,
          userId: loginResponse.user_id,
          accessToken: loginResponse.access_token,
          deviceId: loginResponse.device_id,
        }

        saveSession(newSession)

        // Initialize authenticated client
        initializeMatrixClient({
          homeserverUrl,
          userId: loginResponse.user_id,
          accessToken: loginResponse.access_token,
          deviceId: loginResponse.device_id,
        })

        setSession(newSession)
        setIsAuthenticated(true)
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        console.error('Login failed:', error)
        setError(error)
        setIsAuthenticated(false)
        throw error
      } finally {
        setIsLoading(false)
      }
    },
    [],
  )

  const logout = useCallback(async () => {
    setIsLoading(true)

    try {
      // If we had a client, try to notify the server
      // (This would be handled by useMatrixClient hook)
      clearSession()
      setSession(null)
      setIsAuthenticated(false)
      setError(null)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      console.error('Logout error:', error)
      // Continue with local logout even if server request fails
      clearSession()
      setSession(null)
      setIsAuthenticated(false)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const value: MatrixAuthContextType = {
    isAuthenticated,
    isLoading,
    error,
    login,
    logout,
    session,
  }

  return (
    <MatrixAuthContext.Provider value={value}>{children}</MatrixAuthContext.Provider>
  )
}

/**
 * Hook to use Matrix auth context
 */
export function useMatrixAuth() {
  const context = useContext(MatrixAuthContext)
  if (context === undefined) {
    throw new Error('useMatrixAuth must be used within MatrixAuthProvider')
  }
  return context
}


