import { expect, test, type Page } from "@playwright/test"
import { createRoom, login, newPage, openRoom, registerUser } from "./helpers"

const CAMERA_A = "test-camera-a"
const CAMERA_B = "test-camera-b"

interface CameraCaptureState {
  requests: MediaStreamConstraints[]
  streams: MediaStream[]
  hidden: string[]
  holdNext: boolean
  held: boolean
  release?: () => void
}
type CameraWindow = Window & { __cameraCapture: CameraCaptureState }

/** Synthetic device choices still capture and publish the browser's real fake-camera track. */
async function instrumentCameras(page: Page) {
  await page.addInitScript(({ cameraA, cameraB }) => {
    const state: CameraCaptureState = { requests: [], streams: [], hidden: [], holdNext: false, held: false }
    ;(window as unknown as CameraWindow).__cameraCapture = state
    const media = navigator.mediaDevices
    const enumerate = media.enumerateDevices.bind(media)
    media.enumerateDevices = async () => {
      const devices = await enumerate()
      const synthetic = [[cameraA, "Test camera A"], [cameraB, "Test camera B"]]
        .filter(([id]) => !state.hidden.includes(id))
        .map(([deviceId, label]) => ({ deviceId, label, groupId: deviceId, kind: "videoinput", toJSON() { return {} } }) as MediaDeviceInfo)
      return [...devices, ...synthetic]
    }
    const capture = media.getUserMedia.bind(media)
    media.getUserMedia = async (constraints) => {
      if (!constraints?.video) return capture(constraints)
      state.requests.push(structuredClone(constraints))
      const video = typeof constraints.video === "object" ? { ...constraints.video } : constraints.video
      if (typeof video === "object") {
        const preference = video.deviceId
        const value = typeof preference === "string" ? preference : Array.isArray(preference) ? preference[0] : preference?.exact ?? preference?.ideal
        const requested = Array.isArray(value) ? value[0] : value
        if (requested === cameraA || requested === cameraB) delete video.deviceId
      }
      const stream = await capture({ ...constraints, video })
      state.streams.push(stream)
      if (state.holdNext) {
        state.holdNext = false
        state.held = true
        await new Promise<void>((resolve) => { state.release = resolve })
        state.held = false
      }
      return stream
    }
  }, { cameraA: CAMERA_A, cameraB: CAMERA_B })
}

const liveCameraTracks = (page: Page) => page.evaluate(() =>
  (window as unknown as CameraWindow).__cameraCapture.streams
    .flatMap((stream) => stream.getVideoTracks()).filter((track) => track.readyState === "live").length,
)
const requestedCameras = (page: Page) => page.evaluate(() =>
  (window as unknown as CameraWindow).__cameraCapture.requests.map((request) => {
    const preference = typeof request.video === "object" ? request.video.deviceId : undefined
    const value = typeof preference === "string" ? preference : Array.isArray(preference) ? preference[0] : preference?.exact ?? preference?.ideal
    return (Array.isArray(value) ? value[0] : value) ?? ""
  }),
)

async function openVideoSettings(page: Page) {
  await page.getByRole("button", { name: "Einstellungen", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Einstellungen", exact: true })
  await dialog.getByRole("tab", { name: "Video", exact: true }).click()
  return dialog
}

test("camera preview is explicit, remembers its device and releases tracks on stop, tab change and close", async ({ browser }) => {
  const alice = await registerUser("camera")
  const page = await newPage(browser)
  await instrumentCameras(page)
  await login(page, alice)
  let settings = await openVideoSettings(page)
  const camera = () => settings.getByRole("combobox", { name: "Kamera", exact: true })
  const choose = async (name: string) => {
    await camera().click()
    await page.getByRole("option", { name, exact: true }).click()
  }
  await choose("Test camera B")
  expect(await requestedCameras(page)).toEqual([])
  await settings.getByRole("button", { name: "Kameravorschau starten" }).click()
  const preview = () => settings.getByLabel("Kameravorschau", { exact: true })
  await expect(preview()).toBeVisible()
  await expect.poll(() => preview().evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2)
  expect((await requestedCameras(page)).at(-1)).toBe(CAMERA_B)
  await expect.poll(() => liveCameraTracks(page)).toBe(1)
  await choose("Test camera A")
  await expect.poll(async () => (await requestedCameras(page)).at(-1)).toBe(CAMERA_A)
  await expect.poll(() => liveCameraTracks(page)).toBe(1)
  await settings.getByRole("button", { name: "Kameravorschau stoppen" }).click()
  await expect.poll(() => liveCameraTracks(page)).toBe(0)

  await settings.getByRole("button", { name: "Kameravorschau starten" }).click()
  await expect.poll(() => liveCameraTracks(page)).toBe(1)
  await settings.getByRole("tab", { name: "Profil", exact: true }).click()
  await expect.poll(() => liveCameraTracks(page)).toBe(0)
  await settings.getByRole("tab", { name: "Video", exact: true }).click()
  await settings.getByRole("button", { name: "Kameravorschau starten" }).click()
  await expect.poll(() => liveCameraTracks(page)).toBe(1)
  await page.keyboard.press("Escape")
  await expect.poll(() => liveCameraTracks(page)).toBe(0)

  await page.reload()
  await expect(page.getByRole("button", { name: "Einstellungen", exact: true })).toBeVisible()
  settings = await openVideoSettings(page)
  await expect(camera()).toHaveText("Test camera A")
  expect(await requestedCameras(page)).toEqual([])

  // A late permission result must release its tracks after the settings have already closed.
  await page.evaluate(() => { (window as unknown as CameraWindow).__cameraCapture.holdNext = true })
  await settings.getByRole("button", { name: "Kameravorschau starten" }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as CameraWindow).__cameraCapture.held)).toBe(true)
  await page.keyboard.press("Escape")
  await page.evaluate(() => (window as unknown as CameraWindow).__cameraCapture.release?.())
  await expect.poll(() => liveCameraTracks(page)).toBe(0)

  settings = await openVideoSettings(page)
  await page.evaluate((deviceId) => {
    (window as unknown as CameraWindow).__cameraCapture.hidden.push(deviceId)
    navigator.mediaDevices.dispatchEvent(new Event("devicechange"))
  }, CAMERA_A)
  await expect(camera()).toHaveText("Systemstandard")
  await settings.getByRole("button", { name: "Kameravorschau starten" }).click()
  await expect.poll(() => liveCameraTracks(page)).toBe(1)
  expect((await requestedCameras(page)).at(-1)).toBe("")
  await page.keyboard.press("Escape")
  await expect.poll(() => liveCameraTracks(page)).toBe(0)
})

test("saved cameras switch in an encrypted call and fall back when unplugged without an idle capture", async ({ browser }) => {
  const alice = await registerUser("camera")
  const bob = await registerUser("viewer")
  const roomName = `Camera ${Date.now().toString(36)}`
  await createRoom(alice, { name: roomName, members: [bob], encrypted: true })
  const alicePage = await newPage(browser)
  const bobPage = await newPage(browser)
  await instrumentCameras(alicePage)
  await alicePage.addInitScript((deviceId) => localStorage.setItem("nexspeak_camera_device", deviceId), CAMERA_B)
  await login(alicePage, alice)
  await login(bobPage, bob)
  await openRoom(alicePage, roomName)
  await openRoom(bobPage, roomName)
  for (const page of [alicePage, bobPage]) {
    await page.getByRole("button", { name: "Sprachkanal beitreten" }).click()
    await expect(page.getByRole("button", { name: "Anruf verlassen" })).toBeVisible()
  }
  expect(await requestedCameras(alicePage)).toEqual([])
  await alicePage.getByRole("button", { name: "Kamera einschalten" }).last().click()
  const remoteVideo = bobPage.getByTestId("call-tile").filter({ hasText: alice.username }).locator("video")
  await expect(remoteVideo).toBeVisible()
  await expect.poll(() => remoteVideo.evaluate((video: HTMLVideoElement) => video.getVideoPlaybackQuality().totalVideoFrames), { timeout: 30_000 }).toBeGreaterThan(10)
  expect((await requestedCameras(alicePage)).at(-1)).toBe(CAMERA_B)
  await expect.poll(() => liveCameraTracks(alicePage)).toBe(1)

  const settings = await openVideoSettings(alicePage)
  const camera = settings.getByRole("combobox", { name: "Kamera", exact: true })
  await settings.getByRole("button", { name: "Kameravorschau starten" }).click()
  await expect.poll(() => liveCameraTracks(alicePage)).toBe(2)
  await settings.getByRole("button", { name: "Kameravorschau stoppen" }).click()
  await expect.poll(() => liveCameraTracks(alicePage)).toBe(1)
  await camera.click()
  await alicePage.getByRole("option", { name: "Test camera A", exact: true }).click()
  await expect.poll(async () => (await requestedCameras(alicePage)).at(-1)).toBe(CAMERA_A)
  await expect.poll(() => liveCameraTracks(alicePage)).toBe(1)
  const frames = await remoteVideo.evaluate((video: HTMLVideoElement) => video.getVideoPlaybackQuality().totalVideoFrames)
  await expect.poll(() => remoteVideo.evaluate((video: HTMLVideoElement) => video.getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(frames)
  await alicePage.evaluate((deviceId) => {
    (window as unknown as CameraWindow).__cameraCapture.hidden.push(deviceId)
    navigator.mediaDevices.dispatchEvent(new Event("devicechange"))
  }, CAMERA_A)
  await expect(camera).toHaveText("Systemstandard")
  await expect.poll(async () => (await requestedCameras(alicePage)).at(-1)).toBe("default")
  await pageCloseSettings(alicePage)
  await alicePage.getByRole("button", { name: "Kamera ausschalten" }).last().click()
  await expect(remoteVideo).toHaveCount(0)
  await expect.poll(() => liveCameraTracks(alicePage)).toBe(0)
  await alicePage.getByRole("button", { name: "Anruf verlassen" }).click()
  await expect.poll(() => liveCameraTracks(alicePage)).toBe(0)
})

async function pageCloseSettings(page: Page) {
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Einstellungen", exact: true })).toHaveCount(0)
}
