import { describe, expect, it } from "vitest"
import { hasSoftwareOnlyVideoEncoder, isEncoderOverloaded } from "./video-codec"

describe("isEncoderOverloaded", () => {
  it("flags encode times close to the frame budget", () => {
    // 15.8 ms per frame at 60 fps (16.7 ms budget), as measured with Firefox.
    expect(isEncoderOverloaded(15.8, 60)).toBe(true)
    expect(isEncoderOverloaded(4, 60)).toBe(false)
    expect(isEncoderOverloaded(15.8, 30)).toBe(false)
    expect(isEncoderOverloaded(null, 60)).toBe(false)
  })
})

describe("hasSoftwareOnlyVideoEncoder", () => {
  it("is true for Firefox only", () => {
    expect(hasSoftwareOnlyVideoEncoder("Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0")).toBe(true)
    expect(hasSoftwareOnlyVideoEncoder("Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36")).toBe(false)
  })
})
