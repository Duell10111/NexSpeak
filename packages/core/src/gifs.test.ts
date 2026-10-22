import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gifsById, klipyLocale, parseGif, searchGifs, trendingGifs } from './gifs'

const format = (url: string, dims = [200, 100], size = 1000) => ({ url, dims, size, duration: 1.5 })
const result = (id: string | number, formats: Record<string, unknown> = {
  tinymp4: format('https://static.klipy.com/tiny.mp4'),
  mediummp4: format('https://static.klipy.com/medium.mp4', [320, 160], 50_000),
  gif: format('https://static.klipy.com/full.gif'),
}) => ({ id, title: ` Dance ${id} `, media_formats: formats })

describe('parseGif', () => {
  it('uses small videos for the picker and the medium video for uploads', () => {
    expect(parseGif(result(7))).toEqual({
      id: '7',
      title: 'Dance 7',
      preview: { url: 'https://static.klipy.com/tiny.mp4', mimetype: 'video/mp4', width: 200, height: 100, size: 1000, duration: 1.5 },
      upload: { url: 'https://static.klipy.com/medium.mp4', mimetype: 'video/mp4', width: 320, height: 160, size: 50_000, duration: 1.5 },
    })
  })

  it('skips renditions that are too large or not https, and falls back to GIF', () => {
    const gif = parseGif(result('a', {
      mediummp4: format('https://static.klipy.com/huge.mp4', [1, 1], 20 * 1024 * 1024),
      mp4: format('http://static.klipy.com/insecure.mp4'),
      gif: { url: 'https://static.klipy.com/a.gif', width: 50, height: 40 },
    }))
    expect(gif?.upload).toEqual({ url: 'https://static.klipy.com/a.gif', mimetype: 'image/gif', width: 50, height: 40 })
    expect(gif?.preview).toEqual(gif?.upload)
  })

  it('rejects results without an id or usable rendition', () => {
    expect(parseGif({ media_formats: {} })).toBeNull()
    expect(parseGif(result('x', { webp: format('https://static.klipy.com/a.webp') }))).toBeNull()
    expect(parseGif('nope')).toBeNull()
  })
})

describe('klipyLocale', () => {
  it('adds the likely region and drops numeric ones', () => {
    expect(klipyLocale('de')).toBe('de_DE')
    expect(klipyLocale('en-GB')).toBe('en_GB')
    expect(klipyLocale('es-419')).toBe('es')
  })
})

describe('KLIPY requests', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_KLIPY_API_KEY', 'public-key')
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    fetchMock.mockReset()
  })
  const respond = (body: unknown, status = 200) => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }))

  it('searches with the public key, locale and paging, without cookies or referrer', async () => {
    respond({ results: [result(1), { broken: true }], next: '24' })
    const page = await searchGifs('cat', { locale: 'de-DE', pos: '12' })
    expect(page).toMatchObject({ gifs: [{ id: '1' }], next: '24' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url.origin + url.pathname).toBe('https://api.klipy.com/v2/search')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ key: 'public-key', q: 'cat', locale: 'de_DE', pos: '12', contentfilter: 'medium' })
    expect(init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' })
  })

  it('ends paging on an empty or zero position', async () => {
    respond({ results: [result(1)], next: '0' })
    expect((await trendingGifs()).next).toBeUndefined()
    respond({ results: [], next: '5' })
    expect((await trendingGifs()).next).toBeUndefined()
  })

  it('returns favourites in the stored order and drops missing ones', async () => {
    respond({ results: [result('b'), result('a')] })
    const gifs = await gifsById(['a', 'gone', 'b'])
    expect(gifs.map((gif) => gif.id)).toEqual(['a', 'b'])
    expect(fetchMock.mock.calls[0][0].searchParams.get('ids')).toBe('a,gone,b')
    expect(await gifsById([])).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails without a key and on HTTP errors', async () => {
    respond({}, 429)
    await expect(trendingGifs()).rejects.toThrow('status 429')
    vi.stubEnv('NEXT_PUBLIC_KLIPY_API_KEY', '')
    await expect(trendingGifs()).rejects.toThrow('No KLIPY API key')
  })
})
