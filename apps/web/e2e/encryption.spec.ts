import { expect, test } from "@playwright/test"
import { createRoom, getRoomMessages, login, messageRow, newPage, openRoom, registerUser, sendMessage } from "./helpers"

// 1x1 red PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
)

test("encrypted room: text and attachments are end-to-end encrypted", async ({ browser }) => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const roomName = `Geheim ${Date.now().toString(36)}`
  const roomId = await createRoom(alice, { name: roomName, members: [bob], encrypted: true })

  const alicePage = await newPage(browser)
  const bobPage = await newPage(browser)
  await login(alicePage, alice)
  await login(bobPage, bob)
  await openRoom(alicePage, roomName)
  await openRoom(bobPage, roomName)
  await expect(alicePage.getByLabel("Ende-zu-Ende-verschlüsselt").first()).toBeVisible()

  await sendMessage(alicePage, "Streng geheim 🤫")
  await expect(messageRow(bobPage, "Streng geheim 🤫")).toBeVisible()

  await alicePage.locator('input[type="file"]').setInputFiles({ name: "punkt.png", mimeType: "image/png", buffer: PNG })
  const image = bobPage.locator('[id^="msg-"] img[alt="punkt.png"]')
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1)

  // The homeserver only ever sees ciphertext.
  const events = await getRoomMessages(alice, roomId)
  const types = events.map((event) => event.type)
  expect(types).toContain("m.room.encrypted")
  expect(types).not.toContain("m.room.message")
})
