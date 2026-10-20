import { expect, test, type Page } from "@playwright/test"
import { createRoom, login, matrixApi, newPage, openRoom, registerUser, remoteAudioLevel } from "./helpers"

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
    const duration = bobPage.getByLabel(/^Anruf läuft seit /)
    await expect(duration).toHaveText(/^\d+:\d{2}$/)
    const initialDuration = await duration.textContent()
    await expect(duration).not.toHaveText(initialDuration!)
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
    await expect.poll(() => remoteAudioLevel(bobPage), { timeout: 30_000 }).toBeGreaterThan(5)

    // Connection details (Discord's ping popover) read the live WebRTC stats.
    await bobPage.getByRole("button", { name: "Verbindungsdetails" }).click()
    const details = bobPage.getByTestId("connection-details")
    await expect(details.getByText(/^\d+ ms$/).first()).toBeVisible({ timeout: 10_000 })
    await expect(details.getByText(encrypted ? "Ende-zu-Ende" : "Nur Transport (DTLS-SRTP)")).toBeVisible()
    await bobPage.keyboard.press("Escape")
    await expect(details).toHaveCount(0)

    // Mute shows up for the other participant.
    await alicePage.getByRole("button", { name: "Mikrofon stummschalten" }).last().click()
    await expect(tiles(bobPage).filter({ hasText: alice.username }).getByLabel("Stummgeschaltet")).toBeVisible()
    // ... and in the voice channel's member list in the sidebar.
    await expect(bobPage.getByLabel(`Im Sprachkanal ${roomName}`).getByLabel("Stummgeschaltet")).toBeVisible()

    // Leaving updates the other side.
    await alicePage.getByRole("button", { name: "Anruf verlassen" }).click()
    await expect(tiles(bobPage)).toHaveCount(1, { timeout: 30_000 })
    await expect(duration).toHaveCount(1)
    await bobPage.getByRole("button", { name: "Anruf verlassen" }).click()
    await expect(duration).toHaveCount(0)
    await expect(alicePage.getByLabel(/^Anruf läuft seit /)).toHaveCount(0)

    // A new call uses a fresh membership timestamp instead of the previous call's duration.
    await joinVoice(alicePage)
    await expect(duration).toHaveText(/^0:0\d$/)
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
  await expect(bobPage.getByLabel(/^Anruf läuft seit /)).toHaveText(/^\d+:\d{2}$/)
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

test("sound cues for joining, leaving and streams, not for those already there", async ({ browser }) => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const roomName = `Töne ${Date.now().toString(36)}`
  await createRoom(alice, { name: roomName, members: [bob] })

  const alicePage = await newPage(browser)
  const bobPage = await newPage(browser)
  for (const page of [alicePage, bobPage]) {
    await page.addInitScript(() => {
      const cues: string[] = []
      ;(window as unknown as { __cues: string[] }).__cues = cues
      const play = HTMLMediaElement.prototype.play
      HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
        if (this.dataset.cue) cues.push(this.dataset.cue)
        return play.call(this)
      }
    })
  }
  const cues = (page: Page) => page.evaluate(() => (window as unknown as { __cues: string[] }).__cues)

  await login(alicePage, alice)
  await login(bobPage, bob)
  await openRoom(alicePage, roomName)
  await openRoom(bobPage, roomName)

  await joinVoice(alicePage)
  await expect.poll(() => cues(alicePage)).toEqual(["self-join"])
  await joinVoice(bobPage)
  await expect(tiles(bobPage)).toHaveCount(2, { timeout: 30_000 })
  // Alice was already there: Bob hears only his own join.
  await expect.poll(() => cues(bobPage)).toEqual(["self-join"])
  await expect.poll(() => cues(alicePage), { timeout: 30_000 }).toEqual(["self-join", "participant-join"])

  await alicePage.getByRole("button", { name: "Bildschirm teilen" }).last().click()
  await alicePage.getByRole("dialog", { name: "Bildschirm teilen" }).getByRole("button", { name: "Live gehen" }).click()
  await expect(alicePage.getByRole("button", { name: "Stream-Einstellungen" })).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => cues(alicePage)).toEqual(["self-join", "participant-join", "screenshare-start"])
  await expect.poll(() => cues(bobPage), { timeout: 30_000 }).toEqual(["self-join", "screenshare-start"])

  // Leaving while live is just a leave for the others, not also a stopped stream.
  await alicePage.getByRole("button", { name: "Anruf verlassen" }).click()
  await expect.poll(() => cues(alicePage)).toEqual(["self-join", "participant-join", "screenshare-start", "self-leave"])
  await expect(tiles(bobPage)).toHaveCount(1, { timeout: 30_000 })
  await expect.poll(() => cues(bobPage)).toEqual(["self-join", "screenshare-start", "participant-leave"])
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
    const requests: DisplayMediaStreamOptions[] = []
    ;(window as unknown as { __displayRequests: DisplayMediaStreamOptions[] }).__displayRequests = requests
    const getDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getDisplayMedia = (options) => {
      requests.push(options ?? {})
      return getDisplayMedia(options)
    }
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
  await expect(dialog.getByRole("switch", { name: "Systemaudio teilen" })).toBeChecked()
  await dialog.getByRole("switch", { name: "Systemaudio teilen" }).uncheck()
  await dialog.getByRole("button", { name: "Live gehen" }).click()
  await expect(alicePage.getByRole("button", { name: "Stream-Einstellungen" })).toBeVisible({ timeout: 30_000 })
  const captureRequests = () => alicePage.evaluate(() =>
    (window as unknown as { __displayRequests: DisplayMediaStreamOptions[] }).__displayRequests,
  )
  expect(await captureRequests()).toMatchObject([{ audio: false, systemAudio: "exclude" }])

  // Alice's own preview is paused by default (no <video>), and can be shown on demand.
  await expect(alicePage.getByText("Dein Stream läuft weiter!", { exact: false })).toBeVisible()
  await expect(alicePage.locator("video")).toHaveCount(0)
  await alicePage.getByRole("button", { name: "Vorschau anzeigen" }).click()
  await expect(alicePage.locator("video")).toHaveCount(1)
  await alicePage.getByRole("button", { name: "Vorschau ausblenden" }).click()
  await expect(alicePage.locator("video")).toHaveCount(0)

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

  // Bob sees that Alice is live, but nothing is downloaded until he watches.
  await expect(tiles(bobPage)).toHaveCount(3, { timeout: 30_000 })
  const watchButton = tiles(bobPage).getByRole("button", { name: "Stream ansehen" })
  await expect(watchButton).toBeVisible()
  await expect(bobPage.locator("video")).toHaveCount(0)

  // Bob watches the stream: it takes the stage and frames decode (E2EE).
  await watchButton.click()
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
  // Stop watching unsubscribes again and shows the placeholder right away, not a black tile.
  await bobPage.getByRole("menuitem", { name: "Nicht mehr ansehen" }).click()
  await expect(watchButton).toBeVisible({ timeout: 2_000 })
  await expect(bobPage.locator("video")).toHaveCount(0)

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
  await expect(dialog.getByRole("switch", { name: "Systemaudio teilen" })).not.toBeChecked()
  await dialog.getByRole("button", { name: "Abbrechen" }).click()

  // The Audio settings and Go Live dialog use the same preference, also after a reload.
  await alicePage.getByRole("button", { name: "Einstellungen", exact: true }).click()
  const settingsDialog = alicePage.getByRole("dialog", { name: "Einstellungen", exact: true })
  await settingsDialog.getByRole("tab", { name: "Audio", exact: true }).click()
  await expect(settingsDialog.getByRole("switch", { name: "Systemaudio teilen" })).not.toBeChecked()
  await settingsDialog.getByRole("switch", { name: "Systemaudio teilen" }).check()
  await alicePage.keyboard.press("Escape")
  await alicePage.reload()
  await openRoom(alicePage, roomName)
  await joinVoice(alicePage)
  await alicePage.getByRole("button", { name: "Bildschirm teilen" }).last().click()
  await expect(dialog.getByRole("switch", { name: "Systemaudio teilen" })).toBeChecked()
  await dialog.getByRole("button", { name: "Live gehen" }).click()
  await expect(alicePage.getByRole("button", { name: "Stream-Einstellungen" })).toBeVisible({ timeout: 30_000 })
  expect(await captureRequests()).toMatchObject([{
    audio: true,
    systemAudio: "include",
  }])
})

test("leaving a room during a call ends the call for the others too", async ({ browser }) => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const carol = await registerUser("carol")
  const roomName = `Leave ${Date.now().toString(36)}`
  // Three members: a room under Home, not a DM.
  const roomId = await createRoom(alice, { name: roomName, members: [bob, carol] })
  const aliceMemberships = async () => {
    const state = await matrixApi<Array<{ type: string; sender: string; content: Record<string, unknown> }>>(bob, "GET", `/rooms/${encodeURIComponent(roomId)}/state`)
    return state.filter((event) => event.type === "org.matrix.msc3401.call.member" && event.sender === alice.userId && Object.keys(event.content).length > 0).length
  }

  const alicePage = await newPage(browser)
  const bobPage = await newPage(browser)
  await login(alicePage, alice)
  await login(bobPage, bob)
  await openRoom(alicePage, roomName)
  await openRoom(bobPage, roomName)
  await joinVoice(alicePage)
  await joinVoice(bobPage)
  await expect(tiles(bobPage)).toHaveCount(2, { timeout: 30_000 })
  expect(await aliceMemberships()).toBe(1)

  await alicePage.getByRole("button", { name: new RegExp(roomName) }).first().click({ button: "right" })
  await alicePage.getByRole("menuitem", { name: "Verlassen" }).click()
  await alicePage.getByRole("alertdialog").getByRole("button", { name: "Verlassen" }).click()
  await expect(alicePage.getByRole("heading", { level: 3, name: "Freunde" })).toBeVisible()
  await expect(alicePage.getByRole("button", { name: "Anruf verlassen" })).toHaveCount(0)

  // Alice's call membership was withdrawn before she left, so no ghost stays behind for Bob.
  await expect.poll(aliceMemberships).toBe(0)
  await expect(tiles(bobPage)).toHaveCount(1, { timeout: 20_000 })
  await expect(bobPage.getByLabel(`Im Sprachkanal ${roomName}`).getByText(alice.username)).toHaveCount(0)
})
