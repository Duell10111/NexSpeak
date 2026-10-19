import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WebContents } from "electron"
import { uIOhook, UiohookKey } from "uiohook-napi"
import { setupPushToTalk, stopPushToTalk } from "./push-to-talk"

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (event: { sender: unknown }, key?: unknown) => unknown>(),
}))

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn((name, handler) => handlers.set(name, handler)) },
  systemPreferences: { isTrustedAccessibilityClient: () => true },
}))

vi.mock("uiohook-napi", async (importOriginal) => {
  const original = await importOriginal<typeof import("uiohook-napi")>()
  const { EventEmitter } = await import("node:events")
  return {
    ...original,
    uIOhook: Object.assign(new EventEmitter(), { start: vi.fn(), stop: vi.fn() }),
  }
})

describe("global push-to-talk hook lifecycle", () => {
  const send = vi.fn()
  const window = { send } as unknown as WebContents
  const bind = (key: unknown) => handlers.get("nexspeak:ptt-set-key")!({ sender: window }, key)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("XDG_SESSION_TYPE", "x11")
    handlers.clear()
    setupPushToTalk(() => window)
  })

  afterEach(() => {
    stopPushToTalk()
    vi.unstubAllEnvs()
  })

  it("stays stopped while idle and starts with the chosen native keyboard filter", () => {
    expect(uIOhook.start).not.toHaveBeenCalled()
    bind("KeyT")
    expect(uIOhook.start).toHaveBeenCalledExactlyOnceWith(UiohookKey.T, 0)
    bind("KeyT")
    expect(uIOhook.start).toHaveBeenCalledTimes(1)
    expect(uIOhook.stop).not.toHaveBeenCalled()
  })

  it("joins the old hook and releases the microphone gate before changing the binding", () => {
    bind("KeyT")
    uIOhook.emit("keydown", { keycode: UiohookKey.T })
    uIOhook.emit("keydown", { keycode: UiohookKey.T })
    expect(send).toHaveBeenCalledExactlyOnceWith("nexspeak:ptt-pressed", true)

    bind("Mouse4")
    expect(uIOhook.stop).toHaveBeenCalledOnce()
    expect(send).toHaveBeenLastCalledWith("nexspeak:ptt-pressed", false)
    expect(uIOhook.start).toHaveBeenLastCalledWith(0, 4)
    expect(vi.mocked(uIOhook.stop).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(uIOhook.start).mock.invocationCallOrder[1])

    send.mockClear()
    uIOhook.emit("keyup", { keycode: UiohookKey.T })
    uIOhook.emit("mousedown", { button: 5 })
    expect(send).not.toHaveBeenCalled()
    uIOhook.emit("mousedown", { button: 4 })
    uIOhook.emit("mouseup", { button: 4 })
    expect(send.mock.calls).toEqual([["nexspeak:ptt-pressed", true], ["nexspeak:ptt-pressed", false]])

    bind("KeyV")
    expect(uIOhook.start).toHaveBeenLastCalledWith(UiohookKey.V, 0)
  })

  it("stops and releases on leaving a call or selecting an unsupported binding", () => {
    bind("Mouse3")
    uIOhook.emit("mousedown", { button: 3 })
    bind(null)
    expect(uIOhook.stop).toHaveBeenCalledOnce()
    expect(send).toHaveBeenLastCalledWith("nexspeak:ptt-pressed", false)
    bind("KeyT")
    bind("Fn")
    expect(uIOhook.stop).toHaveBeenCalledTimes(2)
    expect(uIOhook.start).toHaveBeenCalledTimes(2)
  })

  it("ignores binding changes from another renderer", () => {
    handlers.get("nexspeak:ptt-set-key")!({ sender: {} }, "KeyT")
    expect(uIOhook.start).not.toHaveBeenCalled()
  })
})
