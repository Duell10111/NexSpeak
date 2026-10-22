import { expect, test, type Page } from "@playwright/test"
import { createRoom, login, matrixApi, newPage, openRoom, registerUser, remoteAudioLevel } from "./helpers"

async function joinVoice(page: Page) {
  await page.getByRole("button", { name: "Sprachkanal beitreten" }).click()
  await expect(page.getByRole("button", { name: "Anruf verlassen" })).toBeVisible({ timeout: 30_000 })
}

const DISCOVERY_PATTERNS = ["**/_matrix/client/**/rtc/transports", "**/.well-known/matrix/client"]
// Same lifetime as DISCOVERY_CACHE_MS in packages/core/src/matrix/rtc.ts.
const DISCOVERY_CACHE_MS = 5 * 60_000

/** Participant tiles on the call stage (no screenshares in these tests). */
function tiles(page: Page) {
  return page.getByTestId("call-tile")
}

test("incoming DM calls can be declined, end automatically, and join from a background notification", async ({ browser }) => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const roomName = `Incoming ${Date.now().toString(36)}`
  const roomId = await createRoom(alice, { name: roomName, members: [bob], encrypted: true })
  for (const [user, other] of [[alice, bob], [bob, alice]]) {
    await matrixApi(user, "PUT", `/user/${encodeURIComponent(user.userId)}/account_data/m.direct`, { [other.userId]: [roomId] })
  }
  const otherRoom = `Elsewhere ${Date.now().toString(36)}`
  await createRoom(bob, { name: otherRoom, members: [] })
  const alicePage = await newPage(browser)
  const bobPage = await newPage(browser)
  // Exercise the same notification API that Electron presents natively, without depending on OS permissions.
  await bobPage.addInitScript(() => {
    type CallNotification = { title: string; body?: string; closed: boolean; onclick?: () => void }
    const notifications: CallNotification[] = []
    ;(window as unknown as { __callNotifications: CallNotification[] }).__callNotifications = notifications
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true })
    document.hasFocus = () => false
    window.Notification = class {
      static permission = "granted"
      title: string
      body?: string
      closed = false
      onclick?: () => void
      constructor(title: string, options: NotificationOptions) {
        this.title = title
        this.body = options.body
        notifications.push(this)
      }
      close() { this.closed = true }
    } as unknown as typeof Notification
  })
  await login(alicePage, alice)
  await login(bobPage, bob)
  await openRoom(alicePage, roomName)
  await openRoom(bobPage, otherRoom)
  const start = async () => {
    await alicePage.getByRole("button", { name: "Anruf starten", exact: true }).click()
    await expect(alicePage.getByRole("button", { name: "Anruf verlassen" })).toBeVisible({ timeout: 30_000 })
  }
  const prompt = bobPage.getByRole("alertdialog", { name: "Eingehender Anruf" })
  await start()
  await expect(prompt).toContainText(alice.username)
  await expect(prompt).toContainText(roomName)
  await prompt.getByRole("button", { name: "Ablehnen" }).click()
  await expect(prompt).toHaveCount(0)
  await expect(alicePage.getByRole("button", { name: "Anruf verlassen" })).toBeVisible()
  await expect(bobPage.getByRole("button", { name: "Anruf verlassen" })).toHaveCount(0)
  await alicePage.getByRole("button", { name: "Anruf verlassen" }).click()
  await expect(bobPage.getByLabel(`Im Sprachkanal ${roomName}`)).toHaveCount(0)

  // A later call rings again; ending it removes both its prompt and system notification.
  await start()
  await expect(prompt).toBeVisible()
  await alicePage.getByRole("button", { name: "Anruf verlassen" }).click()
  await expect(prompt).toHaveCount(0)
  await expect.poll(() => bobPage.evaluate(() =>
    (window as unknown as { __callNotifications: { closed: boolean }[] }).__callNotifications.every((notification) => notification.closed),
  )).toBe(true)

  await start()
  await expect(prompt).toBeVisible()
  await bobPage.evaluate(() => {
    const notifications = (window as unknown as { __callNotifications: { onclick?: () => void }[] }).__callNotifications
    notifications.at(-1)!.onclick!()
  })
  await prompt.getByRole("button", { name: "Beitreten" }).click()
  await expect(prompt).toHaveCount(0)
  await expect(tiles(bobPage)).toHaveCount(2, { timeout: 30_000 })
  await expect(bobPage.getByRole("button", { name: "Anruf verlassen" })).toBeVisible()
  // The worker-scoped browser outlives this test; open microphones would starve later captures.
  await alicePage.context().close()
  await bobPage.context().close()
})

/** Sustained, audible input: the default fake mic's brief beeps can miss the SFU's activity window. */
async function continuousMicrophone(page: Page) {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext()
      const source = context.createOscillator()
      const gain = context.createGain()
      const output = context.createMediaStreamDestination()
      source.frequency.value = 440
      gain.gain.value = 0.1
      source.connect(gain).connect(output)
      source.start()
      await context.resume()
      const track = output.stream.getAudioTracks()[0]
      const stop = track.stop.bind(track)
      track.stop = () => { stop(); void context.close() }
      return output.stream
    }
  })
}

for (const encrypted of [false, true]) {
  test(`voice call via MatrixRTC + LiveKit (${encrypted ? "E2EE" : "unencrypted"})`, async ({ browser }) => {
    const alice = await registerUser("alice")
    const bob = await registerUser("bob")
    const roomName = `Voice ${encrypted ? "E2EE " : ""}${Date.now().toString(36)}`
    await createRoom(alice, { name: roomName, members: [bob], encrypted })

    const alicePage = await newPage(browser)
    const bobPage = await newPage(browser)
    await bobPage.addInitScript(() => localStorage.setItem("nexspeak:callTimings", "1"))
    const timingPhases = new Set<string>()
    bobPage.on("console", (message) => {
      if (message.type() !== "info" || !message.text().startsWith("[call timing]")) return
      void message.args()[1]?.jsonValue().then((timing: { phase: string }) => timingPhases.add(timing.phase))
    })
    await continuousMicrophone(alicePage)
    await continuousMicrophone(bobPage)
    await login(alicePage, alice)
    await login(bobPage, bob)
    await openRoom(alicePage, roomName)
    await openRoom(bobPage, roomName)

    // Alice starts the call, so she has to discover her own service.
    let aliceDiscoveryRequests = 0
    let aliceDiscoveredAt = 0
    for (const pattern of DISCOVERY_PATTERNS) {
      await alicePage.route(pattern, (route) => {
        aliceDiscoveryRequests++
        aliceDiscoveredAt ||= Date.now()
        return route.continue()
      })
    }
    await joinVoice(alicePage)
    expect(aliceDiscoveryRequests).toBeGreaterThan(0)
    // The local speaking indicator must also work before anyone else joins.
    const localSpeaking = tiles(alicePage).filter({ hasText: alice.username }).locator(".ring-nx-online")
    await expect.poll(() => localSpeaking.count(), { timeout: 20_000, intervals: [50] }).toBe(1)
    // Bob sees the running call in the room list before joining.
    await expect(bobPage.getByText(alice.username).first()).toBeVisible()
    const duration = bobPage.getByLabel(/^Anruf läuft seit /)
    await expect(duration).toHaveText(/^\d+:\d{2}$/)
    const initialDuration = await duration.textContent()
    await expect(duration).not.toHaveText(initialDuration!)

    // An advertised service must work even if Bob's own discovery never responds.
    // Hold any accidental request until after remote audio verification: no timing threshold.
    let discoveryRequests = 0
    let releaseDiscovery!: () => void
    const discoveryBlocked = new Promise<void>((resolve) => { releaseDiscovery = resolve })
    for (const pattern of DISCOVERY_PATTERNS) {
      await bobPage.route(pattern, async (route) => {
        discoveryRequests++
        await discoveryBlocked
        await route.abort()
      })
    }
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
    await expect.poll(() => remoteAudioLevel(alicePage), { timeout: 30_000 }).toBeGreaterThan(5)
    expect(discoveryRequests).toBe(0)
    releaseDiscovery()
    await expect.poll(() => [...timingPhases].sort()).toEqual(["connection", "memberships", "microphone", "openid", "token-exchange"])
    const remoteSpeaking = tiles(bobPage).filter({ hasText: alice.username }).locator(".ring-nx-online")
    await expect.poll(() => remoteSpeaking.count(), { timeout: 20_000, intervals: [50] }).toBe(1)

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
    await expect(localSpeaking).toHaveCount(0)
    await expect(remoteSpeaking).toHaveCount(0)
    // ... and in the voice channel's member list in the sidebar.
    await expect(bobPage.getByLabel(`Im Sprachkanal ${roomName}`).getByLabel("Stummgeschaltet")).toBeVisible()

    // Leaving updates the other side.
    await alicePage.getByRole("button", { name: "Anruf verlassen" }).click()
    await expect(tiles(bobPage)).toHaveCount(1, { timeout: 30_000 })
    await expect(duration).toHaveCount(1)
    await bobPage.getByRole("button", { name: "Anruf verlassen" }).click()
    await expect(duration).toHaveCount(0)
    await expect(alicePage.getByLabel(/^Anruf läuft seit /)).toHaveCount(0)

    // A new call uses a fresh timestamp and reuses discovery within the same client.
    // The cache entry expires no earlier than five minutes after the first request, so only a
    // slower run may legitimately look up again.
    const requestsBeforeRepeat = aliceDiscoveryRequests
    const cached = Date.now() - aliceDiscoveredAt < DISCOVERY_CACHE_MS
    await joinVoice(alicePage)
    await expect(duration).toHaveText(/^0:0\d$/)
    if (cached) expect(aliceDiscoveryRequests).toBe(requestsBeforeRepeat)
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

test("streamers see who watches and hear cues when someone starts or stops watching", async ({ browser }) => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const roomName = `Zuschauer ${Date.now().toString(36)}`
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
  const viewerCues = (page: Page) =>
    page.evaluate(() => (window as unknown as { __cues: string[] }).__cues.filter((cue) => cue.startsWith("viewer-")))

  await login(alicePage, alice)
  await login(bobPage, bob)
  await openRoom(alicePage, roomName)
  await openRoom(bobPage, roomName)
  await joinVoice(alicePage)
  await joinVoice(bobPage)
  await expect(tiles(alicePage)).toHaveCount(2, { timeout: 30_000 })

  await alicePage.getByRole("button", { name: "Bildschirm teilen" }).last().click()
  await alicePage.getByRole("dialog", { name: "Bildschirm teilen" }).getByRole("button", { name: "Live gehen" }).click()
  await expect(alicePage.getByRole("button", { name: "Stream-Einstellungen" })).toBeVisible({ timeout: 30_000 })
  const viewers = alicePage.getByTestId("stream-viewers")
  await expect(viewers).toHaveCount(0)

  // Bob watches: Alice sees him in the count and the list, and hears the cue.
  const watchButton = tiles(bobPage).getByRole("button", { name: "Stream ansehen" })
  await watchButton.click({ timeout: 30_000 })
  await expect(viewers).toHaveAccessibleName("1 Zuschauer", { timeout: 15_000 })
  await expect.poll(() => viewerCues(alicePage)).toEqual(["viewer-join"])
  await viewers.hover()
  const list = alicePage.getByRole("dialog").filter({ hasText: "Zuschauer deines Streams" })
  await expect(list).toContainText(bob.username)

  await tiles(bobPage).filter({ hasText: "Live" }).first().click({ button: "right" })
  await bobPage.getByRole("menuitem", { name: "Nicht mehr ansehen" }).click()
  await expect(viewers).toHaveCount(0, { timeout: 15_000 })
  await expect.poll(() => viewerCues(alicePage)).toEqual(["viewer-join", "viewer-leave"])

  // Leaving the call while watching is only a participant leave.
  await alicePage.waitForTimeout(1_600) // CUE_THROTTLE_MS in call-sounds.ts
  await watchButton.click()
  await expect(viewers).toHaveAccessibleName("1 Zuschauer", { timeout: 15_000 })
  await expect.poll(() => viewerCues(alicePage)).toEqual(["viewer-join", "viewer-leave", "viewer-join"])
  await bobPage.getByRole("button", { name: "Anruf verlassen" }).click()
  await expect(viewers).toHaveCount(0, { timeout: 30_000 })
  await expect
    .poll(() => alicePage.evaluate(() => (window as unknown as { __cues: string[] }).__cues.at(-1)))
    .toBe("participant-leave")
  expect(await viewerCues(alicePage)).toEqual(["viewer-join", "viewer-leave", "viewer-join"])
  // Only the streamer hears them.
  expect(await viewerCues(bobPage)).toEqual([])
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

test("an E2EE stream pops out using the same video across call layouts and channel navigation", async ({ browser }) => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const roomName = `Pop-out ${Date.now().toString(36)}`
  const otherRoom = `Other ${Date.now().toString(36)}`
  await createRoom(alice, { name: roomName, members: [bob], encrypted: true })
  await createRoom(bob, { name: otherRoom, members: [] })
  const alicePage = await newPage(browser)
  const bobPage = await newPage(browser)
  await login(alicePage, alice)
  await login(bobPage, bob)
  await openRoom(alicePage, roomName)
  await openRoom(bobPage, roomName)
  await joinVoice(alicePage)
  await joinVoice(bobPage)
  await expect(tiles(bobPage)).toHaveCount(2, { timeout: 30_000 })

  await alicePage.getByRole("button", { name: "Bildschirm teilen" }).last().click()
  await alicePage.getByRole("dialog", { name: "Bildschirm teilen" }).getByRole("button", { name: "Live gehen" }).click()
  await tiles(bobPage).getByRole("button", { name: "Stream ansehen", exact: true }).click()
  const stream = tiles(bobPage).filter({ hasText: alice.username }).filter({ hasText: "Live" })
  await expect(stream.locator("video")).toHaveJSProperty("readyState", 4, { timeout: 30_000 })
  await stream.locator("video").evaluate((video) => {
    ;(window as unknown as { __popoutVideo: HTMLVideoElement }).__popoutVideo = video as HTMLVideoElement
  })
  type PipWindow = Window & {
    documentPictureInPicture: { window: Window | null }
    __popoutVideo: HTMLVideoElement
  }
  const pipState = () => bobPage.evaluate(() => {
    const main = window as unknown as PipWindow
    const pip = main.documentPictureInPicture.window
    const video = pip?.document.querySelector("video")
    return {
      open: !!pip && !pip.closed,
      sameVideo: video === main.__popoutVideo,
      videos: pip?.document.querySelectorAll("video").length ?? 0,
      frames: video?.getVideoPlaybackQuality().totalVideoFrames ?? 0,
      width: video?.clientWidth ?? 0,
      windowWidth: pip?.innerWidth ?? 0,
    }
  })
  const openPip = async () => {
    await stream.getByRole("button", { name: "In eigenem Fenster öffnen" }).click()
    await expect.poll(pipState).toMatchObject({ open: true, sameVideo: true, videos: 1 })
    await expect(stream.getByRole("button", { name: "Zurück zum Anruf", exact: true }).first()).toBeVisible()
    await expect(stream.locator("video")).toHaveCount(0)
  }
  await openPip()
  const before = (await pipState()).frames
  await expect.poll(async () => (await pipState()).frames).toBeGreaterThan(before)

  // LiveKit observes the actual PiP viewport; headless Chromium may ignore resizeTo.
  await bobPage.evaluate(() => (window as unknown as PipWindow).documentPictureInPicture.window!.resizeTo(400, 250))
  await expect.poll(async () => {
    const state = await pipState()
    return state.width > 0 && state.width === state.windowWidth
  }).toBe(true)

  await stream.getByRole("button", { name: "Fokus beenden", exact: true }).click()
  await expect.poll(pipState).toMatchObject({ open: true, sameVideo: true })
  await openRoom(bobPage, otherRoom)
  const afterNavigation = (await pipState()).frames
  await expect.poll(async () => (await pipState()).frames).toBeGreaterThan(afterNavigation)
  await openRoom(bobPage, roomName)
  await expect.poll(pipState).toMatchObject({ open: true, sameVideo: true })

  // Native close and the explicit return button both restore the same element.
  await bobPage.evaluate(() => (window as unknown as PipWindow).documentPictureInPicture.window!.close())
  await expect(stream.locator("video")).toHaveCount(1)
  await expect.poll(() => stream.locator("video").evaluate((video) => video === (window as unknown as PipWindow).__popoutVideo)).toBe(true)
  await openPip()
  await bobPage.evaluate(() => (window as unknown as PipWindow).documentPictureInPicture.window!.document.querySelector("button")!.click())
  await expect(stream.locator("video")).toHaveCount(1)

  await openPip()
  await alicePage.getByRole("button", { name: "Stream-Einstellungen", exact: true }).click()
  await alicePage.getByRole("menuitem", { name: "Stream beenden", exact: true }).click()
  await expect.poll(async () => (await pipState()).open).toBe(false)

  // Camera tiles offer the same action; leaving the call closes their PiP too.
  await alicePage.getByRole("button", { name: "Kamera einschalten", exact: true }).last().click()
  const camera = tiles(bobPage).filter({ hasText: alice.username })
  await expect(camera.locator("video")).toHaveJSProperty("readyState", 4, { timeout: 30_000 })
  await camera.getByRole("button", { name: "In eigenem Fenster öffnen" }).click()
  await expect.poll(async () => (await pipState()).open).toBe(true)
  await bobPage.getByRole("button", { name: "Anruf verlassen", exact: true }).last().click()
  await expect.poll(async () => (await pipState()).open).toBe(false)
})
