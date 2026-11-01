import { expect, test, type Page } from '@playwright/test'
import { createRoom, login, matrixApi, newPage, openRoom, registerUser, sendTextAs } from './helpers'

async function openProfile(page: Page) {
  await page.getByRole('button', { name: 'Profil und Status' }).click()
  await page.getByRole('button', { name: 'Profil bearbeiten' }).click()
  return page.getByRole('dialog')
}

async function pickPresence(page: Page, presence: string) {
  await page.getByRole('button', { name: 'Profil und Status' }).click()
  await page.getByRole('radio', { name: new RegExp(`^${presence}`) }).click()
  const stored = { Online: 'online', Abwesend: 'unavailable', 'Nicht stören': 'dnd' }[presence]
  await expect.poll(() => page.evaluate(() => localStorage.getItem('nexspeak_presence')), { timeout: 45_000 }).toBe(stored)
}

test('custom status is interoperable, updates member lists and cards, survives reload and clears', async ({ browser }) => {
  const alice = await registerUser('statusalice')
  const bob = await registerUser('statusbob')
  const roomName = `Status ${Date.now().toString(36)}`
  await createRoom(alice, { name: roomName, members: [bob] })
  const page = await newPage(browser)
  const bobPage = await newPage(browser)
  await login(page, alice)
  await login(bobPage, bob)
  await openRoom(page, roomName)
  await openRoom(bobPage, roomName)

  const profile = await openProfile(page)
  await profile.getByLabel('Benutzerdefinierter Status').fill('🎮 Playing together')
  await profile.getByLabel('Löschen nach').selectOption('never')
  await profile.getByRole('button', { name: 'Status speichern', exact: true }).click()
  await expect.poll(async () => (await matrixApi<{ status_msg?: string }>(alice, 'GET', `/presence/${encodeURIComponent(alice.userId)}/status`)).status_msg).toBe('🎮 Playing together')
  await page.keyboard.press('Escape')

  const members = bobPage.getByRole('complementary', { name: 'Mitglieder' })
  const member = members.getByRole('button', { name: new RegExp(alice.username) })
  await expect(member).toContainText('🎮 Playing together')
  await member.click()
  await expect(bobPage.getByRole('dialog').getByText('🎮 Playing together', { exact: true })).toBeVisible()
  await bobPage.keyboard.press('Escape')

  // Presence changes keep the same status_msg, and a reload restores it.
  await pickPresence(page, 'Abwesend')
  await expect.poll(async () => (await matrixApi<{ status_msg?: string }>(alice, 'GET', `/presence/${encodeURIComponent(alice.userId)}/status`)).status_msg).toBe('🎮 Playing together')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Profil und Status' })).toContainText('🎮 Playing together')
  await openProfile(page)
  await page.getByRole('button', { name: 'Status löschen', exact: true }).click()
  await expect(page.getByLabel('Benutzerdefinierter Status')).toHaveValue('', { timeout: 45_000 })
  await expect(member).not.toContainText('🎮 Playing together')
})

test('expired status is cleared on session restore without a stale deadline affecting a new status', async ({ browser }) => {
  const alice = await registerUser('expiredstatus')
  const page = await newPage(browser)
  await login(page, alice)
  await openProfile(page)
  await page.getByLabel('Benutzerdefinierter Status').fill('Gone on reload')
  await page.getByLabel('Löschen nach').selectOption('30m')
  await page.getByRole('button', { name: 'Status speichern', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Status löschen' })).toBeEnabled()
  // Simulate closing the app and returning after the deadline without advancing SDK timers.
  await page.evaluate((userId) => {
    const key = `nexspeak_status:${userId}`
    const saved = JSON.parse(localStorage.getItem(key)!)
    localStorage.setItem(key, JSON.stringify({ ...saved, expiresAt: Date.now() - 1 }))
  }, alice.userId)
  await page.reload()
  await expect.poll(async () => (await matrixApi<{ status_msg?: string }>(alice, 'GET', `/presence/${encodeURIComponent(alice.userId)}/status`)).status_msg ?? '', { timeout: 45_000 }).toBe('')
  await openProfile(page)
  await expect(page.getByLabel('Benutzerdefinierter Status')).toHaveValue('', { timeout: 45_000 })
  await page.getByLabel('Benutzerdefinierter Status').fill('Still here')
  await page.getByLabel('Löschen nach').selectOption('never')
  await page.getByRole('button', { name: 'Status speichern', exact: true }).click()
  await expect.poll(async () => (await matrixApi<{ status_msg?: string }>(alice, 'GET', `/presence/${encodeURIComponent(alice.userId)}/status`)).status_msg).toBe('Still here')
})

test('DND stays local, silences notifications, preserves unread counts and resumes alerts when cancelled', async ({ browser }) => {
  const alice = await registerUser('dndalice')
  const bob = await registerUser('dndbob')
  const carol = await registerUser('dndcarol')
  const quietRoom = `Quiet DND ${Date.now().toString(36)}`
  const busyRoom = `Busy DND ${Date.now().toString(36)}`
  await createRoom(alice, { name: quietRoom, members: [] })
  const roomId = await createRoom(alice, { name: busyRoom, members: [bob, carol] })
  const page = await newPage(browser)
  await page.addInitScript(() => {
    const state = window as unknown as { __notificationBodies: string[] }
    state.__notificationBodies = []
    class RecordingNotification {
      static permission = 'granted'
      constructor(_title: string, options?: NotificationOptions) { state.__notificationBodies.push(options?.body ?? '') }
      close() {}
    }
    ;(window as unknown as { Notification: unknown }).Notification = RecordingNotification
  })
  const bodies = () => page.evaluate(() => (window as unknown as { __notificationBodies: string[] }).__notificationBodies)
  await login(page, alice)
  await openRoom(page, quietRoom)
  await pickPresence(page, 'Nicht stören')
  await expect(page.getByRole('button', { name: 'Profil und Status' })).toContainText('Nicht stören')
  await expect.poll(async () => (await matrixApi<{ presence: string }>(alice, 'GET', `/presence/${encodeURIComponent(alice.userId)}/status`)).presence).toBe('online')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Profil und Status' })).toContainText('Nicht stören')
  await openRoom(page, quietRoom)
  const muted = `${alice.username}, DND message`
  await sendTextAs(bob, roomId, muted, [alice.userId])
  await expect(page).toHaveTitle(/^\(1\) /)
  expect(await bodies()).not.toContain(muted)
  await pickPresence(page, 'Online')
  const audible = `${alice.username}, notifications restored`
  await sendTextAs(bob, roomId, audible, [alice.userId])
  await expect.poll(bodies).toContain(audible)
  expect(await bodies()).not.toContain(muted)
  await expect(page).toHaveTitle(/^\(2\) /)
})
