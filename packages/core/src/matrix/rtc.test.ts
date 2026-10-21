import { afterEach, describe, expect, it, vi } from "vitest"
import type { MatrixClient } from "matrix-js-sdk"
import type { CallMembership } from "matrix-js-sdk/lib/matrixrtc"
import { discoverLivekitServiceUrl, getSfuConfig, selectActiveServiceUrl, userIdFromIdentity } from "./rtc"

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

  it.each([undefined, "", "/relative", "not a url", "wss://sfu", "javascript:alert(1)", "https://user:secret@jwt"])(
    "requires discovery for an invalid advertised service: %s", (url) => {
      const oldest = membershipWith({ type: "livekit", livekit_service_url: url })
      const newer = membershipWith({ type: "livekit", livekit_service_url: "https://newer" })
      expect(selectActiveServiceUrl([oldest, newer])).toBeUndefined()
    },
  )

  it("does not require a local service for an existing call", () => {
    expect(selectActiveServiceUrl([membershipWith({ type: "livekit", livekit_service_url: "http://localhost:8070" })]))
      .toBe("http://localhost:8070")
    expect(selectActiveServiceUrl([])).toBeUndefined()
  })
})

describe("LiveKit service discovery cache", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  function mockClient() {
    const discover = vi.fn().mockResolvedValue([{ type: "livekit", livekit_service_url: "https://jwt" }])
    const client = {
      _unstable_getRTCTransports: discover,
      getDomain: () => "example.org",
      getHomeserverUrl: () => "https://matrix.example.org",
    } as unknown as MatrixClient
    return { client, discover }
  }

  it("shares in-flight discovery and successful results only within the same client", async () => {
    const { client, discover } = mockClient()
    const other = mockClient()
    const result = Promise.withResolvers<unknown[]>()
    discover.mockReturnValueOnce(result.promise)
    const first = discoverLivekitServiceUrl(client)
    const second = discoverLivekitServiceUrl(client)
    expect(discover).toHaveBeenCalledOnce()
    result.resolve([{ type: "livekit", livekit_service_url: "https://jwt" }])
    expect(await Promise.all([first, second])).toEqual(["https://jwt", "https://jwt"])
    await discoverLivekitServiceUrl(client)
    expect(discover).toHaveBeenCalledOnce()
    await discoverLivekitServiceUrl(other.client)
    expect(other.discover).toHaveBeenCalledOnce()
  })

  it("expires five minutes after success, without idle timers or refresh requests", async () => {
    vi.useFakeTimers()
    const { client, discover } = mockClient()
    await discoverLivekitServiceUrl(client)
    vi.advanceTimersByTime(5 * 60_000 - 1)
    await discoverLivekitServiceUrl(client)
    expect(discover).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(1)
    expect(discover).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    discover.mockResolvedValueOnce([{ type: "livekit", livekit_service_url: "https://new-jwt" }])
    await expect(discoverLivekitServiceUrl(client)).resolves.toBe("https://new-jwt")
    expect(discover).toHaveBeenCalledTimes(2)
  })

  it("retries after failure instead of caching a rejected promise", async () => {
    const { client, discover } = mockClient()
    discover.mockRejectedValueOnce(new Error("Not supported"))
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unavailable")))
    vi.stubEnv("NEXT_PUBLIC_LIVEKIT_SERVICE_URL", "")
    await expect(discoverLivekitServiceUrl(client)).rejects.toThrow()
    await expect(discoverLivekitServiceUrl(client)).resolves.toBe("https://jwt")
    expect(discover).toHaveBeenCalledTimes(2)
  })

  it("validates discovery results and caches the well-known fallback", async () => {
    const { client, discover } = mockClient()
    discover.mockResolvedValueOnce([{ type: "livekit", livekit_service_url: "" }])
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      "org.matrix.msc4143.rtc_foci": [{ type: "livekit", livekit_service_url: "https://fallback" }],
    })))
    vi.stubGlobal("fetch", fetchMock)
    await expect(discoverLivekitServiceUrl(client)).resolves.toBe("https://fallback")
    await expect(discoverLivekitServiceUrl(client)).resolves.toBe("https://fallback")
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("https://example.org/.well-known/matrix/client")
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

  it("acquires OpenID while discovery is pending, then exchanges only once both are ready", async () => {
    const discovery = Promise.withResolvers<string>()
    const openId = Promise.withResolvers<Awaited<ReturnType<MatrixClient["getOpenIdToken"]>>>()
    const getOpenIdToken = vi.fn(() => openId.promise)
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: "wss://sfu", jwt: "token" })))
    vi.stubGlobal("fetch", fetchMock)
    const result = getSfuConfig({ ...client, getOpenIdToken } as unknown as MatrixClient, discovery.promise, "!r:x")
    expect(getOpenIdToken).toHaveBeenCalledOnce()
    discovery.resolve("https://jwt")
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
    openId.resolve(await client.getOpenIdToken())
    await expect(result).resolves.toEqual({ url: "wss://sfu", jwt: "token" })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toMatchObject({ openid_token: await client.getOpenIdToken() })
  })

  it.each(["discovery", "openid"])("handles %s failure without exchanging a token", async (failed) => {
    const discovery = Promise.withResolvers<string>()
    const openId = Promise.withResolvers<Awaited<ReturnType<MatrixClient["getOpenIdToken"]>>>()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const result = getSfuConfig({ ...client, getOpenIdToken: () => openId.promise } as MatrixClient, discovery.promise, "!r:x")
    const assertion = expect(result).rejects.toThrow(failed)
    if (failed === "discovery") {
      discovery.reject(new Error("discovery"))
      await assertion
      openId.reject(new Error("late OpenID failure"))
    } else {
      openId.reject(new Error("openid"))
      await assertion
      discovery.reject(new Error("late discovery failure"))
    }
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
