'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { Star } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useMatrixClient } from '@/hooks/useMatrixClient'
import { useTranslation } from '@/hooks/useTranslation'
import { useGifFavourites } from '@/hooks/useGifFavourites'
import { getDefaultGifSettings, loadGifSettings, saveGifSettings, subscribeGifSettings } from '@/lib/gif-settings'
import { useWindowFocused } from '@/lib/window-focus'
import { GIF_PROVIDER, GIF_PROVIDER_URL, gifsById, searchGifs, trendingGifs, type Gif } from '@nexspeak/core/gifs'
import { toggleGifFavourite } from '@nexspeak/core/matrix/gif-favourites'
import { describeMatrixError } from '@nexspeak/core/matrix/errors'

const COLUMNS = 2
const ROW_HEIGHT = 112
const HEIGHT = ROW_HEIGHT * 3
const SEARCH_DELAY_MS = 300
/** Start loading the next page this close to the end of the list. */
const LOAD_MORE_PX = ROW_HEIGHT * 2

type Tab = 'trending' | 'favourites'
interface Results { key: string; gifs: Gif[]; next?: string; loading: boolean; failed: boolean }

function GifTile({ gif, favourite, play, style, onSelect, onToggleFavourite }: {
  gif: Gif
  favourite: boolean
  play: boolean
  style: CSSProperties
  onSelect: () => void
  onToggleFavourite: () => void
}) {
  const { t } = useTranslation()
  const video = useRef<HTMLVideoElement>(null)
  const [hovered, setHovered] = useState(false)
  const playing = play || hovered
  const preview = gif.preview
  useEffect(() => {
    const element = video.current
    if (!element) return
    if (playing) element.play().catch(() => {})
    else element.pause()
  }, [playing])
  // Scrolled out of the list: release the decoder right away instead of waiting for garbage collection.
  useEffect(() => {
    const element = video.current
    return () => {
      element?.removeAttribute('src')
      element?.load()
    }
  }, [])
  const label = gif.title || 'GIF'
  return <div className="group absolute p-0.5" style={style} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
    <button type="button" onClick={onSelect} aria-label={label} title={gif.title || undefined}
      className="h-full w-full overflow-hidden rounded bg-muted focus-visible:outline focus-visible:outline-ring">
      {preview.mimetype.startsWith('video/') ? (
        <video ref={video} src={preview.url} muted loop playsInline disablePictureInPicture disableRemotePlayback
          preload={playing ? 'auto' : 'metadata'} aria-hidden="true" className="h-full w-full object-cover" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- remote provider preview
        <img src={preview.url} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
      )}
    </button>
    <button type="button" onClick={onToggleFavourite} aria-pressed={favourite} aria-label={favourite ? t('gif.unfavourite') : t('gif.favourite')}
      className={cn('absolute top-1.5 right-1.5 rounded bg-black/60 p-1 text-white focus-visible:opacity-100 group-hover:opacity-100', !favourite && 'opacity-0')}>
      <Star className={cn('h-4 w-4', favourite && 'fill-current text-yellow-400')} />
    </button>
  </div>
}

function GifBrowser({ onSelect }: { onSelect: (gif: Gif) => void }) {
  const { t, intl } = useTranslation()
  const { client } = useMatrixClient()
  const { autoplay } = useSyncExternalStore(subscribeGifSettings, loadGifSettings, getDefaultGifSettings)
  const focused = useWindowFocused()
  const favourites = useGifFavourites(true)
  const favouriteSet = useMemo(() => new Set(favourites), [favourites])
  const [tab, setTab] = useState<Tab>('trending')
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Results | null>(null)
  const [scroll, setScroll] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const viewport = useRef<HTMLDivElement>(null)
  const loadingMore = useRef<AbortController | null>(null)
  const mode = search ? 'search' : tab
  const key = `${mode}:${search}:${attempt}`

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), query.trim() ? SEARCH_DELAY_MS : 0)
    return () => clearTimeout(timer)
  }, [query])

  // The favourites list is fetched when it is shown; unstarring there only hides the GIF.
  const [favouriteIds, setFavouriteIds] = useState<string[]>([])
  const resetScroll = () => {
    setScroll(0)
    if (viewport.current) viewport.current.scrollTop = 0
  }
  useEffect(() => {
    const controller = new AbortController()
    const options = { locale: intl, signal: controller.signal }
    const request = mode === 'search' ? searchGifs(search, options)
      : mode === 'trending' ? trendingGifs(options)
      : gifsById(favouriteIds, options).then((gifs) => ({ gifs, next: undefined }))
    request.then(
      (page) => setResults({ key, gifs: page.gifs, next: page.next, loading: false, failed: false }),
      () => { if (!controller.signal.aborted) setResults({ key, gifs: [], loading: false, failed: true }) },
    )
    return () => {
      controller.abort()
      loadingMore.current?.abort()
      loadingMore.current = null
    }
  }, [key, mode, search, intl, favouriteIds])

  // Results of an earlier key are never shown; until the new ones arrive the list is loading.
  const current = useMemo<Results>(() => results?.key === key ? results : { key, gifs: [], loading: true, failed: false }, [results, key])
  const gifs = useMemo(() => {
    return mode === 'favourites' ? current.gifs.filter((gif) => favouriteSet.has(gif.id)) : current.gifs
  }, [current, mode, favouriteSet])

  const loadMore = () => {
    if (!current.next || current.loading || loadingMore.current) return
    const controller = new AbortController()
    loadingMore.current = controller
    const options = { locale: intl, pos: current.next, signal: controller.signal }
    const request = mode === 'search' ? searchGifs(search, options) : trendingGifs(options)
    request.then((page) => {
      setResults((previous) => {
        if (previous?.key !== key) return previous
        // Pages can overlap when the trending list changes in between.
        const known = new Set(previous.gifs.map((gif) => gif.id))
        return { ...previous, gifs: [...previous.gifs, ...page.gifs.filter((gif) => !known.has(gif.id))], next: page.next }
      })
    }, () => {}).finally(() => {
      if (loadingMore.current === controller) loadingMore.current = null
    })
  }

  const toggleFavourite = (gif: Gif) => {
    if (!client) return
    toggleGifFavourite(client, gif.id).catch((error: unknown) => {
      toast.error(describeMatrixError(error, t('gif.favouriteFailed')))
    })
  }

  const first = Math.max(0, Math.floor(scroll / ROW_HEIGHT) - 1) * COLUMNS
  const last = Math.min(gifs.length, (Math.ceil((scroll + HEIGHT) / ROW_HEIGHT) + 1) * COLUMNS)
  const status = current.loading ? t('gif.loading')
    : current.failed ? t('gif.loadFailed')
    : !gifs.length ? (mode === 'favourites' ? t('gif.favouritesEmpty') : t('gif.empty'))
    : null

  return <div className="space-y-2">
    <Input autoFocus aria-label={t('gif.search', { provider: GIF_PROVIDER })} placeholder={t('gif.search', { provider: GIF_PROVIDER })}
      value={query} onChange={(event) => {
        setQuery(event.target.value)
        if (!event.target.value.trim()) setFavouriteIds(favourites)
        resetScroll()
      }} />
    {!query.trim() && <div role="tablist" className="flex gap-1">
      {(['trending', 'favourites'] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={tab === value}
        onClick={() => {
          if (value === 'favourites') setFavouriteIds(favourites)
          setTab(value)
          resetScroll()
        }}
        className={cn('rounded px-2 py-1 text-sm', tab === value ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}>
        {value === 'trending' ? t('gif.trending') : t('gif.favourites')}
      </button>)}
    </div>}
    <div ref={viewport} aria-label={t('gif.picker')} aria-busy={current.loading}
      onScroll={(event) => {
        const element = event.currentTarget
        setScroll(element.scrollTop)
        if (element.scrollTop + element.clientHeight >= element.scrollHeight - LOAD_MORE_PX) loadMore()
      }}
      className="overflow-y-auto overscroll-contain" style={{ height: HEIGHT }}>
      {status && <div role="status" className="space-y-2 p-3 text-sm text-muted-foreground">
        <p>{status}</p>
        {current.failed && <Button size="sm" variant="outline" onClick={() => setAttempt(attempt + 1)}>{t('gif.retry')}</Button>}
      </div>}
      <div className="relative" style={{ height: Math.ceil(gifs.length / COLUMNS) * ROW_HEIGHT }}>
        {gifs.slice(first, last).map((gif, offset) => {
          const index = first + offset
          return <GifTile key={gif.id} gif={gif} favourite={favouriteSet.has(gif.id)} play={autoplay && focused}
            style={{ top: Math.floor(index / COLUMNS) * ROW_HEIGHT, left: `${(index % COLUMNS) * 100 / COLUMNS}%`, width: `${100 / COLUMNS}%`, height: ROW_HEIGHT }}
            onSelect={() => onSelect(gif)} onToggleFavourite={() => toggleFavourite(gif)} />
        })}
      </div>
    </div>
    <p className="text-right text-[11px] text-muted-foreground">
      <a href={GIF_PROVIDER_URL} target="_blank" rel="noopener noreferrer" className="hover:underline">
        {t('gif.poweredBy', { provider: GIF_PROVIDER })}
      </a>
    </p>
  </div>
}

/** Search sends terms and the IP address to the provider, so it stays off until the user agrees. */
function GifOptIn() {
  const { t } = useTranslation()
  return <div className="space-y-3 p-1 text-sm">
    <p className="font-semibold text-foreground">{t('gif.privacyTitle')}</p>
    <p className="text-muted-foreground">{t('gif.privacyHint', { provider: GIF_PROVIDER })}</p>
    <Button size="sm" className="w-full" onClick={() => saveGifSettings({ search: true })}>{t('gif.enable')}</Button>
  </div>
}

export default function GifPickerContent({ onSelect }: { onSelect: (gif: Gif) => void }) {
  const { search } = useSyncExternalStore(subscribeGifSettings, loadGifSettings, getDefaultGifSettings)
  return search ? <GifBrowser onSelect={onSelect} /> : <GifOptIn />
}
