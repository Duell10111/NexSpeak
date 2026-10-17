/**
 * Links into Matrix: matrix.to URLs (what Element shares), matrix: URIs (MSC2312) and the desktop
 * app's own nexspeak:// deep links:
 *
 *   nexspeak://room/<room id or alias>[?via=server]   open or join a room or space
 *   nexspeak://user/<user id>                           open a direct message
 *   nexspeak://sso?loginToken=<token>                   return from the SSO login in the browser
 */

export type MatrixLink =
  | { kind: 'room'; roomIdOrAlias: string; via: string[]; eventId?: string }
  | { kind: 'user'; userId: string }
  | { kind: 'sso'; loginToken: string }

export const DEEP_LINK_SCHEME = 'nexspeak:'

// Room version 12 ids have no server part ("!abc…"); older ones do ("!abc:example.org").
const ROOM_ID = /^![^\s/:]+(:[^\s/]+)?$/
const ROOM_ALIAS = /^#[^:\s]+:[^\s/]+$/
const USER_ID = /^@[^:\s]+:[^\s/]+$/
const EVENT_ID = /^\$[^\s/]+$/

function roomOrUser(identifier: string, via: string[], eventId?: string): MatrixLink | null {
  if (USER_ID.test(identifier)) return { kind: 'user', userId: identifier }
  if (!ROOM_ID.test(identifier) && !ROOM_ALIAS.test(identifier)) return null
  return {
    kind: 'room',
    roomIdOrAlias: identifier,
    via,
    ...(eventId && EVENT_ID.test(eventId) ? { eventId } : {}),
  }
}

function decode(part: string): string | null {
  try {
    return decodeURIComponent(part)
  } catch {
    return null
  }
}

/** https://matrix.to/#/<identifier>[/<event id>][?via=...] */
function parseMatrixTo(url: URL): MatrixLink | null {
  const fragment = url.hash.replace(/^#\/?/, '')
  const [path, query = ''] = fragment.split('?')
  const [identifier, eventId] = path.split('/').map(decode)
  if (!identifier) return null
  return roomOrUser(identifier, new URLSearchParams(query).getAll('via'), eventId ?? undefined)
}

/** matrix:r/alias:server, matrix:roomid/id:server[/e/event], matrix:u/user:server (MSC2312) */
function parseMatrixUri(url: URL): MatrixLink | null {
  const segments = url.pathname.split('/').map(decode)
  if (segments.some((segment) => segment === null)) return null
  const [type, name, eventType, eventName] = segments as string[]
  const via = url.searchParams.getAll('via')
  const eventId = eventType === 'e' && eventName ? `$${eventName}` : undefined
  if (type === 'r') return roomOrUser(`#${name}`, via)
  if (type === 'roomid') return roomOrUser(`!${name}`, via, eventId)
  if (type === 'u') return roomOrUser(`@${name}`, via)
  return null
}

function parseDeepLink(url: URL): MatrixLink | null {
  // nexspeak://room/... parses as host "room" with the identifier in the path.
  const action = url.host
  if (action === 'sso') {
    const loginToken = url.searchParams.get('loginToken')
    return loginToken ? { kind: 'sso', loginToken } : null
  }
  const identifier = decode(url.pathname.replace(/^\//, ''))
  if (!identifier) return null
  if (action === 'room') {
    const link = roomOrUser(identifier, url.searchParams.getAll('via'))
    return link?.kind === 'room' ? link : null
  }
  if (action === 'user') {
    const link = roomOrUser(identifier, [])
    return link?.kind === 'user' ? link : null
  }
  return null
}

/** Parses a link the app can handle itself; null for everything else (open it in the browser). */
export function parseMatrixLink(href: string): MatrixLink | null {
  // Deep links arrive from the OS; anything this long is not one of ours.
  if (href.length > 4096) return null
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.protocol === 'https:' && url.host === 'matrix.to') return parseMatrixTo(url)
  if (url.protocol === 'matrix:') return parseMatrixUri(url)
  if (url.protocol === DEEP_LINK_SCHEME) return parseDeepLink(url)
  return null
}
