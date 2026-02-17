/**
 * Matrix Session Storage
 * Handles persistence of Matrix session data in localStorage
 * Security: Tokens are stored clientside only, never sent to servers
 */

export interface MatrixSession {
  homeserverUrl: string
  userId: string
  accessToken: string
  deviceId: string
}

const STORAGE_KEY = 'nexspeak_matrix_session'

/**
 * Save Matrix session to localStorage
 */
export function saveSession(session: MatrixSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch (error) {
    console.error('Failed to save Matrix session:', error)
  }
}

/**
 * Load Matrix session from localStorage
 */
export function loadSession(): MatrixSession | null {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    return data ? JSON.parse(data) : null
  } catch (error) {
    console.error('Failed to load Matrix session:', error)
    return null
  }
}

/**
 * Clear Matrix session from localStorage
 */
export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch (error) {
    console.error('Failed to clear Matrix session:', error)
  }
}

/**
 * Check if valid session exists
 */
export function hasValidSession(): boolean {
  const session = loadSession()
  return !!(
    session?.homeserverUrl &&
    session?.userId &&
    session?.accessToken &&
    session?.deviceId
  )
}

