import { expect, test, type Page } from "@playwright/test"
import { createRoom, login, newPage, openRoom, registerUser } from "./helpers"

async function joinVoice(page: Page) {
  await page.getByRole("button", { name: "Sprachkanal beitreten" }).click()
  await expect(page.getByRole("button", { name: "Anruf verlassen" })).toBeVisible({ timeout: 30_000 })
}

/** Participant tiles on the call stage (no screenshares in these tests). */
function tiles(page: Page) {
  return page.getByTestId("call-tile")
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
      await expect(tiles(page)).toHaveCount(2, { timeout: 30_000 })
      await expect(page.locator('[data-testid="call-tile"][data-connecting]')).toHaveCount(0, { timeout: 30_000 })
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
            // Chromium's fake microphone beeps in intervals: sample long enough to catch a beep.
            const data = new Uint8Array(analyser.fftSize)
            let level = 0
            for (const end = performance.now() + 1_500; performance.now() < end; ) {
              await new Promise((resolve) => setTimeout(resolve, 20))
              analyser.getByteTimeDomainData(data)
              level = Math.max(level, Math.max(...data) - Math.min(...data))
            }
            await context.close()
            return level
          }),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(5)

    // Mute shows up for the other participant.
    await alicePage.getByRole("button", { name: "Mikrofon stummschalten" }).last().click()
    await expect(tiles(bobPage).filter({ hasText: alice.username }).getByLabel("Stummgeschaltet")).toBeVisible()
    // ... and in the voice channel's member list in the sidebar.
    await expect(bobPage.getByLabel(`Im Sprachkanal ${roomName}`).getByLabel("Stummgeschaltet")).toBeVisible()

    // Leaving updates the other side.
    await alicePage.getByRole("button", { name: "Anruf verlassen" }).click()
    await expect(tiles(bobPage)).toHaveCount(1, { timeout: 30_000 })
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
  await expect(tiles(bobPage)).toHaveCount(2, { timeout: 30_000 })
})

test("calls that are already running at login show up in the channel list", async ({ browser }) => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const roomName = `Laufend ${Date.now().toString(36)}`
  await createRoom(alice, { name: roomName, members: [bob] })

  const alicePage = await newPage(browser)
  await login(alicePage, alice)
  await openRoom(alicePage, roomName)
  await joinVoice(alicePage)

  // Bob logs in only now: the call must be listed without any further membership change.
  const bobPage = await newPage(browser)
  await login(bobPage, bob)
  await expect(bobPage.getByLabel(`Im Sprachkanal ${roomName}`).getByText(alice.username)).toBeVisible({ timeout: 30_000 })
})

test("mute and deafen work before joining and apply to the call", async ({ browser }) => {
  const alice = await registerUser("alice")
  const roomName = `Vorher stumm ${Date.now().toString(36)}`
  await createRoom(alice, { name: roomName, members: [] })

  const page = await newPage(browser)
  await login(page, alice)
  await openRoom(page, roomName)

  await page.getByRole("button", { name: "Ton stummschalten" }).click()
  // Deafening mutes as well, like Discord.
  await expect(page.getByRole("button", { name: "Mikrofon aktivieren" })).toBeVisible()

  await joinVoice(page)
  await expect(tiles(page).getByLabel("Stummgeschaltet")).toBeVisible()
  await expect(page.getByRole("button", { name: "Ton aktivieren" }).first()).toBeVisible()

  // Undeafening restores the microphone that deafening turned off.
  await page.getByRole("button", { name: "Ton aktivieren" }).last().click()
  await expect(tiles(page).getByLabel("Stummgeschaltet")).toHaveCount(0, { timeout: 15_000 })
})

test("screenshare with chosen resolution and frame rate, adjustable while live", async ({ browser }) => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const roomName = `Stream ${Date.now().toString(36)}`
  await createRoom(alice, { name: roomName, members: [bob], encrypted: true })

  const alicePage = await newPage(browser)
  const bobPage = await newPage(browser)
  // Keep the peer connections reachable to inspect what is actually sent.
  await alicePage.addInitScript(() => {
    const connections: RTCPeerConnection[] = []
    ;(window as unknown as { __pcs: RTCPeerConnection[] }).__pcs = connections
    const Original = window.RTCPeerConnection
    window.RTCPeerConnection = class extends Original {
      constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) {
        super(...args)
        connections.push(this)
      }
    }
  })
  await login(alicePage, alice)
  await login(bobPage, bob)
  await openRoom(alicePage, roomName)
  await openRoom(bobPage, roomName)
  await joinVoice(alicePage)
  await joinVoice(bobPage)
  await expect(tiles(bobPage)).toHaveCount(2, { timeout: 30_000 })

  // Discord's "Go Live" flow: pick the quality first, then the browser picker.
  await alicePage.getByRole("button", { name: "Bildschirm teilen" }).last().click()
  const dialog = alicePage.getByRole("dialog", { name: "Bildschirm teilen" })
  await dialog.getByRole("radio", { name: "720p" }).click()
  await dialog.getByRole("radio", { name: "60 FPS" }).click()
  await dialog.getByRole("button", { name: "Live gehen" }).click()
  await expect(alicePage.getByRole("button", { name: "Stream-Einstellungen" })).toBeVisible({ timeout: 30_000 })

  const screenSender = () =>
    alicePage.evaluate(() => {
      const pcs = (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs
      for (const pc of pcs) {
        for (const sender of pc.getSenders()) {
          const settings = sender.track?.getSettings()
          if (sender.track?.kind !== "video" || !settings?.displaySurface) continue
          const parameters = sender.getParameters()
          const encodings = parameters.encodings
          return {
            // H.264 Main under LiveKit's baseline payload type, see swapH264ProfilesInOffer.
            fmtp: parameters.codecs[0]?.sdpFmtpLine ?? "",
            height: settings.height ?? 0,
            maxFramerate: Math.max(...encodings.map((encoding) => encoding.maxFramerate ?? 0)),
            maxBitrate: Math.max(...encodings.map((encoding) => encoding.maxBitrate ?? 0)),
          }
        }
      }
      return null
    })

  await expect.poll(screenSender, { timeout: 30_000 }).toMatchObject({ maxFramerate: 60, maxBitrate: 4_000_000 })
  expect((await screenSender())!.height).toBeLessThanOrEqual(720)
  expect((await screenSender())!.fmtp).toContain("profile-level-id=4d00")

  // Bob watches the stream: it takes the stage and frames decode (E2EE).
  await expect(tiles(bobPage)).toHaveCount(3, { timeout: 30_000 })
  await expect
    .poll(
      () =>
        bobPage.evaluate(() =>
          Math.max(
            0,
            ...Array.from(document.querySelectorAll("video")).map((video) => video.getVideoPlaybackQuality().totalVideoFrames),
          ),
        ),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(10)

  // Viewers see what arrives (right-click on the stream).
  await tiles(bobPage).filter({ hasText: "Live" }).first().click({ button: "right" })
  await expect(bobPage.getByTestId("decoder-status")).toContainText(/\d+p · \d+ FPS · \d+,\d Mbit\/s/)
  await expect(bobPage.getByTestId("decoder-status")).toContainText("H264")
  await bobPage.keyboard.press("Escape")

  // Changing the quality while live needs no new picker.
  await alicePage.getByRole("button", { name: "Stream-Einstellungen" }).click()
  // Encoded with H.264 (hardware where available; the test browser has no GPU).
  await expect(alicePage.getByTestId("encoder-status")).toContainText(/H264 · (Hardware|Software)/)
  await expect(alicePage.getByTestId("encoder-status")).toContainText(/\d+p · \d+ FPS/)
  await expect(alicePage.getByTestId("encoder-status")).toContainText(/Upload \d+,\d Mbit\/s/)
  await alicePage.getByRole("menuitemradio", { name: "15 FPS" }).click()
  await expect.poll(screenSender).toMatchObject({ maxFramerate: 15 })
  await alicePage.keyboard.press("Escape")
  await expect(alicePage.getByRole("menu")).toBeHidden()

  await alicePage.getByRole("button", { name: "Stream-Einstellungen" }).click()
  await expect(alicePage.getByRole("menu")).toBeVisible({ timeout: 5_000 })
  await alicePage.getByRole("menuitem", { name: "Stream beenden" }).click()
  await expect(alicePage.getByRole("button", { name: "Bildschirm teilen" }).last()).toBeVisible()
  await expect(tiles(bobPage)).toHaveCount(2, { timeout: 30_000 })

  // The choice is remembered for the next stream.
  await alicePage.getByRole("button", { name: "Bildschirm teilen" }).last().click()
  await expect(alicePage.getByRole("radio", { name: "15 FPS" })).toHaveAttribute("aria-checked", "true")
})
