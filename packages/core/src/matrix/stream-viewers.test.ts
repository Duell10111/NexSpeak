import { describe, expect, it } from "vitest"
import { encodeWatching, parseWatching } from "./stream-viewers"

describe("watching attribute", () => {
  it("round-trips identities, sorted and without duplicates", () => {
    const value = encodeWatching(["@b:example.org:DEV2", "@a:example.org:DEV1", "@b:example.org:DEV2"])
    expect(value).toBe('["@a:example.org:DEV1","@b:example.org:DEV2"]')
    expect(parseWatching(value)).toEqual(["@a:example.org:DEV1", "@b:example.org:DEV2"])
  })

  it("is empty when watching nothing, which deletes the attribute", () => {
    expect(encodeWatching([])).toBe("")
    expect(parseWatching("")).toEqual([])
    expect(parseWatching(undefined)).toEqual([])
  })

  it("ignores malformed values", () => {
    expect(parseWatching("not json")).toEqual([])
    expect(parseWatching('{"a":1}')).toEqual([])
    expect(parseWatching('["@a:x:D", 3, null]')).toEqual(["@a:x:D"])
  })
})
