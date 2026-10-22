'use client'

import type { MatrixClient } from 'matrix-js-sdk'
import type { EncryptedFile } from '@nexspeak/core/matrix/attachments'
import { loadMediaBlob } from '@/hooks/useMediaUrl'

export interface CachedMedia { blob: Blob; url: string }
interface Entry { users: number; bytes: number; media: CachedMedia | null; promise: Promise<CachedMedia | null> }
export interface MediaSource { mxc?: string; file?: EncryptedFile; mimetype?: string }

const cachedMedia = new WeakMap<MatrixClient, Map<string, Entry>>()
/** Released originals (stickers, GIFs) stay cached up to this size, so refocusing or scrolling back does not download them again. */
const CACHE_BYTES = 32 * 1024 * 1024

function trim(entries: Map<string, Entry>) {
  let total = 0
  for (const entry of entries.values()) total += entry.bytes
  // Map order is least recently used first; media on screen is never evicted.
  for (const [key, entry] of entries) {
    if (total <= CACHE_BYTES) break
    if (entry.users) continue
    if (entry.media) URL.revokeObjectURL(entry.media.url)
    entries.delete(key)
    total -= entry.bytes
  }
}

/**
 * Repeated visible media shares one download; bounded cache instead of refetching on focus.
 * Resolves to null when loading fails or the original is larger than `maxBytes`.
 */
export function acquireMedia(client: MatrixClient, source: MediaSource, maxBytes = Infinity) {
  let entries = cachedMedia.get(client)
  if (!entries) { entries = new Map(); cachedMedia.set(client, entries) }
  const map = entries
  const key = source.file?.url ?? source.mxc ?? ''
  let entry = map.get(key)
  if (entry) map.delete(key)
  else {
    const next: Entry = { users: 0, bytes: 0, media: null, promise: Promise.resolve(null) }
    next.promise = loadMediaBlob(client, source).then((blob) => {
      if (blob.size > maxBytes) return null
      next.bytes = blob.size
      next.media = { blob, url: URL.createObjectURL(blob) }
      trim(map)
      return next.media
    }).catch(() => {
      // Allow a retry on the next mount instead of caching the failure.
      if (map.get(key) === next && !next.users) map.delete(key)
      return null
    })
    entry = next
  }
  map.set(key, entry)
  const acquired = entry
  acquired.users++
  return { promise: acquired.promise, release: () => {
    if (--acquired.users) return
    trim(map)
  } }
}
