import { describe, expect, it } from "vitest"
import { parseMatrixLink } from "./links"

describe("parseMatrixLink", () => {
  it("reads matrix.to links", () => {
    expect(parseMatrixLink("https://matrix.to/#/%23nexspeak:matrix.org")).toEqual({
      kind: "room",
      roomIdOrAlias: "#nexspeak:matrix.org",
      via: [],
    })
    expect(parseMatrixLink("https://matrix.to/#/!abc:example.org/$event?via=example.org&via=matrix.org")).toEqual({
      kind: "room",
      roomIdOrAlias: "!abc:example.org",
      via: ["example.org", "matrix.org"],
      eventId: "$event",
    })
    expect(parseMatrixLink("https://matrix.to/#/@alice:example.org")).toEqual({ kind: "user", userId: "@alice:example.org" })
    // Room version 12: room ids without a server part.
    expect(parseMatrixLink("https://matrix.to/#/!KDz3eI3rXLo-a9rvV3Inl-h0NtzbAo2XvH4N2DlGBi0?via=localhost")).toEqual({
      kind: "room",
      roomIdOrAlias: "!KDz3eI3rXLo-a9rvV3Inl-h0NtzbAo2XvH4N2DlGBi0",
      via: ["localhost"],
    })
  })

  it("reads matrix: URIs", () => {
    expect(parseMatrixLink("matrix:r/nexspeak:matrix.org")).toEqual({ kind: "room", roomIdOrAlias: "#nexspeak:matrix.org", via: [] })
    expect(parseMatrixLink("matrix:roomid/abc:example.org/e/ev1?via=example.org")).toEqual({
      kind: "room",
      roomIdOrAlias: "!abc:example.org",
      via: ["example.org"],
      eventId: "$ev1",
    })
    expect(parseMatrixLink("matrix:u/alice:example.org")).toEqual({ kind: "user", userId: "@alice:example.org" })
  })

  it("reads nexspeak:// deep links", () => {
    expect(parseMatrixLink("nexspeak://room/%21abc%3Aexample.org?via=example.org")).toEqual({
      kind: "room",
      roomIdOrAlias: "!abc:example.org",
      via: ["example.org"],
    })
    expect(parseMatrixLink("nexspeak://room/%23space:example.org")).toMatchObject({ roomIdOrAlias: "#space:example.org" })
    expect(parseMatrixLink("nexspeak://user/%40alice%3Aexample.org")).toEqual({ kind: "user", userId: "@alice:example.org" })
    expect(parseMatrixLink("nexspeak://sso?loginToken=abc123")).toEqual({ kind: "sso", loginToken: "abc123" })
  })

  it("rejects everything else", () => {
    for (const href of [
      "https://example.org/#/!abc:example.org",
      "https://matrix.to/#/not-an-id",
      "nexspeak://room/%40alice%3Aexample.org",
      "nexspeak://user/!room:example.org",
      "nexspeak://sso",
      "nexspeak://unknown/x",
      "javascript:alert(1)",
      "not a url",
      `nexspeak://room/${"a".repeat(5000)}`,
    ]) {
      expect(parseMatrixLink(href), href).toBeNull()
    }
  })
})
