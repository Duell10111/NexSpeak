import { describe, expect, it } from "vitest"
import { originOf } from "./origin"

describe("originOf", () => {
  it("works for the app:// scheme, unlike URL.origin", () => {
    expect(new URL("app://nexspeak/login").origin).toBe("null")
    expect(originOf("app://nexspeak/login")).toBe("app://nexspeak")
    expect(originOf("app://nexspeak")).toBe("app://nexspeak")
  })

  it("keeps ports and rejects what is no origin", () => {
    expect(originOf("http://localhost:3000/login")).toBe("http://localhost:3000")
    expect(originOf("https://evil.example/app://nexspeak")).toBe("https://evil.example")
    expect(originOf("file:///etc/passwd")).toBeNull()
    expect(originOf("not a url")).toBeNull()
  })
})
