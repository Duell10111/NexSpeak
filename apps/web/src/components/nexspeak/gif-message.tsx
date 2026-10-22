'use client'

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { MatrixMessage } from '@nexspeak/core/matrix/types'
import { useMatrixClient } from '@/hooks/useMatrixClient'
import { useMediaUrl } from '@/hooks/useMediaUrl'
import { useTranslation } from '@/hooks/useTranslation'
import { acquireMedia, type CachedMedia, type MediaSource } from '@/lib/media-cache'
import { getDefaultGifSettings, loadGifSettings, subscribeGifSettings } from '@/lib/gif-settings'
import { useWindowFocused } from '@/lib/window-focus'

type Media = NonNullable<MatrixMessage['media']>

/** Same box as other images: at most 400 px wide and high, keeping the sender's aspect ratio. */
function boxSize(media: Media) {
  const width = Math.min(media.width || 320, 400)
  const height = media.width && media.height ? Math.round((media.height / media.width) * width) : 240
  const scale = Math.min(1, 400 / height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/** The original, shared with other views of the same GIF; nothing is loaded while `active` is false. */
function useOriginal(media: Media, active: boolean): CachedMedia | null {
  const { client } = useMatrixClient()
  const key = media.file?.url ?? media.mxc
  const [loaded, setLoaded] = useState<{ key: string; media: CachedMedia } | null>(null)
  useEffect(() => {
    if (!client || !active || !key) return
    let cancelled = false
    const source: MediaSource = { mxc: media.mxc, file: media.file, mimetype: media.mimetype }
    const acquired = acquireMedia(client, source)
    void acquired.promise.then((original) => {
      if (!cancelled && original) setLoaded({ key, media: original })
    })
    return () => {
      cancelled = true
      acquired.release()
    }
    // Matrix media is immutable; `key` identifies it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, active, key])
  return active && loaded && loaded.key === key ? loaded.media : null
}

/**
 * Plays only while visible and the window is focused; with "Play GIFs automatically" off only
 * on hover or after a click. Everything else shows a still frame.
 */
function GifFrame({ media, label, children }: { media: Media; label: string; children: (state: { visible: boolean; playing: boolean }) => ReactNode }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [clicked, setClicked] = useState(false)
  const focused = useWindowFocused()
  const { autoplay } = useSyncExternalStore(subscribeGifSettings, loadGifSettings, getDefaultGifSettings)
  useEffect(() => {
    if (!ref.current) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  const playing = visible && focused && (autoplay || hovered || clicked)
  const box = boxSize(media)
  const content = <>
    {children({ visible, playing })}
    {!playing && <span aria-hidden="true" className="absolute top-1.5 left-1.5 rounded bg-black/60 px-1 text-[11px] font-bold text-white">GIF</span>}
  </>
  const className = 'relative mt-1 block max-w-full overflow-hidden rounded-lg bg-muted'
  if (autoplay) return <div ref={ref} role="img" aria-label={label} className={className} style={box}>{content}</div>
  return <div ref={ref} className={className} style={box}>
    <button type="button" aria-label={`${label} – ${clicked ? t('gif.pause') : t('gif.play')}`} aria-pressed={clicked}
      onClick={() => setClicked(!clicked)} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
      className="absolute inset-0 block h-full w-full focus-visible:outline focus-visible:outline-ring">
      {content}
    </button>
  </div>
}

function LoopingVideo({ media, visible, playing }: { media: Media; visible: boolean; playing: boolean }) {
  const { client } = useMatrixClient()
  const element = useRef<HTMLVideoElement>(null)
  const thumbnail = media.thumbnail
  const poster = useMediaUrl(visible && thumbnail ? client : null, thumbnail?.mxc, undefined, thumbnail?.file, thumbnail?.mimetype)
  // Without a poster the paused video shows its first frame, so it has to load while visible.
  const original = useOriginal(media, visible && (playing || !thumbnail))
  const url = original?.url
  useEffect(() => {
    const video = element.current
    if (!video || !url) return
    video.src = url
    return () => {
      // Detach, so the decoder releases its buffers while the GIF is off screen.
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [url])
  useEffect(() => {
    const video = element.current
    if (!video || !url) return
    if (playing) video.play().catch(() => {})
    else video.pause()
  }, [playing, url])
  return <video ref={element} muted loop playsInline disablePictureInPicture disableRemotePlayback preload="auto" poster={poster ?? undefined}
    aria-hidden="true" tabIndex={-1} className="absolute inset-0 h-full w-full object-contain" />
}

/** Draws the first frame once; an <img> would animate the GIF. */
function FirstFrame({ blob }: { blob: Blob }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let cancelled = false
    void createImageBitmap(blob).then((bitmap) => {
      const target = canvas.current
      if (cancelled || !target) return bitmap.close()
      target.width = bitmap.width
      target.height = bitmap.height
      target.getContext('bitmaprenderer')?.transferFromImageBitmap(bitmap)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [blob])
  return <canvas ref={canvas} aria-hidden="true" className="absolute inset-0 h-full w-full object-contain" />
}

function AnimatedImage({ media, visible, playing }: { media: Media; visible: boolean; playing: boolean }) {
  const { client } = useMatrixClient()
  const thumbnail = media.thumbnail
  // The sender's thumbnail, else the homeserver's (static) thumbnail; encrypted media has none.
  const serverStill = !thumbnail && !media.file
  const still = useMediaUrl(visible && (thumbnail || serverStill) ? client : null, thumbnail ? thumbnail.mxc : media.mxc,
    thumbnail ? undefined : 800, thumbnail?.file, thumbnail?.mimetype)
  const original = useOriginal(media, visible && (playing || (!thumbnail && !serverStill)))
  return <>
    {/* eslint-disable-next-line @next/next/no-img-element -- blob: URLs cannot go through next/image */}
    {still && <img src={still} alt="" className="absolute inset-0 h-full w-full object-contain" />}
    {!still && original && !playing && <FirstFrame blob={original.blob} />}
    {/* Removing the image stops decoding when the GIF is paused or off screen. */}
    {/* eslint-disable-next-line @next/next/no-img-element -- blob: URLs cannot go through next/image */}
    {playing && original && <img src={original.url} alt="" data-testid="gif-playing" className="absolute inset-0 h-full w-full object-contain" />}
  </>
}

/** Videos flagged as GIF: looping and silent, without controls. */
export function GifVideo({ message }: { message: MatrixMessage }) {
  const media = message.media
  if (!media) return null
  return <GifFrame media={media} label={message.body}>
    {({ visible, playing }) => <LoopingVideo media={media} visible={visible} playing={playing} />}
  </GifFrame>
}

/** image/gif from other clients, which would otherwise animate permanently as <img>. */
export function GifImage({ message }: { message: MatrixMessage }) {
  const media = message.media
  if (!media) return null
  return <GifFrame media={media} label={message.body}>
    {({ visible, playing }) => <AnimatedImage media={media} visible={visible} playing={playing} />}
  </GifFrame>
}
