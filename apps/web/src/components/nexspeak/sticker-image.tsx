'use client'

import { useEffect, useRef, useState } from 'react'
import { useMatrixClient } from '@/hooks/useMatrixClient'
import { acquireMedia } from '@/lib/media-cache'
import { useWindowFocused } from '@/lib/window-focus'
import { CustomEmojiImage } from './custom-emoji-image'
import { isEmojiMxc } from '@nexspeak/core/matrix/custom-emojis'

/** Larger originals stay static: decoding them costs too much next to a game. */
const MAX_ANIMATED_BYTES = 4 * 1024 * 1024

function OriginalSticker({ mxc }: { mxc: string }) {
  const { client } = useMatrixClient()
  const [source, setSource] = useState<{ mxc: string; url: string } | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!client) return
    let cancelled = false
    const image = acquireMedia(client, { mxc }, MAX_ANIMATED_BYTES)
    void image.promise.then((media) => {
      if (cancelled || !media) return
      setSource({ mxc, url: media.url })
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
  const active = useWindowFocused()
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
