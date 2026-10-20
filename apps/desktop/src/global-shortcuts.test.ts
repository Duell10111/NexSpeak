import { beforeEach, describe, expect, it, vi } from "vitest"
import type { WebContents } from "electron"
import { globalShortcut } from "electron"
import { setupGlobalShortcuts } from "./global-shortcuts"

const { handlers, callbacks } = vi.hoisted(() => ({
  handlers: new Map<string, (event: { sender: unknown }, ...args: unknown[]) => unknown>(),
  callbacks: new Map<string, () => void>(),
}))
vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((name, handler) => handlers.set(name, handler)),
    on: vi.fn((name, handler) => handlers.set(name, handler)),
  },
  globalShortcut: {
    register: vi.fn(),
    unregister: vi.fn(),
  },
}))

describe("global call shortcut lifecycle", () => {
  const send = vi.fn()
  const contents = { send, isDestroyed: () => false } as unknown as WebContents
  let shortcuts: ReturnType<typeof setupGlobalShortcuts>
  const invoke = (name: string, ...args: unknown[]) => handlers.get(`nexspeak:${name}`)!({ sender: contents }, ...args)
  const configure = (bindings: unknown, pttKey: unknown = null) => invoke("call-shortcuts-set", bindings, pttKey)
  const mute = { code: "KeyM", accelerator: "Control+Shift+M" }
  const deafen = { code: "KeyD", accelerator: "Control+Shift+D" }

  beforeEach(() => {
    vi.clearAllMocks()
    handlers.clear()
    callbacks.clear()
    vi.mocked(globalShortcut.register).mockImplementation((accelerator, callback) => {
      callbacks.set(accelerator, callback)
      return true
    })
    shortcuts = setupGlobalShortcuts(() => contents)
  })

  it("registers nothing while idle, registers only assigned keys during a call and releases them afterwards", () => {
    configure({ "toggle-mute": mute, "toggle-deafen": deafen })
    expect(globalShortcut.register).not.toHaveBeenCalled()
    shortcuts.setInCall(true)
    expect(globalShortcut.register).toHaveBeenCalledTimes(2)
    expect(globalShortcut.register).toHaveBeenCalledWith(mute.accelerator, expect.any(Function))
    callbacks.get(mute.accelerator)!()
    expect(send).toHaveBeenLastCalledWith("nexspeak:call-shortcut", "toggle-mute")
    shortcuts.setInCall(true)
    expect(globalShortcut.register).toHaveBeenCalledTimes(2)
    configure({ "toggle-mute": mute, "toggle-deafen": deafen })
    expect(globalShortcut.register).toHaveBeenCalledTimes(2)
    expect(globalShortcut.unregister).not.toHaveBeenCalled()
    shortcuts.setInCall(false)
    expect(globalShortcut.unregister).toHaveBeenCalledTimes(2)
    send.mockClear()
    callbacks.get(mute.accelerator)!()
    expect(send).not.toHaveBeenCalled()
    shortcuts.setInCall(true)
    expect(globalShortcut.register).toHaveBeenCalledTimes(4)
  })

  it("stays unregistered during calls without bindings", () => {
    shortcuts.setInCall(true)
    configure(null)
    configure({ unknown: mute, "toggle-mute": { code: "KeyM", accelerator: "Ctrl+M" } })
    expect(globalShortcut.register).not.toHaveBeenCalled()
  })

  it("releases keys while recording and restores them without executing a call action", () => {
    configure({ "leave-call": mute })
    shortcuts.setInCall(true)
    invoke("call-shortcuts-suspended", true)
    expect(globalShortcut.unregister).toHaveBeenCalledExactlyOnceWith(mute.accelerator)
    send.mockClear()
    callbacks.get(mute.accelerator)!()
    expect(send).not.toHaveBeenCalled()
    configure({ "leave-call": deafen })
    expect(globalShortcut.register).toHaveBeenCalledTimes(1)
    invoke("call-shortcuts-suspended", false)
    expect(globalShortcut.register).toHaveBeenLastCalledWith(deafen.accelerator, expect.any(Function))
    callbacks.get(deafen.accelerator)!()
    expect(send).toHaveBeenLastCalledWith("nexspeak:call-shortcut", "leave-call")
  })

  it("can swap or clear bindings during a call", () => {
    configure({ "toggle-mute": mute, "toggle-deafen": deafen })
    shortcuts.setInCall(true)
    configure({ "toggle-mute": deafen, "toggle-deafen": mute })
    expect(globalShortcut.unregister).toHaveBeenCalledTimes(2)
    expect(vi.mocked(globalShortcut.unregister).mock.invocationCallOrder[1]).toBeLessThan(vi.mocked(globalShortcut.register).mock.invocationCallOrder[2])
    callbacks.get(deafen.accelerator)!()
    expect(send).toHaveBeenLastCalledWith("nexspeak:call-shortcut", "toggle-mute")
    const oldCallback = callbacks.get(deafen.accelerator)!
    configure({})
    expect(globalShortcut.unregister).toHaveBeenCalledTimes(4)
    send.mockClear()
    oldCallback()
    expect(send).not.toHaveBeenCalled()
  })

  it("rejects duplicate accelerators and PTT key or modifier overlap", () => {
    shortcuts.setInCall(true)
    configure({ "toggle-mute": mute, "toggle-deafen": mute })
    expect(globalShortcut.register).not.toHaveBeenCalled()
    expect(invoke("call-shortcut-status-get")).toMatchObject({ "toggle-mute": "conflict", "toggle-deafen": "conflict" })
    for (const pttKey of ["KeyM", "ControlLeft", "ControlRight", "ShiftLeft"]) {
      configure({ "toggle-mute": mute }, pttKey)
      expect(globalShortcut.register).not.toHaveBeenCalled()
    }
    configure({ "toggle-mute": mute }, "Mouse4")
    expect(globalShortcut.register).toHaveBeenCalledOnce()
  })

  it("reports reserved and unsupported combinations without crashing", () => {
    vi.mocked(globalShortcut.register).mockReturnValueOnce(false).mockImplementationOnce(() => { throw new Error("unsupported") })
    configure({ "toggle-mute": mute, "toggle-deafen": deafen })
    shortcuts.setInCall(true)
    expect(invoke("call-shortcut-status-get")).toMatchObject({ "toggle-mute": "unavailable", "toggle-deafen": "unavailable" })
    shortcuts.setInCall(false)
    expect(globalShortcut.unregister).not.toHaveBeenCalled()
  })

  it("ignores configuration, suspension and status requests from another renderer", () => {
    handlers.get("nexspeak:call-shortcuts-set")!({ sender: {} }, { "toggle-mute": mute })
    handlers.get("nexspeak:call-shortcuts-suspended")!({ sender: {} }, true)
    expect(handlers.get("nexspeak:call-shortcut-status-get")!({ sender: {} })).toBeNull()
    shortcuts.setInCall(true)
    expect(globalShortcut.register).not.toHaveBeenCalled()
    configure({ "toggle-mute": mute })
    expect(globalShortcut.register).toHaveBeenCalledOnce()
  })

  it("resets registrations and configuration on reload, renderer crash and quit", () => {
    configure({ "stop-screen-share": mute })
    shortcuts.setInCall(true)
    shortcuts.reset()
    expect(globalShortcut.unregister).toHaveBeenCalledExactlyOnceWith(mute.accelerator)
    expect(invoke("call-shortcut-status-get")).toMatchObject({ "stop-screen-share": "inactive" })
    shortcuts.setInCall(true)
    expect(globalShortcut.register).toHaveBeenCalledTimes(1)
  })
})
