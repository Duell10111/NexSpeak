import { describe, expect, it } from "vitest"
import { callShortcutConflict, emptyCallShortcutBindings, parseCallShortcutBindings } from "@nexspeak/core/global-shortcuts"
import { shortcutFromKeyboardEvent, shortcutLabel } from "./global-shortcuts"

const keyEvent = (key: string, code: string, modifiers = {}) => ({ key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, getModifierState: () => false, ...modifiers })

describe("shortcut assignment", () => {
  it("follows the printed letter on Windows and Linux, the key position on macOS, and records canonical modifier order", () => {
    expect(shortcutFromKeyboardEvent(keyEvent("Z", "KeyY", { ctrlKey: true, shiftKey: true }), "win32"))
      .toEqual({ code: "KeyY", accelerator: "Control+Shift+Z" })
    expect(shortcutFromKeyboardEvent(keyEvent("z", "KeyY", { metaKey: true }), "darwin"))
      .toEqual({ code: "KeyY", accelerator: "Super+Y" })
    expect(shortcutFromKeyboardEvent(keyEvent("F10", "F10", { metaKey: true, altKey: true }), "linux"))
      .toEqual({ code: "F10", accelerator: "Alt+Super+F10" })
  })

  it("uses the physical key when Shift, Option or the layout change the printed character", () => {
    expect(shortcutFromKeyboardEvent(keyEvent("µ", "KeyM", { altKey: true }), "darwin")?.accelerator).toBe("Alt+M")
    expect(shortcutFromKeyboardEvent(keyEvent("ь", "KeyM", { ctrlKey: true }), "win32")?.accelerator).toBe("Control+M")
    expect(shortcutFromKeyboardEvent(keyEvent("!", "Digit1", { ctrlKey: true, shiftKey: true }), "win32")?.accelerator).toBe("Control+Shift+1")
    expect(shortcutFromKeyboardEvent(keyEvent("1", "Numpad1", { ctrlKey: true }), "win32")?.accelerator).toBe("Control+num1")
    expect(shortcutFromKeyboardEvent(keyEvent("ArrowDown", "ArrowDown", { altKey: true }), "linux")?.accelerator).toBe("Alt+Down")
  })

  it("requires Ctrl, Alt or Super except for function keys and rejects modifiers, AltGr and punctuation", () => {
    expect(shortcutFromKeyboardEvent(keyEvent("m", "KeyM"), "win32")).toBeNull()
    expect(shortcutFromKeyboardEvent(keyEvent("M", "KeyM", { shiftKey: true }), "win32")).toBeNull()
    expect(shortcutFromKeyboardEvent(keyEvent(" ", "Space"), "win32")).toBeNull()
    expect(shortcutFromKeyboardEvent(keyEvent("F13", "F13"), "win32")?.accelerator).toBe("F13")
    expect(shortcutFromKeyboardEvent(keyEvent("F5", "F5", { shiftKey: true }), "win32")?.accelerator).toBe("Shift+F5")
    expect(shortcutFromKeyboardEvent(keyEvent("Control", "ControlLeft", { ctrlKey: true }), "win32")).toBeNull()
    expect(shortcutFromKeyboardEvent(keyEvent("/", "Slash", { ctrlKey: true }), "win32")).toBeNull()
    expect(shortcutFromKeyboardEvent(keyEvent("ö", "Semicolon", { ctrlKey: true }), "win32")).toBeNull()
    expect(shortcutFromKeyboardEvent(keyEvent("m", "KeyM", { ctrlKey: true, getModifierState: () => true }), "win32")).toBeNull()
  })

  it("labels letters as printed on the layout", () => {
    const layout = new Map([["KeyY", "z"]])
    expect(shortcutLabel({ code: "KeyY", accelerator: "Super+Y" }, "darwin", layout)).toBe("Cmd + Z")
    expect(shortcutLabel({ code: "KeyY", accelerator: "Control+Y" }, "win32")).toBe("Ctrl + Y")
    expect(shortcutLabel({ code: "Numpad1", accelerator: "Control+num1" }, "win32")).toBe("Ctrl + Num 1")
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
