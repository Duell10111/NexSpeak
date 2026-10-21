import { expect, test, type Page } from '@playwright/test'
import { createSpace, getRoomMessages, getState, HOMESERVER_URL, login, newPage, registerUser, type TestUser } from './helpers'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Servermenü' }).click()
  await page.getByRole('menuitem', { name: 'Servereinstellungen', exact: true }).click()
  await page.getByRole('tab', { name: 'Server-Emojis', exact: true }).click()
}

async function join(user: TestUser, roomId: string) {
  const response = await fetch(`${HOMESERVER_URL}/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, {
    method: 'POST', headers: { Authorization: `Bearer ${user.accessToken}`, 'Content-Type': 'application/json' }, body: '{}',
  })
  expect(response.ok).toBe(true)
}

test('server emoji upload, shortcode completion, rendering, reactions, rename and deletion', async ({ browser }) => {
  const alice = await registerUser('emoji')
  const name = `Emoji ${Date.now().toString(36)}`
  const { spaceId, channelIds } = await createSpace(alice, { name, channels: [{ name: 'emoji-chat' }] })
  const page = await newPage(browser)
  await login(page, alice)
  await page.getByRole('navigation', { name: 'Server-Liste' }).getByRole('button', { name, exact: true }).click()
  await page.getByRole('button', { name: 'emoji-chat', exact: true }).click()
  await openSettings(page)
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Emoji-Kurzname', { exact: true }).fill('party_cat')
  await dialog.getByLabel('Emoji hochladen', { exact: true }).setInputFiles({ name: 'cat.png', mimeType: 'image/png', buffer: PNG })
  await expect(dialog.getByRole('textbox', { name: ':party_cat: umbenennen' })).toBeVisible()
  const pack = await getState<{ images: Record<string, { url: string }> }>(alice, spaceId, 'im.ponies.room_emotes')
  const mxc = pack!.images.party_cat.url
  expect(mxc).toMatch(/^mxc:\/\//)
  await page.keyboard.press('Escape')
  const composer = page.getByRole('textbox', { name: 'Nachricht', exact: true })
  await composer.fill('Hello :party')
  await page.getByRole('listbox', { name: 'Server-Emoji-Vorschläge' }).getByRole('option').click()
  await composer.press('Enter')
  const row = page.locator('[id^="msg-"]').filter({ has: page.getByTestId('message-body').filter({ hasText: 'Hello' }) }).last()
  await expect(row.getByRole('img', { name: ':party_cat:', exact: true })).toBeVisible()
  await expect(row.locator('img[alt=":party_cat:"]')).toHaveAttribute('src', /^blob:/)
  await expect.poll(async () => (await getRoomMessages(alice, channelIds[0])).some((event) => String(event.content.formatted_body).includes(`src="${mxc}"`))).toBe(true)

  await row.hover()
  await row.getByRole('button', { name: 'Reaktion hinzufügen' }).click()
  await page.getByRole('option', { name: ':party_cat:', exact: true }).click()
  const reaction = row.getByRole('button', { name: `${mxc} 1`, exact: true })
  await expect(reaction).toBeVisible()
  await expect(reaction.locator('img')).toBeVisible()
  await reaction.click()
  await expect(reaction).toHaveCount(0)

  await openSettings(page)
  const rename = dialog.getByRole('textbox', { name: ':party_cat: umbenennen' })
  await rename.fill('renamed_cat')
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: ':renamed_cat: umbenennen' })).toBeVisible()
  await dialog.getByRole('button', { name: ':renamed_cat: löschen', exact: true }).click()
  await expect(dialog.getByText('Dieser Server hat noch keine eigenen Emojis.')).toBeVisible()
  await expect.poll(async () => (await getState<{ images: Record<string, unknown> }>(alice, spaceId, 'im.ponies.room_emotes'))?.images).toEqual({})
  await page.keyboard.press('Escape')
  await expect(row.locator('img[alt=":party_cat:"]')).toBeVisible()
  await page.context().close()
})

test('ordinary members cannot manage a server emoji pack', async ({ browser }) => {
  const owner = await registerUser('emojiowner')
  const member = await registerUser('emojimember')
  const name = `Emoji access ${Date.now().toString(36)}`
  const { spaceId } = await createSpace(owner, { name, channels: [] })
  // Invite through the Matrix API so the member can open the private space.
  const response = await fetch(`${HOMESERVER_URL}/_matrix/client/v3/rooms/${encodeURIComponent(spaceId)}/invite`, {
    method: 'POST', headers: { Authorization: `Bearer ${owner.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: member.userId }),
  })
  expect(response.ok).toBe(true)
  await join(member, spaceId)
  const page = await newPage(browser)
  await login(page, member)
  await page.getByRole('navigation', { name: 'Server-Liste' }).getByRole('button', { name, exact: true }).click()
  await openSettings(page)
  await expect(page.getByRole('dialog').getByText('Nur Moderatoren und Administratoren mit Berechtigung können Server-Emojis verwalten.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Emoji hochladen', exact: true })).toHaveCount(0)
  await page.context().close()
})
