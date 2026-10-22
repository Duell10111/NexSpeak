/**
 * Who watches whose screenshare. LiveKit doesn't tell a publisher who subscribed, so viewers
 * announce it in a participant attribute: state, so it also reaches participants who join later.
 */

/** LiveKit participant attribute: JSON array of the identities whose screenshares we watch. */
export const WATCHING_ATTRIBUTE = 'io.nexspeak.watching'

/** Attribute value for the watched identities; empty (which deletes the attribute) for none. */
export function encodeWatching(identities: Iterable<string>): string {
  const sorted = [...new Set(identities)].sort()
  return sorted.length > 0 ? JSON.stringify(sorted) : ''
}

/** Identities in an attribute value; anything malformed counts as watching nothing. */
export function parseWatching(value: string | undefined): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}
