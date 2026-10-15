/**
 * useMediaUrl Hook
 * Loads mxc:// media through the authenticated media API (required by current homeservers)
 * and returns a blob: URL that can be used in <img src>.
 */

'use client'

import { useEffect, useState } from 'react'
import type { MatrixClient } from 'matrix-js-sdk'
import { getMediaUrl } from '@/lib/matrix/client'

const MAX_CACHE_ENTRIES = 300
const cache = new Map<string, Promise<string | null>>()

function fetchBlobUrl(client: MatrixClient, httpUrl: string): Promise<string | null> {
  const cached = cache.get(httpUrl)
  if (cached) return cached

  const promise = fetch(httpUrl, {
    headers: { Authorization: `Bearer ${client.getAccessToken() ?? ''}` },
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Media request failed with ${response.status}`)
      return URL.createObjectURL(await response.blob())
    })
    .catch((error: unknown) => {
      console.warn('Failed to load media:', error)
      // Allow a retry on next mount instead of caching the failure forever.
      cache.delete(httpUrl)
      return null
    })

  cache.set(httpUrl, promise)

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
): string | null {
  const httpUrl = client ? getMediaUrl(client, mxcUrl, size) : null
  const [loaded, setLoaded] = useState<{ key: string; url: string | null } | null>(null)

  useEffect(() => {
    if (!client || !httpUrl) return
    let cancelled = false

    void fetchBlobUrl(client, httpUrl).then((url) => {
      if (!cancelled) setLoaded({ key: httpUrl, url })
    })

    return () => {
      cancelled = true
    }
  }, [client, httpUrl])

  return loaded && loaded.key === httpUrl ? loaded.url : null
}

/** Download a (possibly large) attachment on demand and hand it to the browser. */
export async function downloadMedia(client: MatrixClient, mxcUrl: string, fileName: string): Promise<void> {
  const httpUrl = getMediaUrl(client, mxcUrl)
  if (!httpUrl) throw new Error('Ungültige Medien-URL')

  const response = await fetch(httpUrl, {
    headers: { Authorization: `Bearer ${client.getAccessToken() ?? ''}` },
  })
  if (!response.ok) throw new Error(`Download fehlgeschlagen (${response.status})`)

  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
