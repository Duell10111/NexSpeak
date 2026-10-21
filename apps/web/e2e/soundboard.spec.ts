import { expect, test, type Page } from '@playwright/test'
import { createRoom, createSpace, getState, login, matrixApi, newPage, openRoom, registerUser, remoteAudioLevel } from './helpers'

async function joinVoice(page: Page) {
  await page.getByRole('button', { name: 'Sprachkanal beitreten' }).click()
  await expect(page.getByRole('button', { name: 'Anruf verlassen' })).toBeVisible({ timeout: 30_000 })
}

test('server soundboard validates uploads and saves sound metadata and removal', async ({ browser }) => {
  const owner = await registerUser('soundowner')
  const name = `Sound server ${Date.now().toString(36)}`
  const { spaceId } = await createSpace(owner, { name, channels: [{ name: 'sound-channel' }] })
  const page = await newPage(browser)
  await recordSounds(page)
  await login(page, owner)
  await page.getByRole('navigation', { name: 'Server-Liste' }).getByRole('button', { name, exact: true }).click()
  await page.getByRole('button', { name: 'sound-channel', exact: true }).click()
  await page.getByRole('button', { name: 'Servermenü' }).click()
  await page.getByRole('menuitem', { name: 'Servereinstellungen', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('tab', { name: 'Soundboard', exact: true }).click()
  const upload = dialog.getByLabel('Sound hochladen', { exact: true })
  await upload.setInputFiles({ name: 'oversized.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(512 * 1024 + 1) })
  await expect(page.getByText('Bitte eine gültige Opus/OGG- oder MP3-Datei mit maximal 5 Sekunden und 512 KB auswählen.')).toBeVisible()
  expect(await getState(owner, spaceId, 'io.nexspeak.soundboard')).toBeNull()
  await upload.setInputFiles('public/sounds/chime.mp3')
  const soundName = dialog.getByRole('textbox', { name: 'Soundname', exact: true })
  await expect(soundName).toHaveValue('chime')
  await soundName.fill('Server chime')
  await dialog.getByRole('textbox', { name: 'Sound-Emoji', exact: true }).fill('🎵')
  await dialog.getByRole('slider', { name: 'Lautstärke', exact: true }).press('Home')
  await dialog.getByRole('slider', { name: 'Lautstärke', exact: true }).press('ArrowRight')
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click()
  await expect.poll(async () => (await getState<{ sounds: Array<{ name: string; emoji: string; volume: number; url: string }> }>(owner, spaceId, 'io.nexspeak.soundboard'))?.sounds[0]).toMatchObject({ name: 'Server chime', emoji: '🎵', volume: 1, url: expect.stringMatching(/^mxc:\/\//) })
  const catalog = await getState<{ sounds: Array<{ id: string }> }>(owner, spaceId, 'io.nexspeak.soundboard')
  await page.keyboard.press('Escape')
  await joinVoice(page)
  await play(page, 'Server chime')
  await expect.poll(() => played(page)).toEqual([catalog!.sounds[0].id])
  await page.getByRole('button', { name: 'Anruf verlassen' }).click()
  await page.getByRole('button', { name: 'Servermenü' }).click()
  await page.getByRole('menuitem', { name: 'Servereinstellungen', exact: true }).click()
  await dialog.getByRole('tab', { name: 'Soundboard', exact: true }).click()
  await dialog.getByRole('button', { name: 'Sound entfernen', exact: true }).click()
  await expect(soundName).toHaveCount(0)
  await expect.poll(async () => (await getState<{ sounds: unknown[] }>(owner, spaceId, 'io.nexspeak.soundboard'))?.sounds).toEqual([])
  await page.context().close()
})

const played = (page: Page) => page.evaluate(() => (window as unknown as { __board: string[] }).__board)

async function recordSounds(page: Page) {
  await page.addInitScript(() => {
    const board: string[] = []
    ;(window as unknown as { __board: string[] }).__board = board
    const original = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (this.dataset.soundboard) board.push(this.dataset.soundboard)
      return original.call(this)
    }
  })
}

async function play(page: Page, name: string) {
  await page.getByRole('button', { name: 'Soundboard', exact: true }).click()
  await page.getByRole('button', { name, exact: true }).click()
  await page.keyboard.press('Escape')
}

for (const encrypted of [false, true]) {
  test(`soundboard plays locally and remotely with deafen, disable and ignore gating (${encrypted ? 'E2EE' : 'unencrypted'})`, async ({ browser }) => {
    const alice = await registerUser('soundalice')
    const bob = await registerUser('soundbob')
    const roomName = `Soundboard ${encrypted ? 'E2EE' : 'clear'} ${Date.now().toString(36)}`
    await createRoom(alice, { name: roomName, members: [bob], encrypted })
    const alicePage = await newPage(browser)
    const bobPage = await newPage(browser)
    for (const page of [alicePage, bobPage]) await recordSounds(page)
    await login(alicePage, alice)
    await login(bobPage, bob)
    await openRoom(alicePage, roomName)
    await openRoom(bobPage, roomName)
    await joinVoice(alicePage)
    await joinVoice(bobPage)
    await expect.poll(() => remoteAudioLevel(bobPage), { timeout: 30_000 }).toBeGreaterThan(5)

    await play(alicePage, 'Glocke')
    await expect.poll(() => played(alicePage)).toEqual(['default:chime'])
    await expect.poll(() => played(bobPage)).toEqual(['default:chime'])
    await play(alicePage, 'Trommel')
    // The sender is rate-limited before it publishes the second trigger.
    await expect.poll(() => played(alicePage)).toEqual(['default:chime'])

    await bobPage.getByRole('button', { name: 'Ton stummschalten', exact: true }).last().click()
    await alicePage.waitForTimeout(2_100)
    await play(alicePage, 'Jubel')
    await expect.poll(() => played(alicePage)).toEqual(['default:chime', 'default:celebrate'])
    await expect.poll(() => played(bobPage)).toEqual(['default:chime'])
    await bobPage.getByRole('button', { name: 'Ton aktivieren', exact: true }).last().click()

    await bobPage.getByRole('button', { name: 'Einstellungen', exact: true }).click()
    await bobPage.getByRole('tab', { name: 'Audio', exact: true }).click()
    await bobPage.getByRole('switch', { name: 'Soundboard', exact: true }).click()
    await bobPage.keyboard.press('Escape')
    await alicePage.waitForTimeout(2_100)
    await play(alicePage, 'Trommel')
    await expect.poll(() => played(alicePage)).toHaveLength(3)
    await expect.poll(() => played(bobPage)).toEqual(['default:chime'])

    await bobPage.getByRole('button', { name: 'Einstellungen', exact: true }).click()
    await bobPage.getByRole('tab', { name: 'Audio', exact: true }).click()
    await bobPage.getByRole('switch', { name: 'Soundboard', exact: true }).click()
    await bobPage.keyboard.press('Escape')
    await matrixApi(bob, 'PUT', `/user/${encodeURIComponent(bob.userId)}/account_data/m.ignored_user_list`, { ignored_users: { [alice.userId]: {} } })
    // Wait for the ignore-list sync before sending another sound.
    await bobPage.waitForTimeout(2_100)
    await play(alicePage, 'Glocke')
    await expect.poll(() => played(alicePage)).toHaveLength(4)
    await expect.poll(() => played(bobPage)).toEqual(['default:chime'])

    await alicePage.getByRole('button', { name: 'Anruf verlassen' }).click()
    await bobPage.getByRole('button', { name: 'Anruf verlassen' }).click()
  })
}
