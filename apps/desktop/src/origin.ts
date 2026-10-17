/**
 * scheme://host[:port] of a URL. Not URL.origin: Node only knows http(s) & co. as "special"
 * schemes and returns "null" for app://, which would deny every permission.
 */
export function originOf(url: string): string | null {
  try {
    const { protocol, host } = new URL(url)
    return host ? `${protocol}//${host}` : null
  } catch {
    return null
  }
}
