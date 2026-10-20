import { spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { release, tmpdir } from "node:os"
import { join } from "node:path"
import { _electron as electron, chromium, expect, test, type ElectronApplication, type Page } from "@playwright/test"
import { supportsSystemAudio } from "../src/display-media"
import {
  createLoginToken,
  createRoom,
  HOMESERVER_URL,
  login,
  openRoom,
  registerUser,
  remoteAudioLevel,
  sendMessage,
  sendTextAs,
} from "../../web/e2e/helpers"

const APP_DIR = join(__dirname, "..")
const WEB_PORT = 3101

let app: ElectronApplication
let page: Page
let userDataDir: string

/** Starts the app with a fresh profile; `extraArgs` like the OS passes a deep link. */
async function launch(extraArgs: string[] = []) {
  userDataDir = mkdtempSync(join(tmpdir(), "nexspeak-desktop-e2e-"))
  app = await electron.launch({
    args: [
      APP_DIR,
      `--user-data-dir=${userDataDir}`,
      // The tests use the German UI, like the web tests.
      "--lang=de-DE",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      ...extraArgs,
    ],
  })
  page = await app.firstWindow()
  page.on("pageerror", (error) => console.log(`[pageerror] ${error.message}`))
}

test.beforeEach(async () => {
  await launch()
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
      systemAudio: window.nexspeak?.supportsSystemAudio,
      secureContext: isSecureContext,
      nodeInRenderer: typeof (window as { require?: unknown }).require !== "undefined",
      workerType: worker.headers.get("content-type"),
      frameOptions: worker.headers.get("x-frame-options"),
      h264: RTCRtpSender.getCapabilities("video")?.codecs.some((codec) => codec.mimeType === "video/H264"),
      // Granted by the app itself (the fake media UI flag would hide a denial for getUserMedia).
      notifications: Notification.permission,
      microphone: (await navigator.permissions.query({ name: "microphone" as PermissionName })).state,
      geolocation: (await navigator.permissions.query({ name: "geolocation" })).state,
    }
  })
  expect(info).toEqual({
    bridge: "function",
    systemAudio: supportsSystemAudio(process.platform, release()),
    secureContext: true,
    nodeInRenderer: false,
    workerType: "text/javascript; charset=utf-8",
    frameOptions: "DENY",
    h264: true,
    notifications: "granted",
    microphone: "granted",
    geolocation: "denied",
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

  // What the main process sends when getDisplayMedia needs our picker (macOS, Windows, X11).
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
  await expect.poll(lastLabels).toMatchObject({ show: "Open NexSpeak", restartToUpdate: "Restart to update", quit: "Quit NexSpeak" })
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

test("call shortcuts are assigned, checked against each other and PTT, cleared and persisted", async () => {
  const alice = await registerUser("alice")
  await login(page, alice, "app://nexspeak/login")
  await page.getByRole("button", { name: "Einstellungen", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Einstellungen" })
  const shortcuts = dialog.getByRole("region", { name: "Globale Anruf-Tastenkürzel" })
  const mute = shortcuts.getByRole("group", { name: "Stummschaltung umschalten", exact: true })
  const deafen = shortcuts.getByRole("group", { name: "Taubschaltung umschalten", exact: true })
  await expect(shortcuts.getByText("Nicht belegt", { exact: true })).toHaveCount(4)
  await mute.getByRole("button", { name: "Taste festlegen" }).click()
  await page.keyboard.press("Control+Shift+KeyM")
  await expect(mute.getByText("Ctrl + Shift + M", { exact: true })).toBeVisible()
  await deafen.getByRole("button", { name: "Taste festlegen" }).click()
  await page.keyboard.press("Control+Shift+KeyM")
  await expect(shortcuts.getByRole("alert")).toContainText("überschneidet sich")
  await page.keyboard.press("Escape")
  await expect(dialog).toBeVisible()
  await deafen.getByRole("button", { name: "Taste festlegen" }).click()
  await page.keyboard.press("Control+Shift+KeyD")

  await dialog.getByRole("radio", { name: "Push-to-Talk" }).click()
  await dialog.getByRole("button", { name: "Taste festlegen", exact: true }).first().click()
  await page.keyboard.press("KeyM")
  await expect(dialog.getByRole("alert")).toContainText("überschneidet sich")
  await dialog.getByRole("button", { name: "Taste festlegen", exact: true }).first().click()
  await page.keyboard.press("KeyT")
  const leave = shortcuts.getByRole("group", { name: "Anruf verlassen" })
  await leave.getByRole("button", { name: "Taste festlegen" }).click()
  await page.keyboard.press("Control+Shift+KeyT")
  await expect(shortcuts.getByRole("alert")).toContainText("überschneidet sich")
  await page.keyboard.press("Escape")
  await mute.getByRole("button", { name: "Entfernen" }).click()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("nexspeak_audio_settings") ?? "{}"))).toMatchObject({
    pushToTalkKey: "KeyT", callShortcuts: { "toggle-mute": null, "toggle-deafen": { accelerator: "Control+Shift+D" } },
  })
  expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0)
  await page.reload()
  await page.getByRole("button", { name: "Einstellungen", exact: true }).click()
  await expect(page.getByText("Ctrl + Shift + D", { exact: true })).toBeVisible()
  expect(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("Control+Shift+D"))).toBe(false)
})

test("global shortcuts register only in calls, pause during capture and dispatch call actions", async () => {
  // Exercise the callbacks supplied to the real native registration API, without sending OS input.
  await app.evaluate(({ globalShortcut }) => {
    const callbacks = new Map<string, () => void>()
    const register = globalShortcut.register.bind(globalShortcut)
    globalShortcut.register = (accelerator, callback) => {
      callbacks.set(accelerator, callback)
      return register(accelerator, callback)
    }
    ;(globalThis as typeof globalThis & { shortcutCallbacks: Map<string, () => void> }).shortcutCallbacks = callbacks
  })
  const fire = (accelerator: string) => app.evaluate((_, key) => {
    const callback = (globalThis as typeof globalThis & { shortcutCallbacks: Map<string, () => void> }).shortcutCallbacks.get(key)
    if (!callback) throw new Error(`Shortcut not registered: ${key}`)
    callback()
  }, accelerator)
  const registered = (accelerator: string) => app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), accelerator)
  const alice = await registerUser("alice")
  const roomName = `Shortcuts ${Date.now().toString(36)}`
  await createRoom(alice, { name: roomName, members: [] })
  await login(page, alice, "app://nexspeak/login")
  await page.getByRole("button", { name: "Einstellungen", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Einstellungen" })
  const shortcuts = dialog.getByRole("region", { name: "Globale Anruf-Tastenkürzel" })
  const assignments = [
    ["Stummschaltung umschalten", "F6"],
    ["Taubschaltung umschalten", "F7"],
    ["Anruf verlassen", "F8"],
    ["Bildschirmfreigabe stoppen", "F9"],
  ]
  for (const [label, key] of assignments) {
    await shortcuts.getByRole("group", { name: label, exact: true }).getByRole("button", { name: "Taste festlegen" }).click()
    await page.keyboard.press(`Control+Alt+Shift+${key}`)
    expect(await registered(`Control+Alt+Shift+${key}`)).toBe(false)
  }
  await page.keyboard.press("Escape")
  await openRoom(page, roomName)
  await page.getByRole("button", { name: "Sprachkanal beitreten" }).click()
  await expect(page.getByRole("button", { name: "Anruf verlassen" })).toBeVisible({ timeout: 30_000 })
  for (const [, key] of assignments) await expect.poll(() => registered(`Control+Alt+Shift+${key}`)).toBe(true)
  await fire("Control+Alt+Shift+F6")
  await expect(page.getByRole("button", { name: "Mikrofon aktivieren" }).first()).toBeVisible()
  await fire("Control+Alt+Shift+F7")
  await expect(page.getByRole("button", { name: "Ton aktivieren", exact: true }).first()).toBeVisible()
  await fire("Control+Alt+Shift+F9")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  // Use the fake camera as a display source, so this test never opens an OS screen picker.
  await page.evaluate(() => {
    navigator.mediaDevices.getDisplayMedia = async () => navigator.mediaDevices.getUserMedia({ video: true })
  })
  await page.getByRole("button", { name: "Bildschirm teilen", exact: true }).last().click()
  await page.getByRole("button", { name: "Live gehen" }).click()
  await expect(page.getByRole("button", { name: "Stream-Einstellungen" })).toBeVisible({ timeout: 30_000 })
  // Presses closer together than REPEAT_WINDOW_MS (750 ms) count as one held key.
  await page.waitForTimeout(800)
  await fire("Control+Alt+Shift+F9")
  await expect(page.getByRole("button", { name: "Stream-Einstellungen" })).toBeHidden()

  await page.getByRole("button", { name: "Einstellungen", exact: true }).click()
  // A shortcut held elsewhere (even by another feature in this app) must show a useful warning.
  await app.evaluate(({ globalShortcut }) => {
    if (!globalShortcut.register("Control+Alt+Shift+F10", () => {})) throw new Error("Could not reserve test shortcut")
  })
  const stopShare = shortcuts.getByRole("group", { name: "Bildschirmfreigabe stoppen" })
  await stopShare.getByRole("button", { name: "Taste ändern" }).click()
  await page.keyboard.press("Control+Alt+Shift+F10")
  await expect(stopShare.getByRole("alert")).toContainText("konnte nicht registriert werden")
  await dialog.screenshot({ path: test.info().outputPath("shortcut-settings.png") })
  await shortcuts.getByRole("group", { name: "Anruf verlassen" }).getByRole("button", { name: "Taste ändern" }).click()
  await expect.poll(() => registered("Control+Alt+Shift+F8")).toBe(false)
  await fire("Control+Alt+Shift+F8") // A queued old callback cannot disconnect while capturing.
  await expect(dialog).toBeVisible()
  await page.keyboard.press("Escape")
  await expect.poll(() => registered("Control+Alt+Shift+F8")).toBe(true)
  await page.keyboard.press("Escape")
  await fire("Control+Alt+Shift+F8")
  await expect(page.getByRole("button", { name: "Anruf verlassen" })).toBeHidden()
  for (const [, key] of assignments) await expect.poll(() => registered(`Control+Alt+Shift+${key}`)).toBe(false)
  await app.evaluate(({ globalShortcut }) => globalShortcut.unregister("Control+Alt+Shift+F10"))
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

test("notifications are allowed, the badge counts unread messages, the window comes back", async () => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const suffix = Date.now().toString(36)
  await createRoom(alice, { name: `Ruhig ${suffix}`, members: [] })
  // Two members: a direct message, where every unread message counts.
  const directRoomId = await createRoom(alice, { name: `Direkt ${suffix}`, members: [bob] })

  await login(page, alice, "app://nexspeak/login")
  // Electron shows web notifications natively; the app grants the permission itself.
  expect(await page.evaluate(() => Notification.permission)).toBe("granted")
  // No real notifications on the test machine; the badge does not depend on them.
  await page.evaluate(() => localStorage.setItem("nexspeak_notification_settings", JSON.stringify({ enabled: false })))
  await openRoom(page, `Ruhig ${suffix}`)

  const badgeCount = () => app.evaluate(({ app }) => app.getBadgeCount())
  await sendTextAs(bob, directRoomId, "Eins")
  await sendTextAs(bob, directRoomId, "Zwei")
  if (process.platform !== "win32") await expect.poll(badgeCount, { timeout: 20_000 }).toBe(2)
  await expect(page).toHaveTitle(/^\(2\) /)

  // Reading the messages clears it.
  await openRoom(page, `Direkt ${suffix}`)
  if (process.platform !== "win32") await expect.poll(badgeCount, { timeout: 20_000 }).toBe(0)

  // A click on a notification brings the window back from the tray.
  const isVisible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await expect.poll(isVisible).toBe(false)
  await page.evaluate(() => window.nexspeak?.showWindow())
  await expect.poll(isVisible).toBe(true)
})

/** What Windows and Linux do with a link while the app runs: start a second instance with it. */
function openDeepLink(url: string) {
  return app.evaluate(({ app }, link) => {
    app.emit("second-instance", { preventDefault() {} }, [process.execPath, link], process.cwd())
  }, url)
}

test("a deep link that starts the app opens the room after login", async () => {
  const alice = await registerUser("alice")
  const room = `Tiefer Link ${Date.now().toString(36)}`
  const roomId = await createRoom(alice, { name: room, members: [] })

  await app.close()
  rmSync(userDataDir, { recursive: true, force: true })
  await launch([`nexspeak://room/${encodeURIComponent(roomId)}`])

  await login(page, alice, "app://nexspeak/login")
  await expect(page.getByRole("heading", { level: 3, name: room })).toBeVisible()
})

test("deep links bring the window back and open rooms", async () => {
  const alice = await registerUser("alice")
  const suffix = Date.now().toString(36)
  await createRoom(alice, { name: `Erster ${suffix}`, members: [] })
  const secondId = await createRoom(alice, { name: `Zweiter ${suffix}`, members: [] })
  await login(page, alice, "app://nexspeak/login")
  await openRoom(page, `Erster ${suffix}`)

  const isVisible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await expect.poll(isVisible).toBe(false)

  await openDeepLink(`nexspeak://room/${encodeURIComponent(secondId)}`)
  await expect.poll(isVisible).toBe(true)
  await expect(page.getByRole("heading", { level: 3, name: `Zweiter ${suffix}` })).toBeVisible()
})

test("the SSO login returns through nexspeak://sso", async () => {
  const alice = await registerUser("alice")
  await expect(page).toHaveURL("app://nexspeak/login")
  // What the login page remembered before opening the identity provider in the browser.
  await page.evaluate(
    (homeserverUrl) =>
      localStorage.setItem("nexspeak_sso_pending", JSON.stringify({ homeserverUrl, startedAt: Date.now() })),
    HOMESERVER_URL,
  )
  await openDeepLink(`nexspeak://sso?loginToken=${encodeURIComponent(await createLoginToken(alice))}`)
  await expect(page.getByRole("log").or(page.getByText("Wähle einen Raum aus."))).toBeVisible({ timeout: 60_000 })
  expect(await page.evaluate(() => localStorage.getItem("nexspeak_sso_pending"))).toBeNull()
})

test("autostarted at login, the app opens in the tray only", async () => {
  await app.close()
  rmSync(userDataDir, { recursive: true, force: true })
  await launch(["--hidden"])
  await expect(page).toHaveURL("app://nexspeak/login")

  const isVisible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())
  expect(await isVisible()).toBe(false)
  await app.evaluate(({ app }) => app.emit("activate"))
  await expect.poll(isVisible).toBe(true)
})

test("autostart is not offered in an unpackaged run", async () => {
  expect(await page.evaluate(() => window.nexspeak?.getAutostart())).toBeNull()
  expect(await page.evaluate(() => window.nexspeak?.setAutostart(true))).toBeNull()
})

test("a downloaded update offers a restart", async () => {
  const alice = await registerUser("alice")
  await login(page, alice, "app://nexspeak/login")

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send("nexspeak:update-status", { state: "ready", version: "9.9.9" })
  })
  await expect(page.getByText("Update auf Version 9.9.9 bereit")).toBeVisible()
  await expect(page.getByRole("button", { name: "Jetzt neu starten" })).toBeVisible()
})

test("check for updates from the menu opens Settings → About", async () => {
  const alice = await registerUser("alice")
  await login(page, alice, "app://nexspeak/login")

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send("nexspeak:show-updates")
  })
  const section = page.getByTestId("desktop-update")
  await expect(section).toBeVisible()
  await section.getByRole("button", { name: "Nach Updates suchen" }).click()
  // An unpackaged run cannot update itself.
  await expect(section.getByRole("status")).toHaveText(/kann sich nicht selbst aktualisieren/)
})
