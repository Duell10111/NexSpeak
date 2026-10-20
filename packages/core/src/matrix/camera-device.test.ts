import { describe, expect, it, vi } from "vitest"
import { CallSession } from "./call-session"

function mockSession() {
  const switchDevice = vi.fn().mockResolvedValue(true)
  const setCameraEnabled = vi.fn().mockResolvedValue(undefined)
  // Exercise the real session methods without starting a Matrix/LiveKit connection.
  const session: CallSession = Object.create(CallSession.prototype)
  Object.assign(session, {
    cameraQueue: Promise.resolve(),
    isLeaving: false,
    waitForOwnKey: vi.fn().mockResolvedValue(undefined),
    changed: vi.fn(),
    livekitRoom: {
      getActiveDevice: () => "old-camera",
      switchActiveDevice: switchDevice,
      localParticipant: { setCameraEnabled, getTrackPublication: () => ({ videoTrack: { stop: vi.fn() } }) },
    },
  })
  return { session, switchDevice, setCameraEnabled }
}

describe("call camera switching", () => {
  it("serializes camera selections and toggles, including default fallback", async () => {
    const { session, switchDevice, setCameraEnabled } = mockSession()
    let finish!: () => void
    switchDevice.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    const first = session.setDevice("videoinput", "camera-a")
    const second = session.setDevice("videoinput", "camera-b")
    const fallback = session.setDevice("videoinput", "")
    const off = session.setCameraEnabled(false)
    await Promise.resolve()
    expect(switchDevice).toHaveBeenCalledTimes(1)
    expect(setCameraEnabled).not.toHaveBeenCalled()
    finish()
    await Promise.all([first, second, fallback, off])
    expect(switchDevice.mock.calls).toEqual([
      ["videoinput", "camera-a", false],
      ["videoinput", "camera-b", false],
      ["videoinput", "default", false],
    ])
    expect(setCameraEnabled).toHaveBeenCalledWith(false)
  })

  it("allows a newer selection after a failed switch", async () => {
    const { session, switchDevice } = mockSession()
    switchDevice.mockRejectedValueOnce(new Error("Camera busy"))
    const failed = session.setDevice("videoinput", "camera-a")
    const next = session.setDevice("videoinput", "camera-b")
    await expect(failed).rejects.toThrow("Camera busy")
    await next
    expect(switchDevice).toHaveBeenLastCalledWith("videoinput", "camera-b", false)
  })

  it("stops a camera publication that arrives after disconnect", async () => {
    const { session, setCameraEnabled } = mockSession()
    const stop = vi.fn()
    let finish!: () => void
    setCameraEnabled.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ track: { stop } }) }))
    const enabling = session.setCameraEnabled(true)
    await Promise.resolve()
    await Promise.resolve()
    Object.assign(session, { isLeaving: true })
    finish()
    await enabling
    expect(stop).toHaveBeenCalledOnce()
  })

  it("stops a restarted capture if the device switch finishes after disconnect", async () => {
    const { session, switchDevice } = mockSession()
    const stop = vi.fn()
    const room = (session as unknown as { livekitRoom: { localParticipant: { getTrackPublication: () => unknown } } }).livekitRoom
    room.localParticipant.getTrackPublication = () => ({ videoTrack: { stop } })
    let finish!: () => void
    switchDevice.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    const changing = session.setDevice("videoinput", "camera-b")
    await Promise.resolve()
    Object.assign(session, { isLeaving: true })
    finish()
    await changing
    expect(stop).toHaveBeenCalledOnce()
  })

  it("does not reopen the camera for queued changes after leaving", async () => {
    const { session, switchDevice, setCameraEnabled } = mockSession()
    const selection = session.setDevice("videoinput", "camera-a")
    const enable = session.setCameraEnabled(true)
    Object.assign(session, { isLeaving: true })
    await Promise.all([selection, enable])
    expect(switchDevice).not.toHaveBeenCalled()
    expect(setCameraEnabled).not.toHaveBeenCalled()
  })
})
