/**
 * Login options of a homeserver and the SSO round trip (m.login.sso → m.login.token). Homeservers
 * on the new OIDC auth (MAS, e.g. matrix.org) offer the same flow through their compatibility layer.
 */

import type { ValidatedAuthMetadata } from 'matrix-js-sdk'
import { createUnauthenticatedMatrixClient } from './client'
import { fetchOidcConfig } from './oidc'

export interface IdentityProvider {
  id: string
  name: string
}

export interface LoginOptions {
  password: boolean
  /** Present when the homeserver offers SSO; empty list = one generic "SSO" button. */
  sso: IdentityProvider[] | null
  /** Native OIDC (next-gen auth): preferred over the SSO compatibility flow where possible. */
  oidc: ValidatedAuthMetadata | null
}

interface SsoFlow {
  type: string
  identity_providers?: Array<{ id?: unknown; name?: unknown }>
}

export async function fetchLoginOptions(homeserverUrl: string): Promise<LoginOptions> {
  const [{ flows }, oidc] = await Promise.all([
    createUnauthenticatedMatrixClient(homeserverUrl).loginFlows(),
    fetchOidcConfig(homeserverUrl),
  ])
  const ssoFlow = flows.find((flow) => flow.type === 'm.login.sso' || flow.type === 'm.login.cas') as SsoFlow | undefined
  return {
    password: flows.some((flow) => flow.type === 'm.login.password'),
    sso: ssoFlow
      ? (ssoFlow.identity_providers ?? [])
          .filter((provider) => typeof provider.id === 'string' && typeof provider.name === 'string')
          .map((provider) => ({ id: provider.id as string, name: provider.name as string }))
      : null,
    oidc,
  }
}

/** Where the browser goes to log in; the homeserver sends it back to `redirectUrl?loginToken=…`. */
export function ssoLoginUrl(homeserverUrl: string, redirectUrl: string, identityProviderId?: string): string {
  return createUnauthenticatedMatrixClient(homeserverUrl).getSsoLoginUrl(redirectUrl, 'sso', identityProviderId)
}

const PENDING_KEY = 'nexspeak_sso_pending'
/** A login token is only valid for a few minutes anyway. */
const PENDING_MAX_AGE_MS = 15 * 60_000

/** Remembers the homeserver while the user logs in elsewhere (the token alone doesn't name it). */
export function rememberSsoHomeserver(homeserverUrl: string): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ homeserverUrl, startedAt: Date.now() }))
  } catch {
    // Without storage the return falls back to asking for the homeserver again.
  }
}

export function takeSsoHomeserver(): string | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    localStorage.removeItem(PENDING_KEY)
    const pending = raw ? (JSON.parse(raw) as { homeserverUrl?: unknown; startedAt?: unknown }) : null
    if (typeof pending?.homeserverUrl !== 'string' || typeof pending.startedAt !== 'number') return null
    return Date.now() - pending.startedAt < PENDING_MAX_AGE_MS ? pending.homeserverUrl : null
  } catch {
    return null
  }
}
