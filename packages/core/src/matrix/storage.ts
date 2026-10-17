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
const listeners = new Set<() => void>()

// Cache the parsed session by its raw string so useSyncExternalStore gets a stable snapshot.
let cachedRaw: string | null = null
let cachedSession: MatrixSession | null = null

function isMatrixSession(value: unknown): value is MatrixSession {
  if (!value || typeof value !== 'object') return false
  const session = value as Record<string, unknown>
  return (
    typeof session.homeserverUrl === 'string' &&
    typeof session.userId === 'string' &&
    typeof session.accessToken === 'string' &&
    typeof session.deviceId === 'string' &&
    session.homeserverUrl.length > 0 &&
    session.accessToken.length > 0
  )
}

function notify(): void {
  listeners.forEach((listener) => listener())
}

/**
 * Save Matrix session to localStorage
 */
export function saveSession(session: MatrixSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch (error) {
    console.error('Failed to save Matrix session:', error)
  }
  notify()
}

/**
 * Load Matrix session from localStorage
 */
export function loadSession(): MatrixSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === cachedRaw) return cachedSession

    cachedRaw = raw
    const parsed: unknown = raw ? JSON.parse(raw) : null
    cachedSession = isMatrixSession(parsed) ? parsed : null
    return cachedSession
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
  notify()
}

/**
 * Subscribe to session changes in this tab and in other tabs (e.g. logout elsewhere).
 */
export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener)

  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) listener()
  }
  window.addEventListener('storage', onStorage)

  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}
