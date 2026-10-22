import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { createRoom, getRoomMessages, login, matrixApi, newPage, openRoom, registerUser, type TestUser } from './helpers'

const VIDEO = readFileSync(resolve(__dirname, 'fixtures/blue.mp4'))
const CDN = 'https://static.klipy.com/e2e'

function klipyResult(id: string, title: string) {
  const format = (name: string) => ({ url: `${CDN}/${id}-${name}.mp4`, dims: [160, 90], size: VIDEO.length, duration: 1 })
  return { id, title, media_formats: { tinymp4: format('tiny'), mediummp4: format('medium') } }
}

/** KLIPY's API and CDN are mocked; every request is recorded to check what reaches the provider. */
async function mockKlipy(page: Page) {
  const api: URL[] = []
  const cdn: string[] = []
  await page.route('https://api.klipy.com/**', (route) => {
    const url = new URL(route.request().url())
    api.push(url)
    const q = url.searchParams.get('q')
    const results = url.pathname.endsWith('/posts')
      ? (url.searchParams.get('ids') ?? '').split(',').map((id) => klipyResult(id, `Favourite ${id}`))
      : q ? [klipyResult('search1', `Found ${q}`)]
      : [klipyResult('trend1', 'Dancing cat'), klipyResult('trend2', 'Waving dog')]
    return route.fulfill({ json: { results, next: '' }, headers: { 'Access-Control-Allow-Origin': '*' } })
  })
  await page.route(`${CDN}/**`, (route) => {
    cdn.push(route.request().url())
    return route.fulfill({ body: VIDEO, contentType: 'video/mp4', headers: { 'Access-Control-Allow-Origin': '*' } })
  })
  return { api, cdn }
}

async function favourites(user: TestUser) {
  try {
    return await matrixApi<{ gifs: Array<{ provider: string; id: string }> }>(user, 'GET', `/user/${encodeURIComponent(user.userId)}/account_data/io.nexspeak.gif_favourites`)
  } catch {
    return null
  }
}

const gifRow = (page: Page, title: string) => page.locator('[id^="msg-"]').filter({ has: page.getByRole('img', { name: title, exact: true }) }).last()

for (const encrypted of [false, true]) {
  test(`GIF picker is opt-in, searches, keeps favourites and sends an uploaded looping video${encrypted ? ' (encrypted)' : ''}`, async ({ browser }) => {
    const alice = await registerUser(encrypted ? 'gifsenc' : 'gifs')
    const name = `GIFs ${Date.now().toString(36)}`
    const roomId = await createRoom(alice, { name, members: [], encrypted })
    const page = await newPage(browser)
    const klipy = await mockKlipy(page)
    await login(page, alice)
    await openRoom(page, name)
    const composer = page.getByRole('textbox', { name: 'Nachricht', exact: true })
    await composer.fill('Unsent draft')

    // Nothing reaches the provider before the user agrees.
    await page.getByRole('button', { name: 'GIF senden', exact: true }).click()
    await expect(page.getByText('GIF-Suche einschalten?')).toBeVisible()
    expect(klipy.api).toHaveLength(0)
    await page.getByRole('button', { name: 'GIF-Suche einschalten', exact: true }).click()

    const picker = page.getByLabel('GIF auswählen', { exact: true })
    await expect(picker.getByRole('button', { name: 'Dancing cat', exact: true })).toBeVisible()
    expect(klipy.api[0].pathname).toBe('/v2/featured')
    expect(klipy.api[0].searchParams.get('key')).toBe('e2e-klipy-key')
    expect(klipy.api[0].searchParams.get('locale')).toBe('de_DE')

    await picker.getByRole('button', { name: 'Waving dog', exact: true }).hover()
    await picker.getByRole('button', { name: 'Zu Favoriten hinzufügen' }).nth(1).click()
    await expect.poll(async () => (await favourites(alice))?.gifs).toEqual([{ provider: 'klipy', id: 'trend2' }])
    await page.getByRole('tab', { name: 'Favoriten', exact: true }).click()
    await expect(picker.getByRole('button', { name: 'Favourite trend2', exact: true })).toBeVisible()

    await page.getByRole('textbox', { name: 'KLIPY durchsuchen', exact: true }).fill('party')
    await expect(picker.getByRole('button', { name: 'Found party', exact: true })).toBeVisible()
    expect(klipy.api.at(-1)?.searchParams.get('q')).toBe('party')
    await picker.getByRole('button', { name: 'Found party', exact: true }).click()
    await expect(composer).toHaveValue('Unsent draft')

    // Uploaded to the homeserver as a looping, silent video with a thumbnail.
    await expect.poll(async () => (await getRoomMessages(alice, roomId)).some((event) => event.type === (encrypted ? 'm.room.encrypted' : 'm.room.message'))).toBe(true)
    if (!encrypted) {
      const event = (await getRoomMessages(alice, roomId)).find((candidate) => candidate.content.msgtype === 'm.video')
      expect(event?.content).toMatchObject({
        body: 'Found party',
        url: expect.stringMatching(/^mxc:\/\//),
        info: { mimetype: 'video/mp4', w: 160, h: 90, 'fi.mau.gif': true, 'fi.mau.loop': true, thumbnail_url: expect.stringMatching(/^mxc:\/\//) },
      })
    }
    expect(klipy.cdn.filter((url) => url.endsWith('-medium.mp4'))).toEqual([`${CDN}/search1-medium.mp4`])

    // Received GIFs play from the homeserver, only while the window is focused.
    const row = gifRow(page, 'Found party')
    const video = row.locator('video')
    await expect(video).toHaveAttribute('src', /^blob:/)
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => !element.paused && element.loop && element.muted)).toBe(true)
    await page.evaluate(() => { Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false }); window.dispatchEvent(new Event('blur')) })
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
    await expect(row.getByText('GIF', { exact: true })).toBeVisible()
    await page.evaluate(() => { Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true }); window.dispatchEvent(new Event('focus')) })
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false)
    await page.context().close()
  })
}

test('with "Play GIFs automatically" off, GIFs show a still frame until hovered or clicked', async ({ browser }) => {
  const alice = await registerUser('gifautoplay')
  const name = `GIF autoplay ${Date.now().toString(36)}`
  const roomId = await createRoom(alice, { name, members: [] })
  const response = await fetch('http://localhost:8008/_matrix/media/v3/upload', {
    method: 'POST', headers: { Authorization: `Bearer ${alice.accessToken}`, 'Content-Type': 'video/mp4' }, body: new Uint8Array(VIDEO),
  })
  const { content_uri: mxc } = await response.json() as { content_uri: string }
  await matrixApi(alice, 'PUT', `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/bridged`, {
    msgtype: 'm.video', body: 'Bridged GIF', url: mxc,
    info: { mimetype: 'video/mp4', w: 160, h: 90, 'fi.mau.loop': true, 'fi.mau.autoplay': true },
  })
  const page = await newPage(browser)
  await login(page, alice)
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click()
  await page.getByRole('tab', { name: 'Nachrichten', exact: true }).click()
  await page.getByRole('switch', { name: 'GIFs automatisch abspielen' }).click()
  await page.keyboard.press('Escape')
  await openRoom(page, name)
  const play = page.getByRole('button', { name: 'Bridged GIF – GIF abspielen', exact: true })
  // The button's name changes with its state; the GIF is the only looping video in the room.
  const video = page.locator('video[loop]')
  await expect(video).toHaveCount(1)
  // Without a thumbnail the paused video loads to show its first frame.
  await expect(video).toHaveAttribute('src', /^blob:/)
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
  await play.hover()
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false)
  await page.mouse.move(0, 0)
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
  await play.click()
  await page.mouse.move(0, 0)
  await expect(page.getByRole('button', { name: 'Bridged GIF – GIF anhalten', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false)
  await page.context().close()
})
