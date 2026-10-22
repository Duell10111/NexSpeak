/**
 * GIF search through KLIPY's Tenor-compatible API (https://docs.klipy.com/migrate-from-tenor).
 * The key is a public client key baked into the static build; without one, GIF search is hidden.
 * Only the picker talks to KLIPY: sent GIFs are uploaded to the homeserver like any attachment.
 */

const BASE_URL = 'https://api.klipy.com/v2'
const CLIENT_KEY = 'nexspeak'
const PAGE_SIZE = 24
/** KLIPY limits the posts endpoint to 50 ids per request. */
export const MAX_GIF_IDS = 50
/** Uploads above this size fall back to a smaller rendition. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
/** Small video previews for the picker; video uploads (hardware decoded, far smaller than GIF); GIF as last resort. */
const PREVIEW_FORMATS = ['tinymp4', 'tinywebm', 'nanomp4', 'tinygif', 'nanogif'] as const
const UPLOAD_FORMATS = ['mediummp4', 'mp4', 'tinymp4', 'mediumgif', 'gif', 'tinygif'] as const
const MEDIA_FILTER = [...new Set([...PREVIEW_FORMATS, ...UPLOAD_FORMATS])].join(',')

export const GIF_PROVIDER = 'KLIPY'
export const GIF_PROVIDER_URL = 'https://klipy.com'

export function gifApiKey(): string {
  return process.env.NEXT_PUBLIC_KLIPY_API_KEY?.trim() ?? ''
}

export interface GifRendition {
  url: string
  mimetype: string
  width: number
  height: number
  size?: number
  /** Seconds. */
  duration?: number
}

export interface Gif {
  id: string
  title: string
  preview: GifRendition
  upload: GifRendition
}

export interface GifPage {
  gifs: Gif[]
  /** Pass to the next request; missing when there are no more results. */
  next?: string
}

export interface GifRequest {
  /** UI locale such as "de" or "en-US"; KLIPY expects "de_DE". */
  locale?: string
  pos?: string
  signal?: AbortSignal
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function rendition(format: string, value: unknown): GifRendition | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as { url?: unknown; dims?: unknown; width?: unknown; height?: unknown; size?: unknown; duration?: unknown }
  if (typeof entry.url !== 'string' || !entry.url.startsWith('https://')) return null
  const dims = Array.isArray(entry.dims) ? entry.dims : []
  const size = number(entry.size)
  const duration = number(entry.duration)
  return {
    url: entry.url,
    mimetype: format.endsWith('mp4') ? 'video/mp4' : format.endsWith('webm') ? 'video/webm' : 'image/gif',
    width: number(dims[0]) || number(entry.width),
    height: number(dims[1]) || number(entry.height),
    ...(size && { size }),
    ...(duration && { duration }),
  }
}

function pick(formats: Record<string, unknown>, order: readonly string[], fits?: (found: GifRendition) => boolean) {
  for (const format of order) {
    const found = rendition(format, formats[format])
    if (found && (!fits || fits(found))) return found
  }
  return null
}

export function parseGif(value: unknown): Gif | null {
  if (!value || typeof value !== 'object') return null
  const result = value as { id?: unknown; title?: unknown; content_description?: unknown; media_formats?: unknown }
  const id = typeof result.id === 'number' ? String(result.id) : result.id
  if (typeof id !== 'string' || !id || !result.media_formats || typeof result.media_formats !== 'object') return null
  const formats = result.media_formats as Record<string, unknown>
  const upload = pick(formats, UPLOAD_FORMATS, (found) => !found.size || found.size <= MAX_UPLOAD_BYTES)
  if (!upload) return null
  const title = [result.title, result.content_description].find((text) => typeof text === 'string' && text.trim())
  return { id, title: typeof title === 'string' ? title.trim() : '', preview: pick(formats, PREVIEW_FORMATS) ?? upload, upload }
}

/** "de" → "de_DE"; KLIPY rejects numeric regions such as "es-419". */
export function klipyLocale(locale: string): string {
  try {
    const { language, region } = new Intl.Locale(locale).maximize()
    return region && !/^\d+$/.test(region) ? `${language}_${region}` : language
  } catch {
    return 'en_US'
  }
}

async function request(endpoint: string, params: Record<string, string>, { locale, pos, signal }: GifRequest): Promise<GifPage> {
  const key = gifApiKey()
  if (!key) throw new Error('No KLIPY API key configured')
  const url = new URL(`${BASE_URL}/${endpoint}`)
  const query = {
    key,
    client_key: CLIENT_KEY,
    media_filter: MEDIA_FILTER,
    contentfilter: 'medium',
    ...(locale && { locale: klipyLocale(locale) }),
    ...(pos && { pos }),
    ...params,
  }
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)
  // No cookies and no referrer: KLIPY only learns what the search needs.
  const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
  if (!response.ok) throw new Error(`KLIPY ${endpoint} request failed with status ${response.status}`)
  const body = (await response.json()) as { results?: unknown; next?: unknown }
  const gifs = Array.isArray(body.results) ? body.results.map(parseGif).filter((gif): gif is Gif => gif !== null) : []
  const next = typeof body.next === 'string' && body.next && body.next !== '0' && gifs.length ? body.next : undefined
  return { gifs, ...(next && { next }) }
}

export function trendingGifs(options: GifRequest = {}): Promise<GifPage> {
  return request('featured', { limit: String(PAGE_SIZE) }, options)
}

export function searchGifs(query: string, options: GifRequest = {}): Promise<GifPage> {
  return request('search', { q: query, limit: String(PAGE_SIZE) }, options)
}

/** Favourites are stored as ids; results keep the order of `ids`. */
export async function gifsById(ids: readonly string[], options: GifRequest = {}): Promise<Gif[]> {
  const wanted = ids.slice(0, MAX_GIF_IDS)
  if (!wanted.length) return []
  const { gifs } = await request('posts', { ids: wanted.join(',') }, { ...options, pos: undefined })
  const byId = new Map(gifs.map((gif) => [gif.id, gif]))
  return wanted.map((id) => byId.get(id)).filter((gif): gif is Gif => gif !== undefined)
}
