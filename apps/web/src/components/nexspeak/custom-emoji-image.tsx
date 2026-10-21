'use client'

import { useEffect, useRef, useState } from 'react'
import type { MatrixClient } from 'matrix-js-sdk'
import { useMatrixClient } from '@/hooks/useMatrixClient'
import { loadMediaBlob } from '@/hooks/useMediaUrl'
import { isEmojiMxc } from '@nexspeak/core/matrix/custom-emojis'

const cache = new Map<string, Promise<string | null>>()
let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, (blob: Blob | null) => void>()

function staticFrame(blob: Blob, size: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    const id = nextId++
    try {
      if (!worker) {
        worker = new Worker(new URL('../../lib/static-emoji.worker.ts', import.meta.url))
        worker.onmessage = (event: MessageEvent<{ id: number; blob: Blob | null }>) => {
          pending.get(event.data.id)?.(event.data.blob)
          pending.delete(event.data.id)
          if (!pending.size) { worker?.terminate(); worker = null }
        }
        worker.onerror = () => {
          pending.forEach((finish) => finish(null))
          pending.clear()
          worker?.terminate()
          worker = null
        }
      }
      pending.set(id, resolve)
      worker.postMessage({ id, blob, size })
    } catch {
      pending.delete(id)
      if (!pending.size) { worker?.terminate(); worker = null }
      resolve(null)
    }
  })
}

function emojiUrl(client: MatrixClient, mxc: string, size: number) {
  const key = `${client.getUserId()}:${mxc}:${size}`
  let request = cache.get(key)
  if (!request) {
    request = loadMediaBlob(client, { mxc }, size).then((blob) => staticFrame(blob, size))
      .then((blob) => blob ? URL.createObjectURL(blob) : null).catch(() => null)
      .then((url) => {
        if (!url && cache.get(key) === request) cache.delete(key)
        return url
      })
    cache.set(key, request)
    if (cache.size > 300) {
      const oldest = cache.keys().next().value!
      void cache.get(oldest)?.then((url) => url && URL.revokeObjectURL(url))
      cache.delete(oldest)
    }
  }
  return request
}

/** Fixed-size, lazy, static thumbnails. No image processing on the main thread. */
export function CustomEmojiImage({ mxc, name, size = 24 }: { mxc: string; name: string; size?: number }) {
  const { client } = useMatrixClient()
  const ref = useRef<HTMLSpanElement>(null)
  const [source, setSource] = useState<{ mxc: string; url: string } | null>(null)
  useEffect(() => {
    const element = ref.current
    if (!client || !element || !isEmojiMxc(mxc)) return
    let cancelled = false
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      void emojiUrl(client, mxc, size * 2).then((url) => {
        if (!cancelled && url) setSource({ mxc, url })
      })
    })
    observer.observe(element)
    return () => { cancelled = true; observer.disconnect() }
  }, [client, mxc, size])
  return (
    <span ref={ref} className="inline-flex shrink-0 items-center justify-center align-middle" style={{ width: size, height: size }} title={name}>
      {source?.mxc === mxc ? (
        // eslint-disable-next-line @next/next/no-img-element -- authenticated, static blob thumbnail
        <img src={source.url} alt={name} width={size} height={size} className="object-contain" />
      ) : <span role="img" aria-label={name} className="overflow-hidden text-[10px]">{name}</span>}
    </span>
  )
}
