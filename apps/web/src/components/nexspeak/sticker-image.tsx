'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useMatrixClient } from '@/hooks/useMatrixClient'
import { loadMediaBlob } from '@/hooks/useMediaUrl'
import { CustomEmojiImage } from './custom-emoji-image'
import { isEmojiMxc } from '@nexspeak/core/matrix/custom-emojis'
import type { MatrixClient } from 'matrix-js-sdk'

interface CachedImage { users: number; bytes: number; url: string | null; promise: Promise<string | null> }
const cachedImages = new WeakMap<MatrixClient, Map<string, CachedImage>>()
/** Larger originals stay static: decoding them costs too much next to a game. */
const MAX_ANIMATED_BYTES = 4 * 1024 * 1024
/** Released originals stay cached up to this size, so refocusing the window does not download them again. */
const CACHE_BYTES = 32 * 1024 * 1024

function trim(images: Map<string, CachedImage>) {
  let total = 0
  for (const entry of images.values()) total += entry.bytes
  // Map order is least recently used first; images on screen are never evicted.
  for (const [mxc, entry] of images) {
    if (total <= CACHE_BYTES) break
    if (entry.users) continue
    if (entry.url) URL.revokeObjectURL(entry.url)
    images.delete(mxc)
    total -= entry.bytes
  }
}

/** Repeated visible stickers share one download; bounded cache instead of refetching on focus. */
function acquireImage(client: MatrixClient, mxc: string) {
  let images = cachedImages.get(client)
  if (!images) { images = new Map(); cachedImages.set(client, images) }
  const map = images
  let entry = map.get(mxc)
  if (entry) map.delete(mxc)
  else {
    const next: CachedImage = { users: 0, bytes: 0, url: null, promise: Promise.resolve(null) }
    next.promise = loadMediaBlob(client, { mxc }).then((blob) => {
      if (blob.size > MAX_ANIMATED_BYTES) return null
      next.bytes = blob.size
      next.url = URL.createObjectURL(blob)
      trim(map)
      return next.url
    }).catch(() => {
      // Allow a retry on the next mount instead of caching the failure.
      if (map.get(mxc) === next && !next.users) map.delete(mxc)
      return null
    })
    entry = next
  }
  map.set(mxc, entry)
  const acquired = entry
  acquired.users++
  return { promise: acquired.promise, release: () => {
    if (--acquired.users) return
    trim(map)
  } }
}

// One set of focus listeners for every visible sticker, with no polling or frame loops.
const listeners = new Set<() => void>()
function notify() { listeners.forEach((listener) => listener()) }
function subscribe(listener: () => void) {
  if (!listeners.size) {
    window.addEventListener('focus', notify)
    window.addEventListener('blur', notify)
    document.addEventListener('visibilitychange', notify)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      window.removeEventListener('focus', notify)
      window.removeEventListener('blur', notify)
      document.removeEventListener('visibilitychange', notify)
    }
  }
}
const focused = () => document.visibilityState === 'visible' && document.hasFocus()
const unfocused = () => false

function OriginalSticker({ mxc }: { mxc: string }) {
  const { client } = useMatrixClient()
  const [source, setSource] = useState<{ mxc: string; url: string } | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!client) return
    let cancelled = false
    const image = acquireImage(client, mxc)
    void image.promise.then((url) => {
      if (cancelled || !url) return
      setSource({ mxc, url })
    })
    return () => {
      cancelled = true
      image.release()
    }
  }, [client, mxc])
  // Removing the image stops animated GIF/WebP decoding on blur.
  return !failed && source?.mxc === mxc ? (
    // eslint-disable-next-line @next/next/no-img-element -- authenticated blob URL
    <img src={source.url} alt="" onError={() => setFailed(true)} data-testid="sticker-playing" className="absolute inset-0 h-full w-full object-contain" />
  ) : null
}

function PlayingSticker({ mxc }: { mxc: string }) {
  const active = useSyncExternalStore(subscribe, focused, unfocused)
  return active ? <OriginalSticker key={mxc} mxc={mxc} /> : null
}

/** Fit the sender's dimensions into the box without upscaling small stickers. */
function boxSize(size: number, width?: number, height?: number) {
  if (!width || !height) return { width: size, height: size }
  const scale = Math.min(1, size / width, size / height)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** Bounded transparent image; only visible stickers can load media or subscribe to focus. */
export function StickerImage({ mxc, name, size = 200, width, height }: { mxc?: string; name: string; size?: number; width?: number; height?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!ref.current) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  const valid = Boolean(mxc && isEmojiMxc(mxc))
  const box = boxSize(size, width, height)
  return <span ref={ref} title={name} role="img" aria-label={name} className="relative inline-flex max-w-full items-center justify-center align-middle" style={box}>
    {visible && valid ? <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center overflow-hidden [&:has(>img)>span]:invisible">
      <CustomEmojiImage mxc={mxc!} name={name} size={Math.max(box.width, box.height)} />
      <PlayingSticker mxc={mxc!} />
    </span> : <span className="truncate text-xs">{name}</span>}
  </span>
}
