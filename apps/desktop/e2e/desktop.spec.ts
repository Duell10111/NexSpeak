import { spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { _electron as electron, chromium, expect, test, type ElectronApplication, type Page } from "@playwright/test"
import { createRoom, login, openRoom, registerUser, remoteAudioLevel, sendMessage } from "../../web/e2e/helpers"

const APP_DIR = join(__dirname, "..")
const WEB_PORT = 3101

let app: ElectronApplication
let page: Page
let userDataDir: string

test.beforeEach(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), "nexspeak-desktop-e2e-"))
  app = await electron.launch({
    args: [
      APP_DIR,
      `--user-data-dir=${userDataDir}`,
      // The tests use the German UI, like the web tests.
      "--lang=de-DE",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  })
  page = await app.firstWindow()
  page.on("pageerror", (error) => console.log(`[pageerror] ${error.message}`))
})

test.afterEach(async () => {
  await app?.close()
  rmSync(userDataDir, { recursive: true, force: true })
})

test("serves the web build from app:// as a locked-down, secure origin", async () => {
  await expect(page).toHaveURL("app://nexspeak/login")
  const info = await page.evaluate(async () => {
    const worker = await fetch("/livekit-e2ee-worker.mjs")
    return {
      bridge: typeof window.nexspeak?.onChooseDisplaySource,
      secureContext: isSecureContext,
      nodeInRenderer: typeof (window as { require?: unknown }).require !== "undefined",
      workerType: worker.headers.get("content-type"),
      frameOptions: worker.headers.get("x-frame-options"),
      h264: RTCRtpSender.getCapabilities("video")?.codecs.some((codec) => codec.mimeType === "video/H264"),
    }
  })
  expect(info).toEqual({
    bridge: "function",
    secureContext: true,
    nodeInRenderer: false,
    workerType: "text/javascript; charset=utf-8",
    frameOptions: "DENY",
    h264: true,
  })
})

test("login, encrypted chat and an E2EE voice call", async () => {
  const alice = await registerUser("alice")
  const roomName = `Desktop ${Date.now().toString(36)}`
  await createRoom(alice, { name: roomName, members: [], encrypted: true })

  await login(page, alice, "app://nexspeak/login")
  await openRoom(page, roomName)
  await expect(page.getByLabel("Ende-zu-Ende-verschlüsselt").first()).toBeVisible()
  await sendMessage(page, "Hallo vom Desktop")
  await expect(page.getByTestId("message-body").filter({ hasText: "Hallo vom Desktop" })).toBeVisible()

  await page.getByRole("button", { name: "Sprachkanal beitreten" }).click()
  await expect(page.getByRole("button", { name: "Anruf verlassen" })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-testid="call-tile"][data-connecting]')).toHaveCount(0, { timeout: 30_000 })
})

test("the screen picker answers the main process", async () => {
  const alice = await registerUser("alice")
  await login(page, alice, "app://nexspeak/login")

  // What the main process sends when getDisplayMedia needs our picker (Windows, Linux on X11).
  const thumbnail =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
  const chosen = app.evaluate(
    ({ BrowserWindow, ipcMain }, sources) =>
      new Promise<unknown>((resolve) => {
        ipcMain.once("nexspeak:display-source-chosen", (_event, requestId, sourceId) => resolve({ requestId, sourceId }))
        BrowserWindow.getAllWindows()[0].webContents.send("nexspeak:choose-display-source", 7, sources)
      }),
    [
      { id: "screen:1:0", name: "Bildschirm 1", kind: "screen", thumbnail },
      { id: "window:42:0", name: "Ein Spiel", kind: "window", thumbnail },
    ],
  )

  const dialog = page.getByRole("dialog", { name: "Was möchtest du teilen?" })
  await expect(dialog.getByText("Bildschirme")).toBeVisible()
  await dialog.getByRole("button", { name: "Ein Spiel" }).click()
  expect(await chosen).toEqual({ requestId: 7, sourceId: "window:42:0" })
  await expect(dialog).toBeHidden()
})

/** Records what the web app sends to the main process on `channel` (in addition to the tray). */
async function recordIpc(channel: string) {
  await app.evaluate(({ ipcMain }, name) => {
    const store = globalThis as unknown as Record<string, unknown[]>
    store[name] = []
    ipcMain.on(name, (_event, payload) => store[name].push(payload))
  }, channel)
  return async () =>
    app.evaluate((_electron, name) => {
      const messages = (globalThis as unknown as Record<string, unknown[]>)[name]
      return messages[messages.length - 1]
    }, channel)
}

test("closing the window keeps the app running in the tray", async () => {
  await expect(page).toHaveURL("app://nexspeak/login")
  const isVisible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await expect.poll(isVisible).toBe(false)
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)

  // Dock click (macOS) or a second start of the app (Windows, Linux) brings it back.
  await app.evaluate(({ app }) => app.emit("activate"))
  await expect.poll(isVisible).toBe(true)
})

test("tray menu texts follow the interface language", async () => {
  const lastLabels = await recordIpc("nexspeak:tray-labels")
  await page.getByRole("button", { name: "English" }).click()
  await expect.poll(lastLabels).toMatchObject({ show: "Open NexSpeak", quit: "Quit NexSpeak" })
  await page.getByRole("button", { name: "Deutsch" }).click()
  await expect.poll(lastLabels).toMatchObject({ show: "NexSpeak öffnen", mute: "Mikrofon stummschalten" })
})

test("tray commands mute, deafen and leave the call", async () => {
  const alice = await registerUser("alice")
  const roomName = `Tray ${Date.now().toString(36)}`
  await createRoom(alice, { name: roomName, members: [] })
  const lastVoiceState = await recordIpc("nexspeak:voice-state")
  const trayCommand = (command: string) =>
    app.evaluate(({ BrowserWindow }, name) => {
      BrowserWindow.getAllWindows()[0].webContents.send("nexspeak:tray-command", name)
    }, command)

  await login(page, alice, "app://nexspeak/login")
  await openRoom(page, roomName)
  await page.getByRole("button", { name: "Sprachkanal beitreten" }).click()
  await expect(page.getByRole("button", { name: "Anruf verlassen" })).toBeVisible({ timeout: 30_000 })
  await expect.poll(lastVoiceState).toEqual({ muted: false, deafened: false, inCall: true })

  await trayCommand("toggle-mute")
  await expect(page.getByRole("button", { name: "Mikrofon aktivieren" }).first()).toBeVisible()
  await expect.poll(lastVoiceState).toEqual({ muted: true, deafened: false, inCall: true })

  await trayCommand("toggle-deafen")
  await expect.poll(lastVoiceState).toEqual({ muted: true, deafened: true, inCall: true })

  await trayCommand("leave-call")
  await expect(page.getByRole("button", { name: "Anruf verlassen" })).toBeHidden()
  await expect.poll(lastVoiceState).toMatchObject({ inCall: false })
})

test("the global push-to-talk key from the main process controls the microphone", async () => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const roomName = `Desktop PTT ${Date.now().toString(36)}`
  await createRoom(alice, { name: roomName, members: [bob] })

  // Bob listens in a regular browser with the same web build, served on localhost.
  const server = spawn(process.execPath, [join(__dirname, "..", "..", "web", "scripts", "serve.mjs")], {
    env: { ...process.env, PORT: String(WEB_PORT) },
    stdio: "ignore",
  })
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] })
  try {
    await expect.poll(() => fetch(`http://localhost:${WEB_PORT}/login`).then((r) => r.status).catch(() => 0)).toBe(200)
    const bobPage = await (await browser.newContext({ locale: "de-DE" })).newPage()
    await login(page, alice, "app://nexspeak/login")
    await page.evaluate(() =>
      localStorage.setItem(
        "nexspeak_audio_settings",
        JSON.stringify({ inputMode: "push-to-talk", pushToTalkKey: "KeyT", pushToTalkReleaseDelayMs: 0 }),
      ),
    )
    await login(bobPage, bob, `http://localhost:${WEB_PORT}/login`)

    for (const participant of [page, bobPage]) {
      await openRoom(participant, roomName)
      await participant.getByRole("button", { name: "Sprachkanal beitreten" }).click()
      await expect(participant.getByRole("button", { name: "Anruf verlassen" })).toBeVisible({ timeout: 30_000 })
    }
    await expect.poll(() => bobPage.locator("audio").count(), { timeout: 30_000 }).toBeGreaterThan(0)

    const pressKey = (pressed: boolean) =>
      app.evaluate(({ BrowserWindow }, value) => {
        BrowserWindow.getAllWindows()[0].webContents.send("nexspeak:ptt-pressed", value)
      }, pressed)

    expect(await remoteAudioLevel(bobPage)).toBeLessThanOrEqual(2)
    await pressKey(true)
    await expect.poll(() => remoteAudioLevel(bobPage), { timeout: 20_000 }).toBeGreaterThan(5)
    await pressKey(false)
    await expect.poll(() => remoteAudioLevel(bobPage), { timeout: 20_000 }).toBeLessThanOrEqual(2)
  } finally {
    await browser.close()
    server.kill()
  }
})
