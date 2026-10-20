import { describe, expect, it } from "vitest"
import { callShortcutConflict, emptyCallShortcutBindings, parseCallShortcutBindings } from "@nexspeak/core/global-shortcuts"
import { shortcutFromKeyboardEvent } from "./global-shortcuts"

const keyEvent = (key: string, code: string, modifiers = {}) => ({ key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, getModifierState: () => false, ...modifiers })

describe("shortcut assignment", () => {
  it("uses printed keys on QWERTZ and records canonical modifier order", () => {
    expect(shortcutFromKeyboardEvent(keyEvent("z", "KeyY", { ctrlKey: true, shiftKey: true })))
      .toEqual({ code: "KeyY", accelerator: "Control+Shift+Z" })
    expect(shortcutFromKeyboardEvent(keyEvent("F10", "F10", { metaKey: true, altKey: true })))
      .toEqual({ code: "F10", accelerator: "Alt+Super+F10" })
  })

  it("accepts single keys and navigation keys but rejects modifiers, AltGr and unsupported characters", () => {
    expect(shortcutFromKeyboardEvent(keyEvent("m", "KeyM"))?.accelerator).toBe("M")
    expect(shortcutFromKeyboardEvent(keyEvent("ArrowDown", "ArrowDown"))?.accelerator).toBe("Down")
    expect(shortcutFromKeyboardEvent(keyEvent("Control", "ControlLeft"))).toBeNull()
    expect(shortcutFromKeyboardEvent(keyEvent("ö", "Semicolon"))).toBeNull()
    expect(shortcutFromKeyboardEvent(keyEvent("m", "KeyM", { getModifierState: () => true }))).toBeNull()
  })

  it("ignores malformed saved bindings and supports audio preferences saved before shortcuts existed", () => {
    expect(parseCallShortcutBindings(undefined)).toEqual(emptyCallShortcutBindings())
    expect(parseCallShortcutBindings({ "toggle-mute": { code: "KeyM", accelerator: "Shift+Control+M" }, "leave-call": "F10" }))
      .toEqual(emptyCallShortcutBindings())
  })

  it("detects duplicate accelerators and PTT overlap independent of keyboard layout", () => {
    const bindings = emptyCallShortcutBindings()
    bindings["toggle-mute"] = { code: "KeyY", accelerator: "Control+Z" }
    expect(callShortcutConflict(bindings, "toggle-deafen", { code: "KeyZ", accelerator: "Control+Z" }, null)).toBe(true)
    expect(callShortcutConflict(bindings, "toggle-mute", bindings["toggle-mute"], "KeyY")).toBe(true)
    expect(callShortcutConflict(bindings, "toggle-mute", bindings["toggle-mute"], "ControlRight")).toBe(true)
    expect(callShortcutConflict(bindings, "toggle-mute", bindings["toggle-mute"], "Mouse4")).toBe(false)
  })
})
