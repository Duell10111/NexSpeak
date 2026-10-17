import { expect, test, type Page } from "@playwright/test"
import { createRoom, login, newPage, openRoom, registerUser, sendMessage, sendTextAs } from "./helpers"

interface RecordedNotification {
  title: string
  body?: string
}

/** Records notifications instead of showing them; permission as if the user allowed it. */
async function recordNotifications(page: Page) {
  await page.addInitScript(() => {
    const recorded: Array<{ title: string; body?: string }> = []
    const state = window as unknown as { __notifications: typeof recorded; __lastNotification?: { onclick?: () => void } }
    state.__notifications = recorded
    class RecordingNotification {
      static permission = "granted"
      static requestPermission = async () => "granted"
      onclick: (() => void) | null = null
      constructor(title: string, options?: NotificationOptions) {
        recorded.push({ title, body: options?.body })
        state.__lastNotification = this as unknown as { onclick?: () => void }
      }
      close() {}
    }
    ;(window as unknown as { Notification: unknown }).Notification = RecordingNotification
  })
}

function notifications(page: Page) {
  return page.evaluate(() => (window as unknown as { __notifications: RecordedNotification[] }).__notifications)
}

test("new messages notify, mentions count in the title, a click opens the room", async ({ browser }) => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  // Three members: a room with two counts as a direct message, where every message counts.
  const carol = await registerUser("carol")
  const suffix = Date.now().toString(36)
  const quietRoom = `Ruhig ${suffix}`
  const busyRoom = `Laut ${suffix}`
  await createRoom(alice, { name: quietRoom, members: [] })
  const busyRoomId = await createRoom(alice, { name: busyRoom, members: [bob, carol] })

  const page = await newPage(browser)
  await recordNotifications(page)
  await login(page, alice)
  await expect(page.getByRole("button", { name: new RegExp(busyRoom) }).first()).toBeVisible()
  await openRoom(page, quietRoom)

  await sendTextAs(bob, busyRoomId, "Hallo zusammen")
  await expect
    .poll(() => notifications(page))
    .toContainEqual({ title: `${bob.username} in ${busyRoom}`, body: "Hallo zusammen" })
  // A normal message in a group room is no reason for a badge.
  await expect(page).not.toHaveTitle(/^\(\d+\)/)

  // A mention counts.
  await sendTextAs(bob, busyRoomId, `${alice.username}, schau mal`)
  await expect.poll(() => notifications(page)).toContainEqual(expect.objectContaining({ body: `${alice.username}, schau mal` }))
  await expect(page).toHaveTitle(/^\(1\) /)

  // Clicking the notification opens the room.
  await page.evaluate(() => (window as unknown as { __lastNotification: { onclick: () => void } }).__lastNotification.onclick())
  await expect(page.getByRole("heading", { level: 3, name: busyRoom })).toBeVisible()
})

test("encrypted messages notify once decrypted", async ({ browser }) => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const suffix = Date.now().toString(36)
  const quietRoom = `Ruhig ${suffix}`
  const secretRoom = `Geheim ${suffix}`
  await createRoom(alice, { name: quietRoom, members: [] })
  await createRoom(alice, { name: secretRoom, members: [bob], encrypted: true })

  const alicePage = await newPage(browser)
  const bobPage = await newPage(browser)
  await recordNotifications(alicePage)
  await login(alicePage, alice)
  await login(bobPage, bob)
  await openRoom(bobPage, secretRoom)
  await openRoom(alicePage, quietRoom)

  await sendMessage(bobPage, "Nur für uns")
  await expect
    .poll(() => notifications(alicePage), { timeout: 30_000 })
    .toContainEqual({ title: `${bob.username} in ${secretRoom}`, body: "Nur für uns" })
})
