import { expect, test, type Page } from "@playwright/test"
import { createRoom, login, newPage, openRoom, registerUser } from "./helpers"

async function joinVoice(page: Page) {
  await page.getByRole("button", { name: "Sprachkanal beitreten" }).click()
  await expect(page.getByText("Sprachkanal verbunden")).toBeVisible({ timeout: 30_000 })
}

for (const encrypted of [false, true]) {
  test(`voice call via MatrixRTC + LiveKit (${encrypted ? "E2EE" : "unencrypted"})`, async ({ browser }) => {
    const alice = await registerUser("alice")
    const bob = await registerUser("bob")
    const roomName = `Voice ${encrypted ? "E2EE " : ""}${Date.now().toString(36)}`
    await createRoom(alice, { name: roomName, members: [bob], encrypted })

    const alicePage = await newPage(browser)
    const bobPage = await newPage(browser)
    await login(alicePage, alice)
    await login(bobPage, bob)
    await openRoom(alicePage, roomName)
    await openRoom(bobPage, roomName)

    await joinVoice(alicePage)
    // Bob sees the running call in the room list before joining.
    await expect(bobPage.getByText(alice.username).first()).toBeVisible()
    await joinVoice(bobPage)

    for (const page of [alicePage, bobPage]) {
      await expect(page.getByText("2 Teilnehmer")).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText("Verbindet…")).toHaveCount(0, { timeout: 30_000 })
      if (encrypted) await expect(page.getByLabel("Ende-zu-Ende-verschlüsselt").first()).toBeVisible()
    }

    // Remote audio is subscribed and attached on both sides.
    for (const page of [alicePage, bobPage]) {
      await expect.poll(() => page.locator("audio").count(), { timeout: 30_000 }).toBeGreaterThan(0)
    }

    // With E2EE, frames must actually decrypt: wait for the remote mic to produce audio levels.
    await expect
      .poll(
        () =>
          bobPage.evaluate(async () => {
            const audio = document.querySelector("audio")
            const stream = audio?.srcObject as MediaStream | null
            if (!stream) return 0
            const context = new AudioContext()
            const analyser = context.createAnalyser()
            context.createMediaStreamSource(stream).connect(analyser)
            await new Promise((resolve) => setTimeout(resolve, 500))
            const data = new Uint8Array(analyser.fftSize)
            analyser.getByteTimeDomainData(data)
            await context.close()
            return Math.max(...data) - Math.min(...data)
          }),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(5)

    // Mute shows up for the other participant.
    await alicePage.getByRole("button", { name: "Mikrofon stummschalten" }).last().click()
    await expect(bobPage.getByLabel("Stummgeschaltet")).toBeVisible()

    // Leaving updates the other side.
    await alicePage.getByRole("button", { name: "Anruf verlassen" }).click()
    await expect(bobPage.getByText("1 Teilnehmer")).toBeVisible({ timeout: 30_000 })
  })
}

test("calls in rooms without call permission can be enabled by an admin", async ({ browser }) => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const roomName = `Ohne Rechte ${Date.now().toString(36)}`
  await createRoom(alice, { name: roomName, members: [bob], allowCalls: false })

  const alicePage = await newPage(browser)
  const bobPage = await newPage(browser)
  await login(alicePage, alice)
  await login(bobPage, bob)
  await openRoom(bobPage, roomName)
  await openRoom(alicePage, roomName)

  // Bob is a normal member: clear message instead of a failing call.
  await bobPage.getByRole("button", { name: "Sprachkanal beitreten" }).click()
  await expect(bobPage.getByText(/keine Berechtigung/)).toBeVisible()

  // Alice is admin: she can join and allow everybody else from the call view.
  await joinVoice(alicePage)
  await alicePage.getByRole("button", { name: "Für alle erlauben" }).click()
  await expect(alicePage.getByText("Anrufe sind jetzt für alle Mitglieder erlaubt.")).toBeVisible()

  await joinVoice(bobPage)
  await expect(bobPage.getByText("2 Teilnehmer")).toBeVisible({ timeout: 30_000 })
})
