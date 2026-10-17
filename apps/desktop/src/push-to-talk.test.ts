import { describe, expect, it } from "vitest"
import { UiohookKey } from "uiohook-napi"
import { bindingFor } from "./push-to-talk"

describe("push-to-talk key mapping", () => {
  it("maps the web app's key names to the global hook", () => {
    expect(bindingFor("KeyV")).toEqual({ kind: "key", keycode: UiohookKey.V })
    expect(bindingFor("Digit4")).toEqual({ kind: "key", keycode: UiohookKey[4] })
    expect(bindingFor("Backquote")).toEqual({ kind: "key", keycode: UiohookKey.Backquote })
    expect(bindingFor("F13")).toEqual({ kind: "key", keycode: UiohookKey.F13 })
    expect(bindingFor("ControlLeft")).toEqual({ kind: "key", keycode: UiohookKey.Ctrl })
    expect(bindingFor("AltRight")).toEqual({ kind: "key", keycode: UiohookKey.AltRight })
    expect(bindingFor("Numpad5")).toEqual({ kind: "key", keycode: UiohookKey.Numpad5 })
    expect(bindingFor("Mouse4")).toEqual({ kind: "mouse", button: 4 })
  })

  it("rejects keys the hook does not know", () => {
    expect(bindingFor("Mouse1")).toBeNull()
    expect(bindingFor("KeyVV")).toBeNull()
    expect(bindingFor("Fn")).toBeNull()
  })
})
