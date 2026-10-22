import { expect, test, type Page } from '@playwright/test'
import { createRoom, getRoomMessages, login, matrixApi, messageRow, newPage, openRoom, registerUser, sendMessage } from './helpers'

async function previewSettings(page: Page, encrypted = false) {
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Einstellungen', exact: true })
  await dialog.getByRole('tab', { name: 'Nachrichten', exact: true }).click()
  await dialog.getByRole('switch', { name: 'Link-Vorschauen anzeigen', exact: true }).check()
  if (encrypted) await dialog.getByRole('switch', { name: 'Links auch in verschlüsselten Räumen anzeigen', exact: true }).check()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
}

async function mockPreviews(page: Page) {
  const requests: string[] = []
  await page.route('**/preview_url**', (route) => {
    const url = new URL(route.request().url()).searchParams.get('url')!
    requests.push(url)
    return route.fulfill({ json: { 'og:title': `Preview: ${new URL(url).pathname}`, 'og:description': '<b>Plain metadata</b>', 'og:image': 'https://tracker.example/pixel.gif' } })
  })
  return requests
}

async function settleVisibility(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

test('link previews require consent, cache once per URL, follow edits and persist sender suppression', async ({ browser }, testInfo) => {
  const alice = await registerUser('linkpreview')
  const roomName = `Preview ${Date.now().toString(36)}`
  const roomId = await createRoom(alice, { name: roomName, members: [] })
  const otherName = `Preview other ${Date.now().toString(36)}`
  await createRoom(alice, { name: otherName, members: [] })
  const page = await newPage(browser)
  const requests = await mockPreviews(page)
  const externalRequests: string[] = []
  page.on('request', (request) => { if (new URL(request.url()).hostname === 'tracker.example') externalRequests.push(request.url()) })
  await login(page, alice)
  await openRoom(page, roomName)
  const original = 'https://example.org/first https://example.org/second'
  await sendMessage(page, original)
  const row = messageRow(page, original)
  await expect(row).toBeVisible()
  await settleVisibility(page)
  expect(requests).toEqual([])
  await previewSettings(page)
  const card = row.getByRole('link', { name: 'Link-Vorschau öffnen', exact: true })
  await expect(card).toContainText('Preview: /first')
  await expect(card).toContainText('<b>Plain metadata</b>')
  await expect(card.locator('b')).toHaveCount(0)
  expect(requests).toEqual(['https://example.org/first'])
  expect(externalRequests).toEqual([])
  await card.screenshot({ path: testInfo.outputPath('link-preview.png') })
  await openRoom(page, otherName)
  await sendMessage(page, 'https://example.org/first#another-fragment')
  await expect(page.getByRole('link', { name: 'Link-Vorschau öffnen', exact: true })).toContainText('Preview: /first')
  expect(requests).toHaveLength(1)
  await openRoom(page, roomName)
  await expect(card).toBeVisible()
  await row.hover()
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click()
  const editor = page.getByRole('textbox', { name: 'Nachricht bearbeiten', exact: true })
  await editor.fill('https://example.org/edited')
  await editor.press('Enter')
  const edited = messageRow(page, 'https://example.org/edited')
  await expect(edited.getByRole('link', { name: 'Link-Vorschau öffnen', exact: true })).toContainText('Preview: /edited')
  expect(requests).toEqual(['https://example.org/first', 'https://example.org/edited'])
  await expect(edited).not.toHaveClass(/opacity-60/)
  await edited.hover()
  await edited.getByRole('button', { name: 'Mehr', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Link-Vorschau ausblenden', exact: true }).click()
  await expect(edited.getByRole('link', { name: 'Link-Vorschau öffnen', exact: true })).toHaveCount(0)
  await expect.poll(async () => (await getRoomMessages(alice, roomId)).some((event) =>
    (event.content['m.new_content'] as Record<string, unknown> | undefined)?.['org.nexspeak.hide_link_previews'] === true)).toBe(true)
  await page.reload()
  await openRoom(page, roomName)
  await expect(messageRow(page, 'https://example.org/edited')).toBeVisible()
  await settleVisibility(page)
  expect(requests).toHaveLength(2)
  await page.context().close()
})

test('encrypted link previews need separate consent and respect a sender-hidden message on another client', async ({ browser }) => {
  const alice = await registerUser('secretpreviewalice')
  const bob = await registerUser('secretpreviewbob')
  const name = `Secret previews ${Date.now().toString(36)}`
  await createRoom(alice, { name, members: [bob], encrypted: true })
  const alicePage = await newPage(browser)
  const bobPage = await newPage(browser)
  const aliceRequests = await mockPreviews(alicePage)
  const bobRequests = await mockPreviews(bobPage)
  await login(alicePage, alice)
  await login(bobPage, bob)
  await openRoom(alicePage, name)
  await openRoom(bobPage, name)
  await previewSettings(bobPage)
  await sendMessage(alicePage, 'https://example.org/encrypted')
  await expect(messageRow(bobPage, 'https://example.org/encrypted')).toBeVisible()
  await settleVisibility(bobPage)
  expect(bobRequests).toEqual([])
  expect(aliceRequests).toEqual([])
  await previewSettings(bobPage, true)
  await expect(bobPage.getByRole('link', { name: 'Link-Vorschau öffnen', exact: true })).toContainText('Preview: /encrypted')
  const composer = alicePage.getByRole('textbox', { name: 'Nachricht', exact: true })
  await composer.fill('https://example.org/sender-private')
  await alicePage.getByRole('button', { name: 'Link-Vorschau für diese Nachricht ausblenden', exact: true }).click()
  await composer.press('Enter')
  const hidden = messageRow(bobPage, 'https://example.org/sender-private')
  await expect(hidden).toBeVisible()
  await settleVisibility(bobPage)
  await expect(hidden.getByRole('link', { name: 'Link-Vorschau öffnen', exact: true })).toHaveCount(0)
  expect(bobRequests).toEqual(['https://example.org/encrypted'])
  expect(aliceRequests).toEqual([])
  // A later encrypted edit must also be checked before a new client discloses the original URL.
  const original = messageRow(alicePage, 'https://example.org/encrypted')
  await expect(original).not.toHaveClass(/opacity-60/)
  await original.hover()
  await original.getByRole('button', { name: 'Mehr', exact: true }).click()
  await alicePage.getByRole('menuitem', { name: 'Link-Vorschau ausblenden', exact: true }).click()
  await expect(messageRow(bobPage, 'https://example.org/encrypted').getByRole('link', { name: 'Link-Vorschau öffnen', exact: true })).toHaveCount(0)
  await bobPage.reload()
  await openRoom(bobPage, name)
  await expect(messageRow(bobPage, 'https://example.org/encrypted')).toBeVisible()
  await settleVisibility(bobPage)
  expect(bobRequests).toEqual(['https://example.org/encrypted'])
  await alicePage.context().close()
  await bobPage.context().close()
})

test('link previews only fetch visible messages while the document is visible', async ({ browser }) => {
  const alice = await registerUser('visiblepreview')
  const name = `Visible previews ${Date.now().toString(36)}`
  const roomId = await createRoom(alice, { name, members: [] })
  await matrixApi(alice, 'PUT', `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/first`, { msgtype: 'm.text', body: 'https://example.org/history' })
  for (let i = 0; i < 12; i++) await matrixApi(alice, 'PUT', `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/filler${i}`, { msgtype: 'm.text', body: Array.from({ length: 6 }, (_, n) => `Filler ${i} line ${n}`).join('\n') })
  const page = await newPage(browser)
  const requests = await mockPreviews(page)
  await page.addInitScript(() => localStorage.setItem('nexspeak_link_preview_settings', '{"enabled":true,"encrypted":false}'))
  await login(page, alice)
  await openRoom(page, name)
  await expect(messageRow(page, 'Filler 11 line 5')).toBeVisible()
  await settleVisibility(page)
  expect(requests).toEqual([])
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  const row = messageRow(page, 'https://example.org/history')
  await row.scrollIntoViewIfNeeded()
  await settleVisibility(page)
  expect(requests).toEqual([])
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(row.getByRole('link', { name: 'Link-Vorschau öffnen', exact: true })).toContainText('Preview: /history')
  expect(requests).toEqual(['https://example.org/history'])
  await page.context().close()
})

test('preview images are authenticated still thumbnails and release their object URLs offscreen', async ({ browser }) => {
  const alice = await registerUser('previewimage')
  const name = `Preview images ${Date.now().toString(36)}`
  await createRoom(alice, { name, members: [] })
  const page = await newPage(browser)
  await page.addInitScript(() => {
    localStorage.setItem('nexspeak_link_preview_settings', '{"enabled":true,"encrypted":false}')
    const original = URL.revokeObjectURL
    const urls: string[] = []
    Object.assign(window, { revokedPreviews: urls })
    URL.revokeObjectURL = (url) => { urls.push(url); original(url) }
  })
  await page.route('**/preview_url**', (route) => {
    const url = new URL(new URL(route.request().url()).searchParams.get('url')!)
    return route.fulfill({ json: { 'og:title': url.pathname, 'og:image': `mxc://preview.example/${url.pathname.includes('animated') ? 'animated' : 'still'}` } })
  })
  const imageRequests = new Set<string>()
  await page.route('**/thumbnail/preview.example/**', (route) => {
    imageRequests.add(new URL(route.request().url()).pathname)
    expect(route.request().headers().authorization).toMatch(/^Bearer \S+$/)
    const animated = route.request().url().includes('/animated')
    return route.fulfill({ contentType: animated ? 'image/gif' : 'image/png', body: animated ? Buffer.from('GIF89a') : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64') })
  })
  await login(page, alice)
  await openRoom(page, name)
  await sendMessage(page, 'https://example.org/still')
  const row = messageRow(page, 'https://example.org/still')
  const image = row.locator('[data-link-preview-url] img')
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1)
  const blob = await image.getAttribute('src')
  await sendMessage(page, Array.from({ length: 50 }, (_, index) => `Hide preview line ${index}`).join('\n'))
  await expect(image).toHaveCount(0)
  await expect.poll(() => page.evaluate((url) => (window as unknown as { revokedPreviews: string[] }).revokedPreviews.includes(url!), blob)).toBe(true)
  await sendMessage(page, 'https://example.org/animated')
  const animated = messageRow(page, 'https://example.org/animated')
  await expect(animated.getByRole('link', { name: 'Link-Vorschau öffnen', exact: true })).toBeVisible()
  await expect.poll(() => imageRequests.size).toBe(2)
  await settleVisibility(page)
  await expect(animated.locator('[data-link-preview-url] img')).toHaveCount(0)
  await expect(animated.locator('video, audio, iframe')).toHaveCount(0)
  await page.context().close()
})
