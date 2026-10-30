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

test("audio settings enumerate devices without opening the microphone", async ({ browser }) => {
  const user = await registerUser("audio-devices")
  const page = await newPage(browser)
  await page.addInitScript(() => {
    const scope = window as typeof window & { microphoneRequests: number; deviceRevision: number }
    scope.microphoneRequests = 0
    scope.deviceRevision = 0
    const media = navigator.mediaDevices
    const capture = media.getUserMedia.bind(media)
    media.getUserMedia = (constraints) => {
      if (constraints?.audio) scope.microphoneRequests++
      return capture(constraints)
    }
    const enumerate = media.enumerateDevices.bind(media)
    media.enumerateDevices = async () => [
      ...await enumerate(),
      { deviceId: "test-microphone", kind: "audioinput", label: `Test microphone ${scope.deviceRevision}`, groupId: "test" } as MediaDeviceInfo,
    ]
  })
  await login(page, user)
  await page.getByRole("button", { name: "Einstellungen", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Einstellungen", exact: true })
  const input = dialog.getByRole("combobox", { name: "Eingabegerät (Mikrofon)", exact: true })
  await input.click()
  await expect(page.getByRole("option", { name: "Test microphone 0", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  expect(await page.evaluate(() => (window as typeof window & { microphoneRequests: number }).microphoneRequests)).toBe(0)

  await page.evaluate(() => {
    ;(window as typeof window & { deviceRevision: number }).deviceRevision++
    navigator.mediaDevices.dispatchEvent(new Event("devicechange"))
  })
  await input.click()
  await expect(page.getByRole("option", { name: "Test microphone 1", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  expect(await page.evaluate(() => (window as typeof window & { microphoneRequests: number }).microphoneRequests)).toBe(0)

  await dialog.getByRole("button", { name: "Mikrofon testen", exact: true }).click()
  await expect(dialog.getByRole("progressbar", { name: "Mikrofonpegel" })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as typeof window & { microphoneRequests: number }).microphoneRequests)).toBe(1)
  await dialog.getByRole("button", { name: "Mikrofontest stoppen" }).click()
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Einstellungen", exact: true }).click()
  await input.click()
  await expect(page.getByRole("option", { name: "Test microphone 1", exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as typeof window & { microphoneRequests: number }).microphoneRequests)).toBe(1)
  await page.context().close()
})

test("audio settings handle hidden device IDs without prompting and refresh after an explicit microphone test", async ({ browser }) => {
  const user = await registerUser("audio-permission")
  const page = await newPage(browser)
  await page.addInitScript(() => {
    let captured = false
    // Browsers without a microphone permission query must still list devices safely.
    const query = navigator.permissions.query.bind(navigator.permissions)
    navigator.permissions.query = (descriptor) => descriptor.name === ("microphone" as PermissionName)
      ? Promise.reject(new TypeError("Unsupported permission")) : query(descriptor)
    const media = navigator.mediaDevices
    const capture = media.getUserMedia.bind(media)
    media.getUserMedia = async (constraints) => {
      const stream = await capture(constraints)
      captured = true
      return stream
    }
    media.enumerateDevices = async () => [
      { deviceId: captured ? "test-microphone" : "", kind: "audioinput", label: captured ? "Unhidden microphone" : "", groupId: "" } as MediaDeviceInfo,
      { deviceId: "", kind: "audiooutput", label: "", groupId: "" } as MediaDeviceInfo,
    ]
  })
  await login(page, user)
  await page.getByRole("button", { name: "Einstellungen", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Einstellungen", exact: true })
  await expect(dialog.getByText("Gerätenamen werden eventuell erst", { exact: false })).toBeVisible()
  const input = dialog.getByRole("combobox", { name: "Eingabegerät (Mikrofon)", exact: true })
  await input.click()
  await expect(page.getByRole("option")).toHaveCount(1)
  await expect(page.getByRole("option", { name: "Systemstandard", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")

  await dialog.getByRole("button", { name: "Mikrofon testen", exact: true }).click()
  await expect(dialog.getByText("Gerätenamen werden eventuell erst", { exact: false })).toHaveCount(0)
  await input.click()
  await expect(page.getByRole("option", { name: "Unhidden microphone", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  await dialog.getByRole("button", { name: "Mikrofontest stoppen" }).click()
  await page.context().close()
})

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
  const meter = dialog.getByRole("progressbar", { name: "Mikrofonpegel" }).locator('[data-slot="progress-indicator"]')
  const expectMeterSignal = async () => {
    // Let samples from before a graph change drain before checking the live meter.
    await page.waitForTimeout(250)
    await expect.poll(() => meter.getAttribute("style")).not.toContain("translateX(-100%)")
  }
  await expectMeterSignal()
  await expect(dialog.getByText("Unter der Schwelle – wird nicht gesendet")).toBeVisible()
  await expect(dialog.getByText("Wird gesendet", { exact: true })).toHaveCount(0)
  // Deliberately wait past the previous five-second deadline: testing remains active.
  await page.waitForTimeout(5500)
  await expect(dialog.getByRole("button", { name: "Mikrofontest stoppen" })).toBeEnabled()

  // Moving the threshold below the beeps opens the running gate without restarting.
  await slider.focus()
  await page.keyboard.press("Home")
  await expect(dialog.getByText("Wird gesendet", { exact: true })).toBeVisible()
  await slider.focus()
  await page.keyboard.press("End")
  await expect(dialog.getByText("Unter der Schwelle – wird nicht gesendet")).toBeVisible()
  // Re-enabling sensitivity starts with a closed gate even after the bypass was transmitting.
  await dialog.getByRole("switch", { name: "Eingangsempfindlichkeit" }).click()
  await expect(dialog.getByText("Sprich jetzt…", { exact: true })).toBeVisible()
  await expectMeterSignal()
  await dialog.getByRole("switch", { name: "Eingangsempfindlichkeit" }).click()
  await expect(dialog.getByText("Unter der Schwelle – wird nicht gesendet")).toBeVisible()
  await expectMeterSignal()
  await slider.focus()
  await page.keyboard.press("Home")
  await expect(dialog.getByText("Wird gesendet", { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "Mikrofontest stoppen" }).click()
  await expect(dialog.getByRole("progressbar", { name: "Mikrofonpegel" })).toHaveCount(0)
  await expect(dialog.getByRole("button", { name: "Mikrofon testen" })).toBeEnabled()

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
  const localAliceTile = alicePage.getByTestId("call-tile").filter({ hasText: alice.username })
  await expect.poll(() => localAliceTile.locator(".ring-nx-online").count(), { intervals: [50] }).toBe(1)

  // A threshold above the beeps closes the gate in the running call; others don't see a mute.
  await alicePage.getByRole("button", { name: "Einstellungen" }).click()
  const dialog = alicePage.getByRole("dialog", { name: "Einstellungen" })
  await dialog.getByRole("slider", { name: "Eingangsempfindlichkeit" }).focus()
  await alicePage.keyboard.press("End")
  await expect.poll(() => remoteAudioLevel(bobPage), { timeout: 20_000 }).toBeLessThanOrEqual(2)
  const aliceTile = bobPage.getByTestId("call-tile").filter({ hasText: alice.username })
  await expect(aliceTile.getByLabel("Stummgeschaltet")).toHaveCount(0)
  await expect(localAliceTile.locator(".ring-nx-online")).toHaveCount(0)

  // LiveKit restores the raw track during replacement. A slow RNNoise load must not bypass the gate.
  let releaseBinary!: () => void
  const binaryHeld = new Promise<void>((resolve) => { releaseBinary = resolve })
  await alicePage.route("**/audio-processing/rnnoise*.wasm", async (route) => {
    await binaryHeld
    await route.continue()
  })
  const binaryRequested = alicePage.waitForRequest(/\/audio-processing\/rnnoise.*\.wasm/)
  try {
    await dialog.getByRole("combobox", { name: "Rauschunterdrückung" }).click()
    await alicePage.getByRole("option", { name: "Verbessert (RNNoise)" }).click()
    await binaryRequested
    expect(await remoteAudioLevel(bobPage)).toBeLessThanOrEqual(2)
    await expect(aliceTile.getByLabel("Stummgeschaltet")).toHaveCount(0)
  } finally {
    releaseBinary()
  }

  // With the gate off everything is sent again, including after the sender resumes.
  await dialog.getByRole("switch", { name: "Eingangsempfindlichkeit" }).click()
  await expect.poll(() => remoteAudioLevel(bobPage), { timeout: 20_000 }).toBeGreaterThan(5)

  // Echo cancellation can only change by reopening the microphone; the processor survives that.
  await dialog.getByRole("switch", { name: "Echounterdrückung" }).click()
  await expect.poll(() => remoteAudioLevel(bobPage), { timeout: 20_000 }).toBeGreaterThan(5)
})

type MicrophoneTestWindow = typeof window & {
  microphoneTestStreams: MediaStream[]
  microphoneTestContexts: AudioContext[]
}

for (const outcome of ["load failure", "close while loading", "stop while loading"] as const) {
  test(`microphone test releases its resources on ${outcome}`, async ({ browser }) => {
    const user = await registerUser("mic-cleanup")
    const page = await newPage(browser)
    await page.addInitScript(() => {
      const scope = window as MicrophoneTestWindow
      scope.microphoneTestStreams = []
      scope.microphoneTestContexts = []
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = await getUserMedia(constraints)
        scope.microphoneTestStreams.push(stream)
        return stream
      }
      const Context = window.AudioContext
      window.AudioContext = class extends Context {
        constructor(options?: AudioContextOptions) {
          super(options)
          scope.microphoneTestContexts.push(this)
        }
      }
    })
    await login(page, user)
    await page.getByRole("button", { name: "Einstellungen" }).click()
    const dialog = page.getByRole("dialog", { name: "Einstellungen" })
    await dialog.getByRole("combobox", { name: "Rauschunterdrückung" }).click()
    await page.getByRole("option", { name: "Verbessert (RNNoise)" }).click()

    let releaseBinary!: () => void
    const binaryHeld = new Promise<void>((resolve) => { releaseBinary = resolve })
    await page.route("**/audio-processing/rnnoise*.wasm", async (route) => {
      if (outcome !== "load failure") await binaryHeld
      await route.abort()
    })
    const binaryRequested = page.waitForRequest(/\/audio-processing\/rnnoise.*\.wasm/)
    try {
      await dialog.getByRole("button", { name: "Mikrofon testen" }).click()
      await binaryRequested
      if (outcome === "load failure") {
        await expect(page.getByText("Mikrofon konnte nicht geöffnet werden. Bitte prüfe die Berechtigungen.")).toBeVisible()
        await expect(dialog.getByRole("button", { name: "Mikrofon testen" })).toBeEnabled()
      } else {
        await expect(dialog.getByRole("button", { name: "Mikrofontest stoppen" })).toBeEnabled()
      }
      if (outcome === "stop while loading") {
        await dialog.getByRole("button", { name: "Mikrofontest stoppen" }).click()
        await expect(dialog.getByRole("button", { name: "Mikrofon testen" })).toBeEnabled()
      } else {
        await page.keyboard.press("Escape")
        await expect(dialog).not.toBeVisible()
      }
      // Check while the download is still pending: closing must release resources immediately.
      await expect.poll(() => page.evaluate(() => {
        const scope = window as MicrophoneTestWindow
        return {
          captured: scope.microphoneTestStreams.length > 0 && scope.microphoneTestContexts.length > 0,
          liveTracks: scope.microphoneTestStreams.flatMap((stream) => stream.getTracks()).filter((track) => track.readyState === "live").length,
          openContexts: scope.microphoneTestContexts.filter((context) => context.state !== "closed").length,
        }
      })).toEqual({ captured: true, liveTracks: 0, openContexts: 0 })
    } finally {
      releaseBinary()
    }
  })
}

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
