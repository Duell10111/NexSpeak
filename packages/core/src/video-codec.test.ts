import { afterEach, describe, expect, it, vi } from "vitest"
import {
  evenScale,
  hasSoftwareOnlyVideoEncoder,
  isEncoderOverloaded,
  swapH264Profiles,
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

describe("swapH264Profiles", () => {
  const offer = [
    "v=0",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    "a=fmtp:111 minptime=10;useinbandfec=1",
    "m=video 9 UDP/TLS/RTP/SAVPF 108 109 112 113 114",
    "a=rtpmap:108 H264/90000",
    "a=fmtp:108 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
    "a=rtpmap:109 H264/90000",
    "a=fmtp:109 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f",
    "a=rtpmap:112 H264/90000",
    "a=fmtp:112 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=4d0032",
    "a=rtpmap:113 rtx/90000",
    "a=fmtp:113 apt=112",
    "a=rtpmap:114 H265/90000",
    "a=fmtp:114 profile-level-id=42e01f;packetization-mode=1",
    "",
  ].join("\r\n")

  it("exchanges profiles while keeping payloads, levels, RTX and other codecs intact", () => {
    const swapped = swapH264Profiles(offer)
    expect(swapped).toBe(offer
      .replace("packetization-mode=1;profile-level-id=42e01f", "packetization-mode=1;profile-level-id=4d001f")
      .replace("packetization-mode=1;profile-level-id=4d0032", "packetization-mode=1;profile-level-id=42e032"))
    expect(swapH264Profiles(swapped)).toBe(offer)
  })

  it("translates answers with only one negotiated profile", () => {
    const answer = "m=video 9 UDP/TLS/RTP/SAVPF 112\r\na=rtpmap:112 H264/90000\r\na=fmtp:112 profile-level-id=42e01f;packetization-mode=1\r\n"
    expect(swapH264Profiles(answer)).toBe(answer.replace("42e01f", "4d001f"))
    expect(swapH264Profiles(swapH264Profiles(answer))).toBe(answer)
  })

  it("applies the same translation to published and placeholder video sections", () => {
    const placeholder = offer.replace("m=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fmtp:111 minptime=10;useinbandfec=1\r\n", "")
    const bundle = offer + placeholder
    expect(swapH264Profiles(bundle)).toBe(swapH264Profiles(offer) + swapH264Profiles(placeholder))
    expect(swapH264Profiles(swapH264Profiles(bundle))).toBe(bundle)
  })
})

describe("installH264MainProfilePreference", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("keeps the native Main payload stable through offer-with-join and renegotiation", async () => {
    vi.resetModules()
    const { installH264MainProfilePreference } = await import("./video-codec")
    const native = [
      "v=0",
      "m=video 9 UDP/TLS/RTP/SAVPF 116 108",
      "a=rtpmap:116 H264/90000",
      "a=fmtp:116 packetization-mode=1;profile-level-id=4d001f",
      "a=rtpmap:108 H264/90000",
      "a=fmtp:108 packetization-mode=1;profile-level-id=42e01f",
      "",
    ].join("\r\n")
    const answer = native.replace(/a=(?:rtpmap|fmtp):108[^\r]*\r\n/g, "").replace("116 108", "116")
    const main = { mimeType: "video/H264", clockRate: 90000, sdpFmtpLine: "packetization-mode=1;profile-level-id=4d001f" }
    const baseline = { ...main, sdpFmtpLine: "packetization-mode=1;profile-level-id=42e01f" }
    class Connection {
      local?: RTCSessionDescriptionInit
      options?: RTCOfferOptions
      remote?: RTCSessionDescriptionInit
      video = { receiver: { track: { kind: "video" } }, setCodecPreferences: vi.fn() }
      get localDescription() { return this.local }
      get remoteDescription() { return this.remote }
      getTransceivers() { return [this.video] }
      async createOffer(options?: RTCOfferOptions) { this.options = options; return { type: "offer" as const, sdp: native } }
      async setLocalDescription(description?: RTCSessionDescriptionInit) { this.local = description }
      async setRemoteDescription(description: RTCSessionDescriptionInit) { this.remote = description }
    }
    class TrackedConnection extends Connection {}
    vi.stubGlobal("RTCSessionDescription", class {
      constructor(description: RTCSessionDescriptionInit) { Object.assign(this, description) }
    })
    vi.stubGlobal("navigator", { userAgent: "Chrome/145.0" })
    vi.stubGlobal("RTCPeerConnection", TrackedConnection)
    vi.stubGlobal("RTCRtpReceiver", { getCapabilities: () => ({ codecs: [baseline, main] }) })
    installH264MainProfilePreference()
    installH264MainProfilePreference()
    const pc = new TrackedConnection()
    // LiveKit sends the first offer before applying it locally. The wire SDP must
    // already map its Baseline codec to the browser's native Main payload (116).
    const initial = await pc.createOffer()
    expect(initial.sdp).toContain("a=fmtp:116 packetization-mode=1;profile-level-id=42e01f")
    expect(pc.video.setCodecPreferences).toHaveBeenCalledWith([main, baseline])
    for (const offer of [initial, await pc.createOffer({ iceRestart: true })]) {
      await pc.setLocalDescription(offer)
      await pc.setRemoteDescription({ type: "answer", sdp: swapH264Profiles(answer) })
      expect(pc.local?.sdp).toBe(native)
      expect(pc.remote?.sdp).toBe(answer)
      expect(offer.sdp).toBe(initial.sdp)
      // Reconnect sync must see the SFU mapping; reapplying the saved remote
      // answer during ICE restart must still give the browser its native Main.
      expect(pc.localDescription?.sdp).toBe(initial.sdp)
      expect(pc.remoteDescription?.sdp).toBe(swapH264Profiles(answer))
      await pc.setRemoteDescription(pc.remoteDescription!)
      expect(pc.remote?.sdp).toBe(answer)
    }
    expect(pc.options).toEqual({ iceRestart: true })
    // An unrelated legacy subscriber receives a server offer: no translation.
    const subscriber = new TrackedConnection()
    const remoteOffer = { type: "offer" as const, sdp: native }
    await subscriber.setRemoteDescription(remoteOffer)
    expect(subscriber.remote).toBe(remoteOffer)
  })

  it.each(["Firefox/145.0", "Version/19.0 Safari/605.1"])("leaves %s untouched", async (userAgent) => {
    vi.resetModules()
    const { installH264MainProfilePreference } = await import("./video-codec")
    class Connection { createOffer() {} }
    const original = Connection.prototype.createOffer
    vi.stubGlobal("navigator", { userAgent })
    vi.stubGlobal("RTCPeerConnection", Connection)
    installH264MainProfilePreference()
    expect(Connection.prototype.createOffer).toBe(original)
  })

  it("keeps the browser defaults when Main is unavailable", async () => {
    vi.resetModules()
    const { installH264MainProfilePreference } = await import("./video-codec")
    class Connection { createOffer() {} }
    const original = Connection.prototype.createOffer
    vi.stubGlobal("navigator", { userAgent: "Chrome/145.0" })
    vi.stubGlobal("RTCPeerConnection", Connection)
    vi.stubGlobal("RTCRtpReceiver", { getCapabilities: () => ({ codecs: [{ mimeType: "video/VP8", clockRate: 90000 }] }) })
    installH264MainProfilePreference()
    expect(Connection.prototype.createOffer).toBe(original)
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
