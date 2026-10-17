import { expect, test, type Page } from "@playwright/test"
import { createRoom, login, newPage, openRoom, registerUser, remoteAudioLevel } from "./helpers"

async function joinVoice(page: Page) {
  await page.getByRole("button", { name: "Sprachkanal beitreten" }).click()
  await expect(page.getByRole("button", { name: "Anruf verlassen" })).toBeVisible({ timeout: 30_000 })
}

test("push to talk is set up in the settings", async ({ browser }) => {
  const alice = await registerUser("alice")
  const page = await newPage(browser)
  await login(page, alice)

  await page.getByRole("button", { name: "Einstellungen" }).click()
  const dialog = page.getByRole("dialog", { name: "Einstellungen" })
  await dialog.getByRole("radio", { name: "Push-to-Talk" }).click()
  await expect(dialog.getByText("Keine Taste festgelegt")).toBeVisible()
  await expect(dialog.getByText("Im Browser funktioniert Push-to-Talk nur")).toBeVisible()

  await dialog.getByRole("button", { name: "Taste festlegen" }).click()
  await expect(dialog.getByText("Drücke eine Taste oder Maustaste")).toBeVisible()
  // Escape cancels the capture without closing the dialog.
  await page.keyboard.press("Escape")
  await expect(dialog.getByRole("button", { name: "Taste festlegen" })).toBeVisible()

  await dialog.getByRole("button", { name: "Taste festlegen" }).click()
  await page.keyboard.press("KeyT")
  await expect(dialog.getByText("T", { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "Taste ändern" }).click()
  await page.mouse.down({ button: "middle" })
  await page.mouse.up({ button: "middle" })
  await expect(dialog.getByText("Maustaste 3")).toBeVisible()

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("nexspeak_audio_settings") ?? "{}"))
  expect(stored).toMatchObject({ inputMode: "push-to-talk", pushToTalkKey: "Mouse3" })
})

test("with push to talk the microphone only transmits while the key is held", async ({ browser }) => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const roomName = `PTT ${Date.now().toString(36)}`
  await createRoom(alice, { name: roomName, members: [bob] })

  const alicePage = await newPage(browser)
  const bobPage = await newPage(browser)
  await login(alicePage, alice)
  await login(bobPage, bob)
  await alicePage.evaluate(() =>
    localStorage.setItem(
      "nexspeak_audio_settings",
      JSON.stringify({ inputMode: "push-to-talk", pushToTalkKey: "KeyT", pushToTalkReleaseDelayMs: 0 }),
    ),
  )
  await openRoom(alicePage, roomName)
  await openRoom(bobPage, roomName)
  await joinVoice(alicePage)
  await joinVoice(bobPage)
  await expect(bobPage.getByTestId("call-tile")).toHaveCount(2, { timeout: 30_000 })
  await expect.poll(() => bobPage.locator("audio").count(), { timeout: 30_000 }).toBeGreaterThan(0)

  // Not muted for the others: push to talk is not a mute.
  const aliceTile = bobPage.getByTestId("call-tile").filter({ hasText: alice.username })
  await expect(aliceTile.getByLabel("Stummgeschaltet")).toHaveCount(0)

  // Key up: silence.
  expect(await remoteAudioLevel(bobPage)).toBeLessThanOrEqual(2)

  // Key held: Bob hears Alice (the fake microphone beeps).
  await alicePage.keyboard.down("KeyT")
  await expect.poll(() => remoteAudioLevel(bobPage), { timeout: 20_000 }).toBeGreaterThan(5)

  // Released: silence again.
  await alicePage.keyboard.up("KeyT")
  await expect.poll(() => remoteAudioLevel(bobPage), { timeout: 20_000 }).toBeLessThanOrEqual(2)
})
