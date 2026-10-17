import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test"
import { createRoom, login, openRoom, registerUser, sendMessage } from "../../web/e2e/helpers"

const APP_DIR = join(__dirname, "..")

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
