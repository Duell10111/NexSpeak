'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useMatrixClient } from '@/hooks/useMatrixClient'
import { loadMediaBlob } from '@/hooks/useMediaUrl'
import { CustomEmojiImage } from './custom-emoji-image'
import { isEmojiMxc } from '@nexspeak/core/matrix/custom-emojis'
import type { MatrixClient } from 'matrix-js-sdk'

interface ActiveImage { users: number; url: string | null; promise: Promise<string | null> }
const activeImages = new WeakMap<MatrixClient, Map<string, ActiveImage>>()

/** Repeated visible stickers share one download and decoder resource; keep nothing while idle. */
function acquireImage(client: MatrixClient, mxc: string) {
  let images = activeImages.get(client)
  if (!images) { images = new Map(); activeImages.set(client, images) }
  let entry = images.get(mxc)
  if (!entry) {
    const next: ActiveImage = { users: 0, url: null, promise: Promise.resolve(null) }
    next.promise = loadMediaBlob(client, { mxc }).then((blob) => {
      if (!next.users) return null
      next.url = URL.createObjectURL(blob)
      return next.url
    }).catch(() => null)
    images.set(mxc, next)
    entry = next
  }
  const acquired = entry
  acquired.users++
  return { promise: acquired.promise, release: () => {
    if (--acquired.users) return
    if (acquired.url) URL.revokeObjectURL(acquired.url)
    images.delete(mxc)
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
  // Removing the image and revoking its URL stops animated GIF/WebP decoding on blur.
  return !failed && source?.mxc === mxc ? (
    // eslint-disable-next-line @next/next/no-img-element -- authenticated blob URL
    <img src={source.url} alt="" onError={() => setFailed(true)} data-testid="sticker-playing" className="absolute inset-0 h-full w-full object-contain" />
  ) : null
}

function PlayingSticker({ mxc }: { mxc: string }) {
  const active = useSyncExternalStore(subscribe, focused, unfocused)
  return active ? <OriginalSticker key={mxc} mxc={mxc} /> : null
}

/** Bounded transparent image; only visible stickers can load media or subscribe to focus. */
export function StickerImage({ mxc, name, size = 200 }: { mxc?: string; name: string; size?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!ref.current) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  const valid = Boolean(mxc && isEmojiMxc(mxc))
  return <span ref={ref} title={name} role="img" aria-label={name} className="relative inline-flex max-w-full items-center justify-center align-middle" style={{ width: size, height: size }}>
    {visible && valid ? <span aria-hidden="true" className="[&:has(>img)>span]:invisible">
      <CustomEmojiImage mxc={mxc!} name={name} size={size} />
      <PlayingSticker mxc={mxc!} />
    </span> : <span className="truncate text-xs">{name}</span>}
  </span>
}
