/**
 * useMediaUrl Hook
 * Loads mxc:// media through the authenticated media API (required by current homeservers),
 * decrypts end-to-end encrypted attachments, and returns a blob: URL for <img src>.
 */

'use client'

import { useEffect, useState } from 'react'
import type { MatrixClient } from 'matrix-js-sdk'
import { getMediaUrl } from '@nexspeak/core/matrix/client'
import { decryptAttachment, type EncryptedFile } from '@nexspeak/core/matrix/attachments'
import { t } from '@nexspeak/i18n'

const MAX_CACHE_ENTRIES = 300
const cache = new Map<string, Promise<string | null>>()

async function fetchMedia(client: MatrixClient, httpUrl: string): Promise<ArrayBuffer> {
  const response = await fetch(httpUrl, {
    headers: { Authorization: `Bearer ${client.getAccessToken() ?? ''}` },
  })
  if (!response.ok) throw new Error(t('error.downloadStatus', { status: response.status }))
  return response.arrayBuffer()
}

/** Download (and decrypt, if needed) an attachment into a Blob. */
export async function loadMediaBlob(
  client: MatrixClient,
  source: { mxc?: string; file?: EncryptedFile; mimetype?: string },
  size?: number,
): Promise<Blob> {
  if (source.file) {
    // Encrypted media has no server-side thumbnails; always fetch the original.
    const httpUrl = getMediaUrl(client, source.file.url)
    if (!httpUrl) throw new Error(t('error.invalidMediaUrl'))
    const plaintext = await decryptAttachment(await fetchMedia(client, httpUrl), source.file)
    return new Blob([plaintext], { type: source.mimetype || 'application/octet-stream' })
  }

  const httpUrl = getMediaUrl(client, source.mxc, size)
  if (!httpUrl) throw new Error(t('error.invalidMediaUrl'))
  return new Blob([await fetchMedia(client, httpUrl)], { type: source.mimetype || '' })
}

function cachedBlobUrl(cacheKey: string, load: () => Promise<Blob>): Promise<string | null> {
  const cached = cache.get(cacheKey)
  if (cached) return cached

  const promise = load()
    .then((blob) => URL.createObjectURL(blob))
    .catch((error: unknown) => {
      console.warn('Failed to load media:', error)
      // Allow a retry on next mount instead of caching the failure forever.
      cache.delete(cacheKey)
      return null
    })

  cache.set(cacheKey, promise)

  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) {
      const oldest = cache.get(oldestKey)
      cache.delete(oldestKey)
      void oldest?.then((url) => url && URL.revokeObjectURL(url))
    }
  }

  return promise
}

export function useMediaUrl(
  client: MatrixClient | null,
  mxcUrl: string | null | undefined,
  size?: number,
  encryptedFile?: EncryptedFile,
  mimetype?: string,
): string | null {
  const cacheKey = encryptedFile ? `enc:${encryptedFile.url}` : mxcUrl ? `${mxcUrl}@${size ?? 'full'}` : null
  const [loaded, setLoaded] = useState<{ key: string; url: string | null } | null>(null)

  useEffect(() => {
    if (!client || !cacheKey) return
    let cancelled = false

    void cachedBlobUrl(cacheKey, () =>
      loadMediaBlob(client, { mxc: mxcUrl ?? undefined, file: encryptedFile, mimetype }, size),
    ).then((url) => {
      if (!cancelled) setLoaded({ key: cacheKey, url })
    })

    return () => {
      cancelled = true
    }
    // encryptedFile is identified by cacheKey; its object identity changes on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, cacheKey, size, mimetype])

  return loaded && loaded.key === cacheKey ? loaded.url : null
}

/** Download a (possibly large) attachment on demand and hand it to the browser. */
export async function downloadMedia(
  client: MatrixClient,
  source: { mxc?: string; file?: EncryptedFile; mimetype?: string },
  fileName: string,
): Promise<void> {
  const url = URL.createObjectURL(await loadMediaBlob(client, source))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
