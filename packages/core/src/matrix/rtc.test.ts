import { afterEach, describe, expect, it, vi } from "vitest"
import type { MatrixClient } from "matrix-js-sdk"
import type { CallMembership } from "matrix-js-sdk/lib/matrixrtc"
import { getSfuConfig, selectActiveServiceUrl, userIdFromIdentity } from "./rtc"

describe("userIdFromIdentity", () => {
  it("splits off the device id", () => {
    expect(userIdFromIdentity("@alice:example.org:ABCDEF")).toBe("@alice:example.org")
  })

  it("handles server names with ports", () => {
    expect(userIdFromIdentity("@bob:localhost:8448:DEVICE")).toBe("@bob:localhost:8448")
  })

  it("returns opaque (hashed) identities unchanged", () => {
    expect(userIdFromIdentity("q0rTUWXAp1T0yHsK3pnnNfoUJ0Zss9x9b9eC1WpSDlQ")).toBe(
      "q0rTUWXAp1T0yHsK3pnnNfoUJ0Zss9x9b9eC1WpSDlQ",
    )
  })
})

describe("selectActiveServiceUrl", () => {
  const membershipWith = (transport: unknown) =>
    ({ getTransport: () => transport }) as unknown as CallMembership

  it("uses our own service when nobody is in the call", () => {
    expect(selectActiveServiceUrl([], "https://own")).toBe("https://own")
  })

  it("joins the SFU of the oldest member", () => {
    const oldest = membershipWith({ type: "livekit", livekit_service_url: "https://theirs" })
    expect(selectActiveServiceUrl([oldest], "https://own")).toBe("https://theirs")
  })

  it("falls back to our own service for non-LiveKit transports", () => {
    const oldest = membershipWith({ type: "something-else" })
    expect(selectActiveServiceUrl([oldest], "https://own")).toBe("https://own")
  })
})

describe("getSfuConfig", () => {
  afterEach(() => vi.unstubAllGlobals())

  const client = {
    getOpenIdToken: async () => ({ access_token: "oid", token_type: "Bearer", matrix_server_name: "example.org", expires_in: 3600 }),
    getDeviceId: () => "DEVICE",
  } as unknown as MatrixClient

  it("exchanges the OpenID token at /sfu/get", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ url: "wss://sfu", jwt: "token" })))
    vi.stubGlobal("fetch", fetchMock)

    await expect(getSfuConfig(client, "https://jwt.example.org/", "!room:example.org")).resolves.toEqual({
      url: "wss://sfu",
      jwt: "token",
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://jwt.example.org/sfu/get")
    expect(JSON.parse(init.body as string)).toMatchObject({ room: "!room:example.org", device_id: "DEVICE" })
  })

  it("reports a rejected token exchange", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })))
    await expect(getSfuConfig(client, "https://jwt", "!r:x")).rejects.toThrow(/401/)
  })
})
