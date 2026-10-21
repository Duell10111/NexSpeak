import { expect, test, type Page } from '@playwright/test'
import { createRoom, createSpace, getRoomMessages, getState, HOMESERVER_URL, login, messageRow, newPage, openRoom, registerUser, sendMessage, type TestUser } from './helpers'

// Two-frame GIF, one pixel per frame, red then blue.
const GIF = Buffer.from('47494638396101000100800000ff00000000ff21ff0b4e45545343415045322e30030100000021f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b', 'hex')

async function put(user: TestUser, path: string, content: unknown) {
  const response = await fetch(`${HOMESERVER_URL}/_matrix/client/v3${path}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${user.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(content),
  })
  expect(response.ok, await response.text()).toBe(true)
}
async function upload(user: TestUser) {
  const response = await fetch(`${HOMESERVER_URL}/_matrix/media/v3/upload`, {
    method: 'POST', headers: { Authorization: `Bearer ${user.accessToken}`, 'Content-Type': 'image/gif' }, body: GIF,
  })
  expect(response.ok).toBe(true)
  return (await response.json()).content_uri as string
}
async function picker(page: Page) {
  await page.getByRole('button', { name: 'Emoji einfügen', exact: true }).click()
  await page.getByRole('tab', { name: 'Sticker', exact: true }).click()
  return page.getByRole('listbox', { name: 'Sticker auswählen' })
}
async function settings(page: Page) {
  await page.getByRole('button', { name: 'Servermenü' }).click()
  await page.getByRole('menuitem', { name: 'Servereinstellungen', exact: true }).click()
  await page.getByRole('tab', { name: 'Server-Emojis', exact: true }).click()
  await page.getByRole('tab', { name: 'Sticker', exact: true }).click()
  return page.getByRole('dialog')
}

test('server sticker upload, send without clearing draft, render, rename and delete', async ({ browser }) => {
  const alice = await registerUser('stickers')
  const name = `Stickers ${Date.now().toString(36)}`
  const { spaceId, channelIds } = await createSpace(alice, { name, channels: [{ name: 'sticker-chat' }] })
  const page = await newPage(browser)
  await login(page, alice)
  await page.getByRole('navigation', { name: 'Server-Liste' }).getByRole('button', { name, exact: true }).click()
  await page.getByRole('button', { name: 'sticker-chat', exact: true }).click()
  const dialog = await settings(page)
  await dialog.getByLabel('Stickername', { exact: true }).fill('happy_cat')
  await dialog.getByLabel('Sticker hochladen', { exact: true }).setInputFiles({ name: 'cat.gif', mimeType: 'image/gif', buffer: GIF })
  await expect(dialog.getByRole('textbox', { name: ':happy_cat: umbenennen' })).toBeVisible()
  const pack = await getState<{ images: Record<string, { url: string; usage: string[] }> }>(alice, spaceId, 'im.ponies.room_emotes')
  expect(pack!.images.happy_cat.usage).toEqual(['sticker'])
  await page.keyboard.press('Escape')
  const composer = page.getByRole('textbox', { name: 'Nachricht', exact: true })
  await composer.fill('Unsent draft')
  const list = await picker(page)
  await list.getByRole('option', { name: 'happy_cat', exact: true }).click()
  await expect(composer).toHaveValue('Unsent draft')
  const row = page.locator('[id^="msg-"]').filter({ has: page.getByRole('img', { name: 'happy_cat', exact: true }) })
  await expect(row).toBeVisible()
  await expect(row.getByTestId('sticker-playing')).toBeVisible()
  // The SDK replaces the pending local echo after sending; retry the geometry check across it.
  await expect.poll(async () => {
    const bounds = await row.getByRole('img', { name: 'happy_cat', exact: true }).boundingBox()
    return Boolean(bounds && bounds.width > 0 && bounds.width <= 200 && bounds.height > 0 && bounds.height <= 200)
  }).toBe(true)
  await expect.poll(async () => (await getRoomMessages(alice, channelIds[0])).some((event) => event.type === 'm.sticker' && event.content.url === pack!.images.happy_cat.url)).toBe(true)

  await row.hover()
  await row.getByRole('button', { name: 'Reaktion hinzufügen' }).click()
  await expect(page.getByRole('tab', { name: 'Sticker', exact: true })).toHaveCount(0)
  await expect(page.getByRole('option', { name: ':happy_cat:', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')

  await settings(page)
  await dialog.getByRole('textbox', { name: ':happy_cat: umbenennen' }).fill('renamed_cat')
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: ':renamed_cat: umbenennen' })).toBeVisible()
  await dialog.getByRole('button', { name: ':renamed_cat: löschen', exact: true }).click()
  await expect(dialog.getByText('Dieser Server hat noch keine Sticker.')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(row).toBeVisible()
  await page.context().close()
})

test('personal and globally enabled packs, external stickers, lazy thumbnails and focus-gated playback', async ({ browser }) => {
  const alice = await registerUser('personalstickers')
  const roomName = `Personal stickers ${Date.now().toString(36)}`
  const roomId = await createRoom(alice, { name: roomName, members: [] })
  const mxc = await upload(alice)
  const lateMxc = await upload(alice)
  const images = Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`cat_${index}`, { url: index === 59 ? lateMxc : mxc, body: `Cat ${index}` }]))
  const account = `/user/${encodeURIComponent(alice.userId)}/account_data`
  await put(alice, `${account}/im.ponies.user_emotes`, { pack: { usage: ['sticker'], display_name: 'Cats' }, images })
  await put(alice, `/rooms/${encodeURIComponent(roomId)}/state/im.ponies.room_emotes/global`, { pack: { usage: ['sticker'] }, images: { global_cat: { url: mxc } } })
  await put(alice, `${account}/im.ponies.emote_rooms`, { rooms: { [roomId]: { global: {} } } })
  await put(alice, `/rooms/${encodeURIComponent(roomId)}/send/m.sticker/external`, { body: 'External cat', url: mxc, info: { mimetype: 'image/gif', w: 512, h: 512 } })
  const page = await newPage(browser)
  const lateRequests: string[] = []
  const originalRequests: string[] = []
  const mediaId = lateMxc.split('/').pop()!
  page.on('request', (request) => {
    if (request.url().includes(mediaId)) lateRequests.push(request.url())
    if (request.url().includes('/download/') && request.url().includes(mxc.split('/').pop()!)) originalRequests.push(request.url())
  })
  await login(page, alice)
  await openRoom(page, roomName)
  const row = page.locator('[id^="msg-"]').filter({ has: page.getByRole('img', { name: 'External cat', exact: true }) })
  const playing = row.getByTestId('sticker-playing')
  await expect(playing).toBeVisible()
  // Deterministic native focus signal: exercise the same listeners as switching windows.
  await page.evaluate(() => { Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false }); window.dispatchEvent(new Event('blur')) })
  await expect(playing).toHaveCount(0)
  await expect(row.locator('img')).toHaveCount(1)
  await page.evaluate(() => { Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true }); window.dispatchEvent(new Event('focus')) })
  await expect(playing).toBeVisible()

  const beforePicker = originalRequests.length
  const list = await picker(page)
  await expect(list.getByRole('option', { name: 'cat_0', exact: true })).toBeVisible()
  expect(await list.getByRole('option').count()).toBeLessThanOrEqual(15)
  expect(lateRequests).toEqual([])
  await expect(list.getByRole('option', { name: 'cat_0', exact: true }).getByTestId('sticker-playing')).toBeVisible()
  expect(originalRequests).toHaveLength(beforePicker)
  await list.evaluate((element) => { element.scrollTop = 110 })
  // The first row remains mounted as overscan but cannot keep animating outside the viewport.
  await expect(list.getByRole('option', { name: 'cat_0', exact: true })).toHaveCount(1)
  await expect(list.getByRole('option', { name: 'cat_0', exact: true }).getByTestId('sticker-playing')).toHaveCount(0)
  await list.evaluate((element) => { element.scrollTop = 0 })
  await expect(list.getByRole('option', { name: 'cat_0', exact: true }).getByTestId('sticker-playing')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('sticker-picker.png') })
  await page.getByRole('textbox', { name: 'Sticker suchen' }).fill('cat 59')
  await expect(list.getByRole('option', { name: 'cat_59', exact: true })).toBeVisible()
  await expect.poll(() => lateRequests.length).toBeGreaterThan(0)
  await page.getByRole('textbox', { name: 'Sticker suchen' }).fill('global_cat')
  await list.getByRole('option', { name: 'global_cat', exact: true }).click()
  await expect.poll(async () => (await getRoomMessages(alice, roomId)).some((event) => event.type === 'm.sticker' && event.content.body === 'global_cat')).toBe(true)
  await page.context().close()
})


test('stickers are encrypted as timeline events and work in replies and threads', async ({ browser }) => {
  const alice = await registerUser('encryptedstickers')
  const bob = await registerUser('stickerrecipient')
  const roomName = `Encrypted stickers ${Date.now().toString(36)}`
  const roomId = await createRoom(alice, { name: roomName, members: [bob], encrypted: true })
  const mxc = await upload(alice)
  await put(alice, `/user/${encodeURIComponent(alice.userId)}/account_data/im.ponies.user_emotes`, {
    pack: { usage: ['sticker'] }, images: { secret_cat: { url: mxc } },
  })
  const alicePage = await newPage(browser)
  const bobPage = await newPage(browser)
  await login(alicePage, alice)
  await login(bobPage, bob)
  await openRoom(alicePage, roomName)
  await openRoom(bobPage, roomName)
  await sendMessage(bobPage, 'Reply with a sticker')
  const root = messageRow(alicePage, 'Reply with a sticker')
  await expect(root).toBeVisible()
  await root.hover()
  await root.getByRole('button', { name: 'Antworten', exact: true }).click()
  await (await picker(alicePage)).getByRole('option', { name: 'secret_cat', exact: true }).click()
  const reply = bobPage.locator('[id^="msg-"]').filter({ has: bobPage.getByRole('img', { name: 'secret_cat', exact: true }) })
  await expect(reply).toBeVisible()
  await expect(reply.getByRole('button', { name: /Reply with a sticker/ })).toBeVisible()
  await root.hover()
  await root.getByRole('button', { name: 'Thread erstellen', exact: true }).click()
  const thread = alicePage.getByRole('complementary', { name: 'Thread', exact: true })
  await expect(thread).toBeVisible()
  await thread.getByRole('button', { name: 'Emoji einfügen', exact: true }).click()
  await alicePage.getByRole('tab', { name: 'Sticker', exact: true }).click()
  await alicePage.getByRole('option', { name: 'secret_cat', exact: true }).click()
  await expect(thread.getByRole('img', { name: 'secret_cat', exact: true })).toBeVisible()
  await expect.poll(async () => (await getRoomMessages(alice, roomId)).filter((event) => event.type === 'm.room.encrypted').length).toBe(3)
  expect((await getRoomMessages(alice, roomId)).some((event) => event.type === 'm.sticker')).toBe(false)
  await alicePage.context().close()
  await bobPage.context().close()
})
