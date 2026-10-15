/**
 * Matrix error helpers: user-facing messages and homeserver discovery.
 */

import { AutoDiscovery, AutoDiscoveryAction, ConnectionError, MatrixError } from 'matrix-js-sdk'

export function describeMatrixError(error: unknown, fallback = 'Unbekannter Fehler'): string {
  if (error instanceof MatrixError) {
    switch (error.errcode) {
      case 'M_FORBIDDEN':
        return 'Benutzername oder Passwort ist falsch.'
      case 'M_USER_DEACTIVATED':
        return 'Dieses Konto wurde deaktiviert.'
      case 'M_LIMIT_EXCEEDED':
        return 'Zu viele Anfragen. Bitte warte kurz und versuche es erneut.'
      case 'M_UNKNOWN_TOKEN':
        return 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.'
      case 'M_TOO_LARGE':
        return 'Die Datei oder Nachricht ist zu groß.'
      default:
        return error.data?.error || error.message || fallback
    }
  }

  if (error instanceof ConnectionError || (error instanceof TypeError && /fetch/i.test(error.message))) {
    return 'Der Homeserver ist nicht erreichbar. Prüfe die Adresse und deine Verbindung.'
  }

  if (error instanceof Error && error.message) return error.message
  return fallback
}

/**
 * Turn user input ("matrix.org", "https://matrix.example.com", or the domain of a MXID)
 * into the client-server API base URL, honouring .well-known delegation.
 */
export async function resolveHomeserverUrl(input: string): Promise<string> {
  const trimmed = input.trim().replace(/\/+$/, '')
  if (!trimmed) throw new Error('Bitte gib einen Homeserver an.')

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new Error('Die Homeserver-Adresse ist ungültig.')
  }

  try {
    const config = await AutoDiscovery.findClientConfig(url.host)
    const homeserver = config['m.homeserver']
    if (homeserver.state === AutoDiscoveryAction.SUCCESS && homeserver.base_url) {
      return homeserver.base_url
    }
  } catch (error) {
    console.warn('Homeserver discovery failed, using the given URL directly:', error)
  }

  return url.origin + url.pathname.replace(/\/+$/, '')
}

/** Extract the server name from a full MXID like @alice:example.org. */
export function serverNameFromUserId(userId: string): string | null {
  const match = /^@[^:]+:(.+)$/.exec(userId.trim())
  return match ? match[1] : null
}
