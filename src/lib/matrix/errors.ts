/**
 * Matrix error helpers: user-facing messages and homeserver discovery.
 */

import { AutoDiscovery, AutoDiscoveryAction, ConnectionError, MatrixError } from 'matrix-js-sdk'
import { t } from '@/lib/i18n'

export function describeMatrixError(error: unknown, fallback = t('error.unknown')): string {
  if (error instanceof MatrixError) {
    switch (error.errcode) {
      case 'M_FORBIDDEN':
        return t('error.notAllowed')
      case 'M_USER_DEACTIVATED':
        return t('error.userDeactivated')
      case 'M_LIMIT_EXCEEDED':
        return t('error.rateLimited')
      case 'M_UNKNOWN_TOKEN':
        return t('error.sessionExpired')
      case 'M_TOO_LARGE':
        return t('error.tooLarge')
      default:
        return error.data?.error || error.message || fallback
    }
  }

  if (error instanceof ConnectionError || (error instanceof TypeError && /fetch/i.test(error.message))) {
    return t('error.unreachable')
  }

  if (error instanceof Error && error.message) return error.message
  return fallback
}

/** Like describeMatrixError, but M_FORBIDDEN means wrong credentials when logging in. */
export function describeLoginError(error: unknown): string {
  if (error instanceof MatrixError && error.errcode === 'M_FORBIDDEN') return t('error.forbidden')
  return describeMatrixError(error, t('login.failed'))
}

/**
 * Turn user input ("matrix.org", "https://matrix.example.com", or the domain of a MXID)
 * into the client-server API base URL, honouring .well-known delegation.
 */
export async function resolveHomeserverUrl(input: string): Promise<string> {
  const trimmed = input.trim().replace(/\/+$/, '')
  if (!trimmed) throw new Error(t('error.homeserverMissing'))

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new Error(t('error.homeserverInvalid'))
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
