/**
 * Native OIDC login and registration (Matrix "next-generation auth", MSC3861; e.g. a homeserver
 * with the Matrix Authentication Service): authorization code flow with PKCE, a dynamically
 * registered public client, refresh tokens. Homeservers without it keep using password/SSO login.
 *
 * Web only for now: the redirect returns to <origin>/login. The desktop app logs in through the
 * SSO compatibility layer in the browser instead (see sso.ts), which OIDC homeservers offer too.
 */

import {
  completeAuthorizationCodeGrant,
  createClient,
  generateOidcAuthorizationUrl,
  OidcTokenRefresher,
  registerOidcClient,
  type AccessTokens,
  type OidcClientConfig,
} from 'matrix-js-sdk'
import { createUnauthenticatedMatrixClient } from './client'

/** The ID token's claims (oidc-client-ts type, not re-exported by the SDK). */
type IdTokenClaims = Awaited<ReturnType<typeof completeAuthorizationCodeGrant>>['idTokenClaims']

/** What a session needs to refresh its tokens and to revoke them on logout. */
export interface OidcSessionInfo {
  issuer: string
  clientId: string
  redirectUri: string
  refreshToken?: string
  idTokenClaims: IdTokenClaims
  /** Where people manage their account (password, sessions); offered in the settings. */
  accountManagementUrl?: string
}

export interface OidcLoginResult {
  homeserverUrl: string
  userId: string
  deviceId: string
  accessToken: string
  oidc: OidcSessionInfo
}

/** The homeserver's OIDC configuration, or null when it uses the classic login API. */
export async function fetchOidcConfig(homeserverUrl: string): Promise<OidcClientConfig | null> {
  try {
    return await createUnauthenticatedMatrixClient(homeserverUrl).getAuthMetadata()
  } catch {
    return null
  }
}

export function supportsRegistration(config: OidcClientConfig): boolean {
  return Boolean(config.prompt_values_supported?.includes('create'))
}

const CLIENT_IDS_KEY = 'nexspeak_oidc_clients'

function loadClientIds(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(CLIENT_IDS_KEY) || '{}') as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/** Shown on the consent screen when the app runs on a loopback address (development). */
const PROJECT_URL = 'https://github.com/Duell10111/NexSpeak'

function isLoopback(origin: string): boolean {
  const { protocol, hostname } = new URL(origin)
  return protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]')
}

/**
 * The registration metadata for this origin. Issuers like matrix.org's MAS reject http:// URIs for
 * web clients; on a loopback address (local development) the app registers like a native app
 * instead, which may redirect to http://localhost (RFC 8252), with the project as client URI.
 */
export function clientMetadataFor(origin: string, redirectUri: string): Parameters<typeof registerOidcClient>[1] {
  const loopback = isLoopback(origin)
  return {
    clientName: 'NexSpeak',
    clientUri: loopback ? PROJECT_URL : origin,
    logoUri: loopback ? undefined : `${origin}/icon-192.png`,
    applicationType: loopback ? 'native' : 'web',
    redirectUris: [redirectUri],
    contacts: undefined,
    tosUri: undefined,
    policyUri: undefined,
  }
}

/**
 * Our client id at this issuer. Registrations are per issuer and redirect URI and can be reused,
 * so register once and remember it.
 */
async function clientIdFor(config: OidcClientConfig, redirectUri: string, origin: string): Promise<string> {
  const key = `${config.issuer}|${redirectUri}`
  const known = loadClientIds()[key]
  if (known) return known
  const clientId = await registerOidcClient(config, clientMetadataFor(origin, redirectUri))
  try {
    localStorage.setItem(CLIENT_IDS_KEY, JSON.stringify({ ...loadClientIds(), [key]: clientId }))
  } catch {
    // Registering again next time works as well.
  }
  return clientId
}

/**
 * The URL to send the browser to. The SDK keeps the PKCE verifier and nonce in sessionStorage
 * until the redirect comes back.
 */
export async function startOidcLogin(options: {
  homeserverUrl: string
  config: OidcClientConfig
  /** The app's origin, e.g. https://nexspeak.example.org */
  origin: string
  register?: boolean
}): Promise<string> {
  const redirectUri = `${options.origin}/login`
  const clientId = await clientIdFor(options.config, redirectUri, options.origin)
  return generateOidcAuthorizationUrl({
    metadata: options.config,
    clientId,
    homeserverUrl: options.homeserverUrl,
    redirectUri,
    nonce: crypto.randomUUID(),
    prompt: options.register ? 'create' : undefined,
  })
}

/** Back from the issuer with ?code=…&state=…: exchange the code for tokens. */
export async function completeOidcLogin(code: string, state: string, origin: string): Promise<OidcLoginResult> {
  const { tokenResponse, homeserverUrl, idTokenClaims, oidcClientSettings } = await completeAuthorizationCodeGrant(code, state)
  const config = await fetchOidcConfig(homeserverUrl)
  // The device id was part of the requested scope; whoami confirms it with the user id.
  const { user_id: userId, device_id: deviceId } = await createClient({
    baseUrl: homeserverUrl,
    accessToken: tokenResponse.access_token,
  }).whoami()
  if (!deviceId) throw new Error('The homeserver did not return a device id for the OIDC session.')
  return {
    homeserverUrl,
    userId,
    deviceId,
    accessToken: tokenResponse.access_token,
    oidc: {
      issuer: oidcClientSettings.issuer,
      clientId: oidcClientSettings.clientId,
      redirectUri: `${origin}/login`,
      refreshToken: tokenResponse.refresh_token,
      idTokenClaims,
      accountManagementUrl: config?.account_management_uri,
    },
  }
}

/**
 * The SDK calls this when the access token expired; `persist` stores the new tokens, so a reload
 * keeps the session.
 */
export function createTokenRefresher(
  oidc: OidcSessionInfo,
  deviceId: string,
  persist: (tokens: AccessTokens) => void,
): (refreshToken: string) => Promise<AccessTokens> {
  class PersistingRefresher extends OidcTokenRefresher {
    protected async persistTokens(tokens: { accessToken: string; refreshToken?: string }): Promise<void> {
      persist(tokens)
    }
  }
  const refresher = new PersistingRefresher(oidc.issuer, oidc.clientId, oidc.redirectUri, deviceId, oidc.idTokenClaims)
  return (refreshToken) => refresher.doRefreshAccessToken(refreshToken)
}

/** Logout: revoke both tokens at the issuer (the C-S /logout doesn't apply to OIDC sessions). */
export async function revokeOidcTokens(oidc: OidcSessionInfo, accessToken: string, refreshToken?: string): Promise<void> {
  const config = await fetchOidcConfigByIssuer(oidc.issuer)
  const endpoint = config?.revocation_endpoint
  if (!endpoint) return
  const revoke = (token: string, hint: string) =>
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, token_type_hint: hint, client_id: oidc.clientId }),
    })
  await Promise.all([
    revoke(accessToken, 'access_token'),
    ...(refreshToken ? [revoke(refreshToken, 'refresh_token')] : []),
  ])
}

async function fetchOidcConfigByIssuer(issuer: string): Promise<{ revocation_endpoint?: string } | null> {
  try {
    const response = await fetch(new URL('.well-known/openid-configuration', issuer.endsWith('/') ? issuer : `${issuer}/`))
    return response.ok ? ((await response.json()) as { revocation_endpoint?: string }) : null
  } catch {
    return null
  }
}

/** Query parameters of the issuer's redirect back to /login, if this is one. */
export function readOidcCallback(search: string): { code: string; state: string } | { error: string } | null {
  const params = new URLSearchParams(search)
  const state = params.get('state')
  if (!state) return null
  const error = params.get('error')
  if (error) return { error: params.get('error_description') || error }
  const code = params.get('code')
  return code ? { code, state } : null
}
