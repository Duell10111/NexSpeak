import { describe, expect, it } from "vitest"
import {
  evenScale,
  hasSoftwareOnlyVideoEncoder,
  isEncoderOverloaded,
  preferH264MainProfile,
  swapH264ProfilesInOffer,
} from "./video-codec"

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

describe("preferH264MainProfile", () => {
  it("turns (constrained) baseline into main and keeps the level", () => {
    const sdp = "a=fmtp:108 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f\r\na=fmtp:98 profile-id=0\r\n"
    expect(preferH264MainProfile(sdp)).toBe(
      "a=fmtp:108 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=4d001f\r\na=fmtp:98 profile-id=0\r\n",
    )
    expect(preferH264MainProfile("profile-level-id=42001f")).toBe("profile-level-id=4d001f")
  })
})

describe("swapH264ProfilesInOffer", () => {
  const offer = [
    "v=0",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    "a=fmtp:111 minptime=10;useinbandfec=1",
    "m=video 9 UDP/TLS/RTP/SAVPF 96 108 109 112",
    "a=fmtp:108 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
    "a=fmtp:109 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f",
    "a=fmtp:112 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=4d001f",
    "",
  ].join("\r\n")

  it("swaps baseline and main of packetization mode 1 in video sections", () => {
    const swapped = swapH264ProfilesInOffer(offer)
    expect(swapped).toContain("a=fmtp:108 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=4d001f")
    expect(swapped).toContain("a=fmtp:112 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f")
    expect(swapped).toContain("a=fmtp:109 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f")
    expect(swapped).toContain("a=fmtp:111 minptime=10;useinbandfec=1")
  })

  it("leaves offers without both profiles alone", () => {
    const withoutMain = offer.replace(/a=fmtp:112[^\r]*\r\n/, "")
    expect(swapH264ProfilesInOffer(withoutMain)).toBe(withoutMain)
  })
})

describe("evenScale", () => {
  // Chrome rounds scaled sizes (measured: scale 2 turns 1117 into 559).
  const output = (width: number, height: number, scale: number) => [Math.round(width / scale), Math.round(height / scale)]

  it("keeps even sizes untouched", () => {
    expect(evenScale(1920, 1080)).toBe(1)
    expect(evenScale(1920, 1080, 2)).toBe(2)
  })

  it("avoids sizes that only truncation would make even", () => {
    // 1117 / 2 = 558.5 is rounded to 559 by Chrome.
    expect(evenScale(1728, 1117, 2)).not.toBe(2)
  })

  it("scales odd sizes down to the next even size", () => {
    for (const [width, height] of [[1728, 1117], [1727, 1116], [2559, 1439], [3455, 2233], [1001, 777]]) {
      const [w, h] = output(width, height, evenScale(width, height))
      expect(w % 2).toBe(0)
      expect(h % 2).toBe(0)
      expect(height - h).toBeLessThanOrEqual(4)
    }
    expect(output(1728, 1117, evenScale(1728, 1117))).toEqual([1726, 1116])
    const [w, h] = output(1728, 1117, evenScale(1728, 1117, 2))
    expect([w % 2, h % 2]).toEqual([0, 0])
  })
})
