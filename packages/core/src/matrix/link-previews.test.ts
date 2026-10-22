import { describe, expect, it, vi } from 'vitest'
import { MatrixEvent, type MatrixClient } from 'matrix-js-sdk'
import { firstPreviewUrl, isStaticPreviewImage, loadLinkPreview, previewUrl, sanitizePreview, verifiedPreviewUrl } from './link-previews'
import { parseFormattedBody } from './formatted-body'

describe('link preview privacy and metadata', () => {
  it('accepts HTTP links while removing fragments and rejecting credentials, local and Matrix destinations', () => {
    expect(previewUrl('https://example.org/path?q=yes#secret')).toBe('https://example.org/path?q=yes')
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'https://me:secret@example.org', 'http://localhost/x', 'http://127.1/x', 'http://0x7f000001/x', 'http://192.168.0.1', 'http://172.20.0.1', 'http://[::1]', 'https://matrix.to/#/@user:example.org', 'https://printer.local/x']) expect(previewUrl(url)).toBeNull()
  })
  it('extracts one actual link, excluding code, quotes, collapsed details, spoilers and mention labels', () => {
    expect(firstPreviewUrl('first https://example.org/a. next https://second.example/a')).toBe('https://example.org/a')
    const nodes = parseFormattedBody('<pre>https://code.example</pre><span data-mx-spoiler>https://secret.example</span><blockquote>https://quote.example</blockquote><details>https://collapsed.example</details><a href="https://matrix.to/#/@me:example.org">https://label.example</a><a href="https://actual.example/path">Label</a>')
    expect(firstPreviewUrl('ignored fallback https://fallback.example', nodes)).toBe('https://actual.example/path')
  })
  it('bounds text, renders metadata as data and only accepts MXC images', () => {
    expect(sanitizePreview({ 'og:title': '<script>bad()</script>\u202e', 'og:description': 'x'.repeat(1000), 'og:image': 'https://tracker.example/image' })).toEqual({ title: '<script>bad()</script>', description: 'x'.repeat(700), imageMxc: undefined })
    expect(sanitizePreview({ 'og:image': 'mxc://example.org/static' })?.imageMxc).toBe('mxc://example.org/static')
    expect(sanitizePreview({ 'og:image': 'mxc://example.org/static?secret=1', 'og:title': 123 })).toBeNull()
    expect(sanitizePreview([])).toBeNull()
  })
  it('deduplicates requests and caches success and failures once per URL per client session', async () => {
    const getUrlPreview = vi.fn().mockResolvedValueOnce({ 'og:title': 'First' }).mockRejectedValueOnce(new Error('Disabled by server'))
    const client = { getUrlPreview } as unknown as MatrixClient
    const [a, b] = await Promise.all([loadLinkPreview(client, 'https://example.org/a#x'), loadLinkPreview(client, 'https://example.org/a#y')])
    expect(a).toEqual(b)
    expect(getUrlPreview).toHaveBeenCalledTimes(1)
    await loadLinkPreview(client, 'https://example.org/disabled')
    await loadLinkPreview(client, 'https://example.org/disabled')
    expect(getUrlPreview).toHaveBeenCalledTimes(2)
    await loadLinkPreview(client, 'http://127.0.0.1')
    expect(getUrlPreview).toHaveBeenCalledTimes(2)
  })
  it('bounds session metadata without evicting and refetching old URLs', async () => {
    const getUrlPreview = vi.fn().mockResolvedValue({ 'og:title': 'Cached' })
    const client = { getUrlPreview } as unknown as MatrixClient
    for (let i = 0; i < 512; i++) await loadLinkPreview(client, `https://example.org/${i}`)
    expect(await loadLinkPreview(client, 'https://example.org/extra')).toBeNull()
    await loadLinkPreview(client, 'https://example.org/0')
    expect(getUrlPreview).toHaveBeenCalledTimes(512)
  })
  it('accepts still raster formats and rejects animated images and SVG', () => {
    expect(isStaticPreviewImage(new Uint8Array([255, 216, 255]))).toBe(true)
    const png = (chunk: string) => Uint8Array.from([...Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), 0, 0, 0, 0, ...Buffer.from(chunk), 0, 0, 0, 0])
    expect(isStaticPreviewImage(png('IEND'))).toBe(true)
    expect(isStaticPreviewImage(png('acTL'))).toBe(false)
    expect(isStaticPreviewImage(Buffer.from('GIF89a'))).toBe(false)
    expect(isStaticPreviewImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(false)
    expect(isStaticPreviewImage(Buffer.from('RIFF0000WEBPANIM\x00\x00\x00\x00', 'latin1'))).toBe(false)
  })
})


describe('sender preference verification before URL disclosure', () => {
  const original = () => new MatrixEvent({ room_id: '!r', event_id: '$original', sender: '@alice:example.org', type: 'm.room.message', content: { msgtype: 'm.text', body: 'https://example.org/old' } })
  const replacement = (content: Record<string, unknown>) => ({
    event_id: '$edit', sender: '@alice:example.org', type: 'm.room.message',
    content: { 'm.relates_to': { rel_type: 'm.replace', event_id: '$original' }, 'm.new_content': { msgtype: 'm.text', body: 'https://example.org/new', ...content } },
  })
  const fake = (edit?: unknown) => ({
    isVersionSupported: vi.fn().mockResolvedValue(true),
    decryptEventIfNeeded: vi.fn().mockResolvedValue(undefined),
    fetchRoomEvent: vi.fn().mockResolvedValue({ ...original().event, unsigned: edit ? { 'm.relations': { 'm.replace': edit } } : {} }),
  })
  it('rejects stale sync content when the latest sender edit suppresses previews', async () => {
    const client = fake(replacement({ 'org.nexspeak.hide_link_previews': true }))
    expect(await verifiedPreviewUrl(client as unknown as MatrixClient, original())).toBeNull()
    expect(await verifiedPreviewUrl(client as unknown as MatrixClient, original())).toBeNull()
    expect(client.fetchRoomEvent).toHaveBeenCalledTimes(1)
  })
  it('returns the current edited URL instead of disclosing the stale original URL', async () => {
    const client = fake(replacement({}))
    expect(await verifiedPreviewUrl(client as unknown as MatrixClient, original())).toBe('https://example.org/new')
  })
  it('accepts verified unchanged content and fails closed for unsupported or failed verification', async () => {
    const client = fake()
    expect(await verifiedPreviewUrl(client as unknown as MatrixClient, original())).toBe('https://example.org/old')
    const unsupported = fake()
    unsupported.isVersionSupported.mockResolvedValue(false)
    expect(await verifiedPreviewUrl(unsupported as unknown as MatrixClient, original())).toBeNull()
    expect(unsupported.fetchRoomEvent).not.toHaveBeenCalled()
    const failed = fake()
    failed.fetchRoomEvent.mockRejectedValue(new Error('Offline'))
    expect(await verifiedPreviewUrl(failed as unknown as MatrixClient, original())).toBeNull()
    const unreadable = fake()
    unreadable.decryptEventIfNeeded.mockRejectedValue(new Error('Missing decryption keys'))
    expect(await verifiedPreviewUrl(unreadable as unknown as MatrixClient, original())).toBeNull()
  })
  it('ignores the legacy quoted URL in a plain-text reply fallback', async () => {
    const client = fake()
    client.fetchRoomEvent.mockResolvedValue({ ...original().event, content: {
      msgtype: 'm.text', body: '> <@alice:example.org> https://quoted.example/old\n\nhttps://actual.example/reply',
      'm.relates_to': { 'm.in_reply_to': { event_id: '$reply' } },
    }, unsigned: {} })
    expect(await verifiedPreviewUrl(client as unknown as MatrixClient, original())).toBe('https://actual.example/reply')
  })
  it('rejects malformed and forged replacement bundles', async () => {
    for (const edit of [{ event_id: '$old-format' }, { ...replacement({}), sender: '@mallory:example.org' }]) {
      expect(await verifiedPreviewUrl(fake(edit) as unknown as MatrixClient, original())).toBeNull()
    }
  })
})
