'use client'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { MatrixClient } from 'matrix-js-sdk'
import type { MatrixMessage } from '@nexspeak/core/matrix/types'
import { firstPreviewUrl, HIDE_LINK_PREVIEWS, isStaticPreviewImage, loadLinkPreview, verifiedPreviewUrl, type LinkPreview } from '@nexspeak/core/matrix/link-previews'
import { getMediaUrl } from '@nexspeak/core/matrix/client'
import { useMatrixClient } from '@/hooks/useMatrixClient'
import { useTranslation } from '@/hooks/useTranslation'
import { defaultLinkPreviewSettings, loadLinkPreviewSettings, subscribeLinkPreviewSettings } from '@/lib/link-preview-settings'

const MAX_IMAGE_BYTES = 2 * 1024 * 1024

async function staticImage(client: MatrixClient, mxc: string, signal: AbortSignal): Promise<Blob | null> {
  const result = (async () => {
    const url = getMediaUrl(client, mxc, 320)
    if (!url) return null
    const response = await fetch(url, { headers: { Authorization: `Bearer ${client.getAccessToken() ?? ''}` }, signal })
    if (!response.ok || Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) { await response.body?.cancel(); return null }
    const reader = response.body?.getReader()
    if (!reader) return null
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_IMAGE_BYTES) { await reader.cancel(); return null }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    if (!isStaticPreviewImage(bytes)) return null
    const type = bytes[0] === 0xff ? 'image/jpeg' : bytes[0] === 0x89 ? 'image/png' : 'image/webp'
    return new Blob([bytes], { type })
  })().catch(() => null)
  return result
}

function PreviewCard({ client, url, message }: { client: MatrixClient; url: string; message: MatrixMessage }) {
  const { t } = useTranslation()
  const element = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [loaded, setLoaded] = useState<LinkPreview | null>(null)
  const [image, setImage] = useState<string | null>(null)

  useEffect(() => {
    if (!element.current) return
    let intersects = false
    const update = () => setVisible(intersects && document.visibilityState !== 'hidden')
    const observer = new IntersectionObserver(([entry]) => { intersects = entry.isIntersecting; update() })
    observer.observe(element.current)
    document.addEventListener('visibilitychange', update)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update) }
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    void verifiedPreviewUrl(client, message.event).then((verified) => {
      if (cancelled || verified !== url) return null
      return loadLinkPreview(client, url)
    }).then((preview) => { if (!cancelled && preview) setLoaded(preview) })
    return () => { cancelled = true }
  }, [client, url, visible, message.event, message.edited])

  useEffect(() => {
    if (!visible || !loaded?.imageMxc) return
    let cancelled = false
    let objectUrl: string | null = null
    const abort = new AbortController()
    void staticImage(client, loaded.imageMxc, abort.signal).then((blob) => {
      if (cancelled || !blob) return
      objectUrl = URL.createObjectURL(blob)
      setImage(objectUrl)
    })
    return () => { cancelled = true; abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); setImage(null) }
  }, [client, loaded?.imageMxc, visible])

  return <div ref={element} className="max-w-md" data-link-preview-url={url}>
    {loaded && <a href={url} target="_blank" rel="noopener noreferrer nofollow" aria-label={t('linkPreview.open')} className="mt-2 block overflow-hidden rounded-md border border-border bg-secondary text-sm">
      <div className="space-y-1 px-3 py-2">
        <p className="truncate text-xs text-muted-foreground">{new URL(url).hostname}</p>
        {loaded.title && <p className="line-clamp-2 font-semibold text-primary">{loaded.title}</p>}
        {loaded.description && <p className="line-clamp-3 text-muted-foreground">{loaded.description}</p>}
      </div>
      {image && visible && (
        // eslint-disable-next-line @next/next/no-img-element -- authenticated, bounded still-image blob
        <img src={image} alt="" loading="lazy" className="max-h-44 w-full object-cover" />
      )}
    </a>}
  </div>
}

export function MessageLinkPreview({ message }: { message: MatrixMessage }) {
  const { client } = useMatrixClient()
  const settings = useSyncExternalStore(subscribeLinkPreviewSettings, loadLinkPreviewSettings, defaultLinkPreviewSettings)
  if (!client || message.status !== 'sent' || !settings.enabled || message.event.getContent()[HIDE_LINK_PREVIEWS] === true ||
    ((message.event.isEncrypted() || client.isRoomEncrypted(message.roomId)) && !settings.encrypted)) return null
  const url = firstPreviewUrl(message.body, message.formatted)
  return url ? <PreviewCard key={`${message.roomId}:${message.id}:${url}`} client={client} url={url} message={message} /> : null
}
