import { describe, expect, it } from "vitest"
import { keyboardKeyLabel, keyFromMouseEvent, mouseButtonNumber } from "./push-to-talk"

describe("push-to-talk keys", () => {
  it("only uses middle and side mouse buttons", () => {
    expect(keyFromMouseEvent({ button: 0 })).toBeNull()
    expect(keyFromMouseEvent({ button: 2 })).toBeNull()
    expect(keyFromMouseEvent({ button: 1 })).toBe("Mouse3")
    expect(keyFromMouseEvent({ button: 3 })).toBe("Mouse4")
    expect(keyFromMouseEvent({ button: 4 })).toBe("Mouse5")
    expect(mouseButtonNumber("Mouse4")).toBe(4)
    expect(mouseButtonNumber("KeyM")).toBeNull()
  })

  it("labels keys by layout, falling back to the code", () => {
    expect(keyboardKeyLabel("KeyY", new Map([["KeyY", "z"]]))).toBe("Z")
    expect(keyboardKeyLabel("KeyV")).toBe("V")
    expect(keyboardKeyLabel("Digit4")).toBe("4")
    expect(keyboardKeyLabel("ControlLeft")).toBe("Control Left")
    expect(keyboardKeyLabel("Numpad0")).toBe("Num 0")
    expect(keyboardKeyLabel("Backquote")).toBe("Backquote")
  })
})
