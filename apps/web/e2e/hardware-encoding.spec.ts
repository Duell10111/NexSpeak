import { expect, test } from "@playwright/test"
import { createRoom, login, newPage, openRoom, registerUser } from "./helpers"

/**
 * Hardware encoding needs a real GPU, so this runs only on demand with the locally installed
 * Chrome (not in the Docker browsers):  E2E_HARDWARE=1 npx playwright test hardware-encoding
 */
test.skip(!process.env.E2E_HARDWARE, "set E2E_HARDWARE=1 to run on a machine with a GPU")
test.use({ channel: "chrome", headless: false })

test("screenshare is encoded in hardware, also for odd window sizes", async ({ browser }) => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const roomName = `Hardware ${Date.now().toString(36)}`
  await createRoom(alice, { name: roomName, members: [bob], encrypted: true })
  const alicePage = await newPage(browser)
  // Large HiDPI viewer, so the full-resolution layer is subscribed.
  const bobPage = await newPage(browser, { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 })
  // A moving "window" with the odd size of a MacBook window: 1728×1117.
  await alicePage.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement("canvas")
      canvas.width = 1728
      canvas.height = 1117
      const context = canvas.getContext("2d")!
      let frame = 0
      setInterval(() => {
        context.fillStyle = `hsl(${frame++ % 360} 60% 40%)`
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.fillStyle = "#fff"
        context.font = "48px sans-serif"
        context.fillText(`Frame ${frame}`, (frame * 9) % 1500, 60 + ((frame * 7) % 1000))
      }, 16)
      return canvas.captureStream(60)
    }
  })
  await login(alicePage, alice)
  await login(bobPage, bob)
  await openRoom(alicePage, roomName)
  await openRoom(bobPage, roomName)
  for (const page of [alicePage, bobPage]) {
    await page.getByRole("button", { name: "Sprachkanal beitreten" }).click()
    await expect(page.getByRole("button", { name: "Anruf verlassen" })).toBeVisible({ timeout: 30_000 })
  }

  await alicePage.getByRole("button", { name: "Bildschirm teilen" }).last().click()
  const dialog = alicePage.getByRole("dialog", { name: "Bildschirm teilen" })
  await dialog.getByRole("radio", { name: "Quelle" }).click()
  await dialog.getByRole("radio", { name: "60 FPS" }).click()
  await dialog.getByRole("button", { name: "Live gehen" }).click()

  await alicePage.getByRole("button", { name: "Stream-Einstellungen" }).click()
  const encoder = alicePage.getByTestId("encoder-status")
  await expect(encoder).toContainText("H264 · Hardware", { timeout: 30_000 })
  await expect(encoder).not.toContainText("OpenH264")
  // The bandwidth estimate needs a few seconds to ramp up to the full layer: 1728×1117 → 1726×1116.
  await expect(encoder).toContainText(/1116p · [5-6]\d FPS/, { timeout: 45_000 })
  await expect(encoder).not.toContainText("Encoder am Limit")

  await bobPage.getByTestId("call-tile").filter({ hasText: "Live" }).first().click({ button: "right" })
  await expect(bobPage.getByTestId("decoder-status")).toContainText(/1116p · [3-6]\d FPS/, { timeout: 30_000 })
})
