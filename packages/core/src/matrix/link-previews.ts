/** Opt-in previews use the homeserver exclusively; never contact linked sites from the client. */
import { MatrixEvent, type MatrixClient } from 'matrix-js-sdk'
import { parseFormattedBody, type FormattedNode } from './formatted-body'
import { parseMatrixLink } from './links'

/** Sender preference, carried inside encrypted content too. Other NexSpeak clients honor it. */
export const HIDE_LINK_PREVIEWS = 'org.nexspeak.hide_link_previews'
const MAX_URL_LENGTH = 4096
const MAX_CACHE_ENTRIES = 512
const caches = new WeakMap<MatrixClient, Map<string, Promise<LinkPreview | null>>>()

export interface LinkPreview {
  title?: string
  description?: string
  imageMxc?: string
}

/** Reject credentials, non-web schemes and obvious local destinations before sharing a URL. */
export function previewUrl(value: string): string | null {
  if (value.length > MAX_URL_LENGTH) return null
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || parseMatrixLink(url.href)) return null
    const host = url.hostname.toLowerCase().replace(/\.$/, '')
    if (!host.includes('.') || host.endsWith('.localhost') || host.endsWith('.local') || host.startsWith('[')) return null
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a, b] = host.split('.').map(Number)
      if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return null
    }
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

/** At most one card; code blocks, quotations and unrevealed spoilers must not disclose URLs. */
export function firstPreviewUrl(body: string, formatted?: FormattedNode[]): string | null {
  const fromText = (text: string) => {
    for (const match of text.matchAll(/https?:\/\/[^\s<>]+/gi)) {
      const url = previewUrl(match[0].replace(/[.,:;"')\]!?]+$/, ''))
      if (url) return url
    }
    return null
  }
  const fromNodes = (nodes: FormattedNode[]): string | null => {
    for (const node of nodes) {
      if (typeof node === 'string') {
        const url = fromText(node)
        if (url) return url
      } else {
        if (['code', 'pre', 'blockquote', 'details'].includes(node.tag) || node.attrs.spoiler !== undefined) continue
        if (node.tag === 'a') {
          const url = node.attrs.href ? previewUrl(node.attrs.href) : null
          if (url) return url
          continue
        }
        const url = fromNodes(node.children)
        if (url) return url
      }
    }
    return null
  }
  return formatted ? fromNodes(formatted) : fromText(body)
}

function text(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').trim().slice(0, limit) || undefined
}

export function sanitizePreview(value: unknown): LinkPreview | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  const title = text(data['og:title'], 300)
  const description = text(data['og:description'], 700)
  const image = data['og:image']
  // An untrusted HTTP image would let the destination track readers and leak their IP addresses.
  const imageMxc = typeof image === 'string' && /^mxc:\/\/[^/\s?#]+\/[^/\s?#]+$/.test(image) && image.length <= MAX_URL_LENGTH ? image : undefined
  return title || description || imageMxc ? { title, description, imageMxc } : null
}

/** In-flight requests, successes and failures are shared for this client's session. No timers. */
export function loadLinkPreview(client: MatrixClient, url: string): Promise<LinkPreview | null> {
  const safe = previewUrl(url)
  if (!safe) return Promise.resolve(null)
  let cache = caches.get(client)
  if (!cache) { cache = new Map(); caches.set(client, cache) }
  const cached = cache.get(safe)
  if (cached) return cached
  if (cache.size >= MAX_CACHE_ENTRIES) return Promise.resolve(null)
  const result = Promise.resolve().then(() => client.getUrlPreview(safe, Date.now())).then(sanitizePreview).catch(() => null)
  cache.set(safe, result)
  return result
}

/**
 * Cached /sync snapshots can replay the original before its sender's hide edit. Resolve the
 * current bundled replacement before disclosing any URL. Only called for visible sent messages.
 * Matrix 1.7 guarantees complete replacement bundles on GET /rooms/{roomId}/event/{eventId}.
 */
const messageChecks = new WeakMap<MatrixClient, Map<string, Promise<string | null>>>()
export function verifiedPreviewUrl(client: MatrixClient, event: MatrixEvent): Promise<string | null> {
  const eventId = event.getId()
  const roomId = event.getRoomId()
  if (!eventId || !roomId) return Promise.resolve(null)
  let cache = messageChecks.get(client)
  if (!cache) { cache = new Map(); messageChecks.set(client, cache) }
  const key = `${roomId}:${eventId}:${event.replacingEventId() ?? ''}`
  const cached = cache.get(key)
  if (cached) return cached
  if (cache.size >= MAX_CACHE_ENTRIES) return Promise.resolve(null)
  const result = (async () => {
    if (!await client.isVersionSupported('v1.7')) return null
    const raw = await client.fetchRoomEvent(roomId, eventId)
    const current = new MatrixEvent({ ...raw, room_id: roomId })
    if (current.getId() !== eventId || current.getSender() !== event.getSender() || current.isRedacted()) return null
    await client.decryptEventIfNeeded(current)
    if (current.isDecryptionFailure()) return null
    let content = current.getContent()
    const replacement = current.getServerAggregatedRelation<Record<string, unknown>>('m.replace')
    if (replacement) {
      if (!replacement.content) return null
      const edit = new MatrixEvent({ ...replacement, room_id: roomId })
      await client.decryptEventIfNeeded(edit)
      const relation = edit.getRelation()
      if (edit.isDecryptionFailure() || edit.getSender() !== current.getSender() || edit.getType() !== current.getType() ||
        relation?.rel_type !== 'm.replace' || relation.event_id !== eventId) return null
      const next = edit.getContent()['m.new_content']
      if (!next || typeof next !== 'object' || Array.isArray(next)) return null
      content = next
    }
    if (content[HIDE_LINK_PREVIEWS] === true || typeof content.body !== 'string' || !['m.text', 'm.notice', 'm.emote'].includes(content.msgtype ?? '')) return null
    const formatted = content.format === 'org.matrix.custom.html' && typeof content.formatted_body === 'string' ? parseFormattedBody(content.formatted_body) : undefined
    // Match timeline rendering of legacy plain-text reply quotes.
    const body = current.replyEventId ? content.body.replace(/^(>.*(\n|$))+\n?/, '') : content.body
    return firstPreviewUrl(body, formatted)
  })().catch(() => null)
  cache.set(key, result)
  return result
}

/** Decode only still raster images: animated formats must never autoplay inside a card. */
export function isStaticPreviewImage(bytes: Uint8Array): boolean {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true
  const ascii = (offset: number, count: number) => String.fromCharCode(...bytes.subarray(offset, offset + count))
  if (ascii(0, 8) === '\x89PNG\r\n\x1a\n') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const size = view.getUint32(offset)
      const kind = ascii(offset + 4, 4)
      if (kind === 'acTL' || offset + size + 12 > bytes.length) return false
      if (kind === 'IEND') return true
      offset += size + 12
    }
  }
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const size = view.getUint32(offset + 4, true)
      const kind = ascii(offset, 4)
      if (kind === 'ANIM' || kind === 'ANMF' || (kind === 'VP8X' && (bytes[offset + 8] & 2))) return false
      if (offset + size + 8 > bytes.length) return false
      offset += 8 + size + (size % 2)
    }
    return true
  }
  return false
}
