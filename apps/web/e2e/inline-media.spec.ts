import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { createRoom, HOMESERVER_URL, login, matrixApi, messageRow, newPage, openRoom, registerUser, sendMessage } from './helpers'

// Ten seconds of blue H.264 Baseline video, 160x90 at one frame per second.
const VIDEO = readFileSync(resolve(__dirname, 'fixtures/blue.mp4'))
const AUDIO = readFileSync(resolve(__dirname, '../public/sounds/chime.mp3'))
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')

for (const encrypted of [false, true]) {
  test(`inline audio loads on Play and releases when hidden, offscreen or switching rooms (${encrypted ? 'encrypted' : 'plain'})`, async ({ browser }) => {
    const alice = await registerUser('inlineaudio')
    const name = `Audio ${Date.now().toString(36)}`
    await createRoom(alice, { name, members: [], encrypted })
    const other = `Other audio ${Date.now().toString(36)}`
    await createRoom(alice, { name: other, members: [] })
    const page = await newPage(browser)
    await page.addInitScript(() => {
      const original = URL.revokeObjectURL
      const urls: string[] = []
      Object.assign(window, { revokedMedia: urls })
      URL.revokeObjectURL = (url: string) => { urls.push(url); original(url) }
    })
    const requests: string[] = []
    page.on('request', (request) => { if (request.url().includes('/download/')) requests.push(request.url()) })
    await login(page, alice)
    await openRoom(page, name)
    await page.locator('input[type="file"]').setInputFiles({ name: 'chime.mp3', mimeType: 'audio/mpeg', buffer: AUDIO })
    const row = messageRow(page, 'chime.mp3')
    const audio = row.locator('audio')
    await expect(audio).toBeVisible()
    await expect(row).not.toHaveClass(/opacity-60/)
    await expect(audio).toHaveAttribute('preload', 'none')
    await expect(audio).not.toHaveAttribute('src')
    expect(requests).toHaveLength(0)
    if (encrypted) await expect(row.getByLabel('Verschlüsselt', { exact: true })).toBeVisible()
    await row.getByRole('button', { name: 'Abspielen', exact: true }).click()
    await expect(audio).toHaveAttribute('src', /^blob:/)
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.readyState)).toBeGreaterThanOrEqual(2)
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0)
    expect(requests).toHaveLength(1)
    const url = await audio.getAttribute('src')
    await sendMessage(page, Array.from({ length: 50 }, (_, index) => `Line ${index}`).join('\n'))
    await expect(audio).not.toHaveAttribute('src')
    await expect.poll(() => page.evaluate((value) => (window as unknown as { revokedMedia: string[] }).revokedMedia.includes(value!), url)).toBe(true)
    await audio.scrollIntoViewIfNeeded()
    await expect(row.getByRole('button', { name: 'Abspielen', exact: true })).toBeVisible()
    expect(requests).toHaveLength(1)
    await row.getByRole('button', { name: 'Abspielen', exact: true }).click()
    await expect(audio).toHaveAttribute('src', /^blob:/)
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect(audio).not.toHaveAttribute('src')
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await row.getByRole('button', { name: 'Abspielen', exact: true }).click()
    await expect(audio).toHaveAttribute('src', /^blob:/)
    const lastUrl = await audio.getAttribute('src')
    await openRoom(page, other)
    await expect.poll(() => page.evaluate((value) => (window as unknown as { revokedMedia: string[] }).revokedMedia.includes(value!), lastUrl)).toBe(true)
    await page.context().close()
  })
}

test('inline video shows a separate preview, native controls and a download fallback', async ({ browser }) => {
  const alice = await registerUser('inlinevideo')
  const name = `Video ${Date.now().toString(36)}`
  const roomId = await createRoom(alice, { name, members: [] })
  const upload = async (body: Buffer, type: string) => {
    const response = await fetch(`${HOMESERVER_URL}/_matrix/media/v3/upload`, {
      method: 'POST', headers: { Authorization: `Bearer ${alice.accessToken}`, 'Content-Type': type }, body: new Uint8Array(body),
    })
    expect(response.ok).toBe(true)
    return (await response.json()).content_uri as string
  }
  const mxc = await upload(VIDEO, 'video/mp4')
  const thumbnail = await upload(PNG, 'image/png')
  await matrixApi(alice, 'PUT', `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/video`, {
    msgtype: 'm.video', body: 'blue.mp4', url: mxc,
    info: { mimetype: 'video/mp4', w: 160, h: 90, thumbnail_url: thumbnail, thumbnail_info: { mimetype: 'image/png' } },
  })
  const page = await newPage(browser)
  const requests: string[] = []
  page.on('request', (request) => { if (request.url().includes(mxc.split('/').pop()!)) requests.push(request.url()) })
  await login(page, alice)
  await openRoom(page, name)
  const row = messageRow(page, 'blue.mp4')
  const video = row.locator('video')
  await expect(video).toHaveAttribute('poster', /^blob:/)
  await expect(video).toHaveAttribute('controls')
  await expect(video).toHaveAttribute('preload', 'none')
  expect(requests).toHaveLength(0)
  await row.getByRole('button', { name: 'Abspielen', exact: true }).click()
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBe(160)
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0)
  expect(requests).toHaveLength(1)
  // Unsupported formats surface a recoverable failure, while Download stays available.
  await video.evaluate((element) => element.dispatchEvent(new Event('error')))
  await expect(row.getByRole('alert')).toContainText('Wiedergabe nicht möglich')
  await expect(video).not.toHaveAttribute('src')
  const download = page.waitForEvent('download')
  await row.getByRole('button', { name: 'Herunterladen', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('blue.mp4')
  await page.context().close()
})
