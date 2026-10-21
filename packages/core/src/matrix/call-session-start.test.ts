import { afterEach, describe, expect, it, vi } from "vitest"
import type { MatrixClient } from "matrix-js-sdk"
import type { CallMembership } from "matrix-js-sdk/lib/matrixrtc"
import { CallSession } from "./call-session"

afterEach(() => vi.unstubAllGlobals())

function membership(serviceUrl: string): CallMembership {
  return { getTransport: () => ({ type: "livekit", livekit_service_url: serviceUrl }) } as unknown as CallMembership
}

function mockJoin() {
  const discovery = Promise.withResolvers<{ rtc_transports: unknown[] }>()
  const rtcSession = { initialMembershipCalculated: Promise.resolve(), memberships: [] as CallMembership[] }
  const discover = vi.fn(() => discovery.promise)
  const getOpenIdToken = vi.fn().mockResolvedValue({ access_token: "test-token" })
  // Inspect the real startup path without creating media resources or opening a connection.
  const exchange = vi.fn().mockRejectedValue(new Error("Stop before connecting"))
  vi.stubGlobal("fetch", exchange)
  const client = {
    getRoom: () => ({ currentState: { maySendStateEvent: () => true } }),
    getUserId: () => "@alice:example.org",
    getDeviceId: () => "ALICE",
    matrixRTC: { getRoomSession: () => rtcSession },
    http: { authedRequest: discover },
    getOpenIdToken,
  } as unknown as MatrixClient
  const join = () => expect(CallSession.start(client, "!room:example.org", {
    inputDeviceId: "", outputDeviceId: "", outputVolume: 1,
  })).rejects.toThrow("Stop before connecting")
  return { discovery, rtcSession, discover, getOpenIdToken, exchange, join }
}

describe("call startup service selection", () => {
  it("uses the oldest membership immediately without local discovery", async () => {
    const { rtcSession, discover, exchange, join } = mockJoin()
    rtcSession.memberships = [membership("https://oldest"), membership("https://newer")]
    await join()
    expect(discover).not.toHaveBeenCalled()
    expect(exchange.mock.calls[0][0]).toBe("https://oldest/sfu/get")
  })

  it("rechecks memberships after discovery while acquiring OpenID in parallel", async () => {
    const { discovery, rtcSession, discover, getOpenIdToken, exchange, join } = mockJoin()
    const joining = join()
    await vi.waitFor(() => expect(discover).toHaveBeenCalledOnce())
    expect(getOpenIdToken).toHaveBeenCalledOnce()
    expect(exchange).not.toHaveBeenCalled()
    rtcSession.memberships = [membership("https://oldest"), membership("https://newer")]
    discovery.resolve({ rtc_transports: [{ type: "livekit", livekit_service_url: "https://own" }] })
    await joining
    expect(exchange.mock.calls[0][0]).toBe("https://oldest/sfu/get")
  })

  it("uses local discovery when nobody starts a call in the meantime", async () => {
    const { discovery, exchange, join } = mockJoin()
    discovery.resolve({ rtc_transports: [{ type: "livekit", livekit_service_url: "https://own" }] })
    await join()
    expect(exchange.mock.calls[0][0]).toBe("https://own/sfu/get")
  })
})
