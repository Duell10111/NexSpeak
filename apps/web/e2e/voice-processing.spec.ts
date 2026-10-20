import { expect, test, type Page } from "@playwright/test"
import { createRoom, login, newPage, openRoom, registerUser, remoteAudioLevel } from "./helpers"

async function joinVoice(page: Page) {
  await page.getByRole("button", { name: "Sprachkanal beitreten" }).click()
  await expect(page.getByRole("button", { name: "Anruf verlassen" })).toBeVisible({ timeout: 30_000 })
}

function updateAudioSettings(page: Page, update: Record<string, unknown>) {
  return page.evaluate((changes) => {
    const current = JSON.parse(localStorage.getItem("nexspeak_audio_settings") ?? "{}")
    localStorage.setItem("nexspeak_audio_settings", JSON.stringify({ ...current, ...changes }))
  }, update)
}

test("voice processing and input sensitivity are set up in the settings", async ({ browser }) => {
  const alice = await registerUser("alice")
  const page = await newPage(browser)
  await login(page, alice)

  await page.getByRole("button", { name: "Einstellungen" }).click()
  const dialog = page.getByRole("dialog", { name: "Einstellungen" })
  await expect(dialog.getByText("Die eingebaute Unterdrückung des Browsers")).toBeVisible()
  await dialog.getByRole("combobox", { name: "Rauschunterdrückung" }).click()
  await page.getByRole("option", { name: "Verbessert (RNNoise)" }).click()
  await expect(dialog.getByText("Braucht während Anrufen etwas CPU")).toBeVisible()
  await dialog.getByRole("switch", { name: "Echounterdrückung" }).click()

  await dialog.getByRole("switch", { name: "Eingangsempfindlichkeit" }).click()
  const slider = dialog.getByRole("slider", { name: "Eingangsempfindlichkeit" })
  await expect(slider).toHaveAttribute("aria-valuenow", "-50")
  // Above everything the fake microphone produces: the test shows that nothing would be sent.
  await slider.focus()
  await page.keyboard.press("End")
  await expect(dialog.getByText("0 dB", { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "Mikrofon testen" }).click()
  await expect(dialog.getByText("Unter der Schwelle – wird nicht gesendet")).toBeVisible()
  await expect(dialog.getByText("Wird gesendet", { exact: true })).toHaveCount(0)
  await expect(dialog.getByRole("button", { name: "Mikrofon testen" })).toBeVisible({ timeout: 10_000 })

  // Below the fake microphone's beeps: the gate opens.
  await slider.focus()
  await page.keyboard.press("Home")
  await dialog.getByRole("button", { name: "Mikrofon testen" }).click()
  await expect(dialog.getByText("Wird gesendet", { exact: true })).toBeVisible()

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("nexspeak_audio_settings") ?? "{}"))
  expect(stored).toMatchObject({
    noiseSuppression: "enhanced",
    echoCancellation: false,
    inputSensitivityEnabled: true,
    inputSensitivityDb: -80,
  })
})

test("enhanced suppression and the voice gate process the microphone in a call", async ({ browser }) => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const roomName = `Voice ${Date.now().toString(36)}`
  await createRoom(alice, { name: roomName, members: [bob] })

  const alicePage = await newPage(browser)
  const bobPage = await newPage(browser)
  await login(alicePage, alice)
  await login(bobPage, bob)
  await updateAudioSettings(alicePage, { inputSensitivityEnabled: true, inputSensitivityDb: -80 })
  await openRoom(alicePage, roomName)
  await openRoom(bobPage, roomName)
  await joinVoice(alicePage)
  await joinVoice(bobPage)
  await expect(bobPage.getByTestId("call-tile")).toHaveCount(2, { timeout: 30_000 })
  await expect.poll(() => bobPage.locator("audio").count(), { timeout: 30_000 }).toBeGreaterThan(0)

  // Gate open: Bob hears the beeps through the processor.
  await expect.poll(() => remoteAudioLevel(bobPage), { timeout: 20_000 }).toBeGreaterThan(5)

  // A threshold above the beeps closes the gate in the running call; others don't see a mute.
  await alicePage.getByRole("button", { name: "Einstellungen" }).click()
  const dialog = alicePage.getByRole("dialog", { name: "Einstellungen" })
  await dialog.getByRole("slider", { name: "Eingangsempfindlichkeit" }).focus()
  await alicePage.keyboard.press("End")
  await expect.poll(() => remoteAudioLevel(bobPage), { timeout: 20_000 }).toBeLessThanOrEqual(2)
  const aliceTile = bobPage.getByTestId("call-tile").filter({ hasText: alice.username })
  await expect(aliceTile.getByLabel("Stummgeschaltet")).toHaveCount(0)

  // Switching to RNNoise replaces the processor; with the gate off everything is sent again.
  await dialog.getByRole("combobox", { name: "Rauschunterdrückung" }).click()
  await alicePage.getByRole("option", { name: "Verbessert (RNNoise)" }).click()
  await dialog.getByRole("switch", { name: "Eingangsempfindlichkeit" }).click()
  await expect.poll(() => remoteAudioLevel(bobPage), { timeout: 20_000 }).toBeGreaterThan(5)

  // Echo cancellation can only change by reopening the microphone; the processor survives that.
  await dialog.getByRole("switch", { name: "Echounterdrückung" }).click()
  await expect.poll(() => remoteAudioLevel(bobPage), { timeout: 20_000 }).toBeGreaterThan(5)
})

test("push to talk gates the microphone in front of RNNoise", async ({ browser }) => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const roomName = `PTT RNNoise ${Date.now().toString(36)}`
  await createRoom(alice, { name: roomName, members: [bob] })

  const alicePage = await newPage(browser)
  const bobPage = await newPage(browser)
  await login(alicePage, alice)
  await login(bobPage, bob)
  await updateAudioSettings(alicePage, {
    inputMode: "push-to-talk",
    pushToTalkKey: "KeyT",
    pushToTalkReleaseDelayMs: 0,
    noiseSuppression: "enhanced",
    // Ignored with push to talk.
    inputSensitivityEnabled: true,
    inputSensitivityDb: 0,
  })
  await openRoom(alicePage, roomName)
  await openRoom(bobPage, roomName)
  await joinVoice(alicePage)
  await joinVoice(bobPage)
  await expect(bobPage.getByTestId("call-tile")).toHaveCount(2, { timeout: 30_000 })
  await expect.poll(() => bobPage.locator("audio").count(), { timeout: 30_000 }).toBeGreaterThan(0)

  expect(await remoteAudioLevel(bobPage)).toBeLessThanOrEqual(2)
  await alicePage.keyboard.down("KeyT")
  await expect.poll(() => remoteAudioLevel(bobPage), { timeout: 20_000 }).toBeGreaterThan(5)
  await alicePage.keyboard.up("KeyT")
  await expect.poll(() => remoteAudioLevel(bobPage), { timeout: 20_000 }).toBeLessThanOrEqual(2)
})
