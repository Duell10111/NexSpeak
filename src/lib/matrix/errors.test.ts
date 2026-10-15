import { describe, expect, it } from "vitest"
import { MatrixError } from "matrix-js-sdk"
import { describeMatrixError, resolveHomeserverUrl, serverNameFromUserId } from "./errors"

describe("serverNameFromUserId", () => {
  it("extracts the server name", () => {
    expect(serverNameFromUserId("@alice:matrix.org")).toBe("matrix.org")
    expect(serverNameFromUserId(" @bob:localhost:8008 ")).toBe("localhost:8008")
  })

  it("returns null for plain usernames", () => {
    expect(serverNameFromUserId("alice")).toBeNull()
  })
})

describe("describeMatrixError", () => {
  it("translates well-known error codes", () => {
    expect(describeMatrixError(new MatrixError({ errcode: "M_FORBIDDEN", error: "Invalid password" }, 403))).toBe(
      "Benutzername oder Passwort ist falsch.",
    )
  })

  it("falls back to the server message", () => {
    expect(describeMatrixError(new MatrixError({ errcode: "M_UNKNOWN", error: "Kaputt" }, 500))).toBe("Kaputt")
  })
})

describe("resolveHomeserverUrl", () => {
  it("rejects empty input", async () => {
    await expect(resolveHomeserverUrl("  ")).rejects.toThrow(/Homeserver/)
  })
})
