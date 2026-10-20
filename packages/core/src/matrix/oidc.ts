/**
 * Native OIDC login and registration (Matrix "next-generation auth", MSC3861; e.g. a homeserver
 * with the Matrix Authentication Service): authorization code flow with PKCE, a dynamically
 * registered public client, refresh tokens. Homeservers without it keep using password/SSO login.
 *
 * Web only for now: the redirect returns to <origin>/login. The desktop app logs in through the
 * SSO compatibility layer in the browser instead (see sso.ts), which OIDC homeservers offer too.
 */

import { createClient, OAuth2, type ValidatedAuthMetadata } from 'matrix-js-sdk'
import { createUnauthenticatedMatrixClient } from './client'

/** Persistent metadata for sessions authenticated through Matrix's delegated OAuth flow. */
export interface OidcSessionInfo {
  issuer: string
  clientId: string
  redirectUri: string
  refreshToken?: string
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
export async function fetchOidcConfig(homeserverUrl: string): Promise<ValidatedAuthMetadata | null> {
  try {
    return await createUnauthenticatedMatrixClient(homeserverUrl).getAuthMetadata()
  } catch {
    return null
  }
}

export function supportsRegistration(config: ValidatedAuthMetadata): boolean {
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
export function clientMetadataFor(origin: string, redirectUri: string): Parameters<typeof OAuth2.registerClient>[1] {
  const loopback = isLoopback(origin)
  return {
    client_name: 'NexSpeak',
    client_uri: loopback ? PROJECT_URL : origin,
    logo_uri: loopback ? undefined : `${origin}/icon-192.png`,
    application_type: loopback ? 'native' : 'web',
    redirect_uris: [redirectUri],
  }
}

/**
 * Our client id at this issuer. Registrations are per issuer and redirect URI and can be reused,
 * so register once and remember it.
 */
async function clientIdFor(config: ValidatedAuthMetadata, redirectUri: string, origin: string): Promise<string> {
  const key = `${config.issuer}|${redirectUri}`
  const known = loadClientIds()[key]
  if (known) return known
  const clientId = await OAuth2.registerClient(config, clientMetadataFor(origin, redirectUri))
  try {
    localStorage.setItem(CLIENT_IDS_KEY, JSON.stringify({ ...loadClientIds(), [key]: clientId }))
  } catch {
    // Registering again next time works as well.
  }
  return clientId
}

/**
 * The URL to send the browser to. Keep the SDK's PKCE context in this tab until the redirect.
 */
export async function startOidcLogin(options: {
  homeserverUrl: string
  config: ValidatedAuthMetadata
  /** The app's origin, e.g. https://nexspeak.example.org */
  origin: string
  register?: boolean
}): Promise<string> {
  const redirectUri = `${options.origin}/login`
  const clientId = await clientIdFor(options.config, redirectUri, options.origin)
  const oauth = new OAuth2(options.config, { clientId })
  const state = crypto.randomUUID()
  const url = await oauth.generateAuthorizationCodeGrantUrl(
    state, redirectUri, 'query', options.register ? 'create' : undefined,
  )
  // A single pending login per tab; a fresh attempt also discards an abandoned verifier.
  sessionStorage.setItem(PENDING_LOGIN_KEY, JSON.stringify({
    state,
    context: oauth.context,
    homeserverUrl: options.homeserverUrl,
    redirectUri,
    issuer: options.config.issuer,
    startedAt: Date.now(),
  } satisfies PendingLogin))
  return url
}

const PENDING_LOGIN_KEY = 'nexspeak_oauth_pending'
const PENDING_LOGIN_MAX_AGE_MS = 15 * 60_000

interface PendingLogin {
  state: string
  context: OAuth2['context']
  homeserverUrl: string
  redirectUri: string
  issuer: string
  startedAt: number
}

/** Back from the issuer with ?code=…&state=…: exchange the code for tokens. */
export async function completeOidcLogin(code: string, state: string, origin: string): Promise<OidcLoginResult> {
  const raw = sessionStorage.getItem(PENDING_LOGIN_KEY)
  const pending = raw ? JSON.parse(raw) as PendingLogin : null
  if (!pending || pending.state !== state || pending.redirectUri !== `${origin}/login` ||
      !Number.isFinite(pending.startedAt) || Date.now() - pending.startedAt > PENDING_LOGIN_MAX_AGE_MS) {
    throw new Error('The OAuth login is missing, expired or does not match this tab.')
  }
  // Consume before the first request so a callback cannot be exchanged twice.
  sessionStorage.removeItem(PENDING_LOGIN_KEY)
  const { homeserverUrl, redirectUri, context } = pending
  const config = await fetchOidcConfig(homeserverUrl)
  if (!config || config.issuer !== pending.issuer) throw new Error('The OAuth issuer changed during login.')
  const tokenResponse = await new OAuth2(config, context).completeAuthorizationCodeGrant(code, redirectUri)
  // The device id was part of the requested scope; whoami confirms it with the user id.
  const { user_id: userId, device_id: deviceId } = await createClient({
    baseUrl: homeserverUrl,
    accessToken: tokenResponse.access_token,
  }).whoami()
  if (!deviceId || deviceId !== context.deviceId) throw new Error('The homeserver returned an unexpected OAuth device id.')
  return {
    homeserverUrl,
    userId,
    deviceId,
    accessToken: tokenResponse.access_token,
    oidc: {
      issuer: config.issuer,
      clientId: context.clientId,
      redirectUri,
      refreshToken: tokenResponse.refresh_token,
      accountManagementUrl: config.account_management_uri,
    },
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
