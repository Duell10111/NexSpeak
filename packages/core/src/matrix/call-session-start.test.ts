import { afterEach, describe, expect, it, vi } from "vitest"
import type { MatrixClient } from "matrix-js-sdk"
import type { CallMembership } from "matrix-js-sdk/lib/matrixrtc"
import { CallSession } from "./call-session"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function membership(serviceUrl: string): CallMembership {
  return { getTransport: () => ({ type: "livekit", livekit_service_url: serviceUrl }) } as unknown as CallMembership
}

function mockJoin() {
  const discovery = Promise.withResolvers<{ rtc_transports: unknown[] }>()
  const rtcSession = { initialMembershipCalculated: Promise.resolve(), memberships: [] as CallMembership[] }
  const discover = vi.fn(() => discovery.promise)
  const getOpenIdToken = vi.fn(async () => ({ access_token: "test-token", expires_in: 3600 }))
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
  const start = () => CallSession.start(client, "!room:example.org", {
    inputDeviceId: "", outputDeviceId: "", outputVolume: 1,
  })
  const join = () => expect(start()).rejects.toThrow("Stop before connecting")
  const tokenExchanges = () => exchange.mock.calls.filter(([url]) => String(url).endsWith("/sfu/get"))
  return { discovery, rtcSession, discover, getOpenIdToken, exchange, join, start, tokenExchanges }
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

  it("exchanges the OpenID token from the parallel request", async () => {
    const { discovery, exchange, join } = mockJoin()
    discovery.resolve({ rtc_transports: [{ type: "livekit", livekit_service_url: "https://own" }] })
    await join()
    expect(JSON.parse(exchange.mock.calls[0][1].body)).toMatchObject({ openid_token: { access_token: "test-token" } })
  })

  it.each(["discovery", "openid"])("exchanges no token after a %s failure", async (failed) => {
    const mocks = mockJoin()
    vi.stubEnv("NEXT_PUBLIC_LIVEKIT_SERVICE_URL", "")
    if (failed === "openid") {
      mocks.getOpenIdToken.mockRejectedValueOnce(new Error("openid"))
      mocks.discovery.resolve({ rtc_transports: [{ type: "livekit", livekit_service_url: "https://own" }] })
    } else {
      mocks.discovery.reject(new Error("Not supported"))
    }
    await expect(mocks.start()).rejects.toThrow()
    expect(mocks.tokenExchanges()).toHaveLength(0)
  })

  it("looks up the service and OpenID token again after the token exchange failed", async () => {
    const { discovery, discover, getOpenIdToken, join } = mockJoin()
    discovery.resolve({ rtc_transports: [{ type: "livekit", livekit_service_url: "https://own" }] })
    await join()
    await join()
    expect(discover).toHaveBeenCalledTimes(2)
    expect(getOpenIdToken).toHaveBeenCalledTimes(2)
  })

  it("reuses the OpenID token when a retry follows a failed discovery", async () => {
    const { discover, getOpenIdToken, start } = mockJoin()
    vi.stubEnv("NEXT_PUBLIC_LIVEKIT_SERVICE_URL", "")
    discover.mockRejectedValue(new Error("Not supported"))
    await expect(start()).rejects.toThrow()
    await expect(start()).rejects.toThrow()
    expect(discover).toHaveBeenCalledTimes(2)
    expect(getOpenIdToken).toHaveBeenCalledOnce()
  })
})
