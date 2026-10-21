import { afterEach, describe, expect, it, vi } from "vitest"
import type { MatrixClient } from "matrix-js-sdk"
import type { CallMembership } from "matrix-js-sdk/lib/matrixrtc"
import { discoverLivekitServiceUrl, forgetLivekitServiceUrl, getSfuConfig, selectActiveServiceUrl, userIdFromIdentity } from "./rtc"

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

  it.each([
    undefined, "", "/relative", "not a url", "wss://sfu", "javascript:alert(1)", "https://user:secret@jwt",
    "http://attacker.example", "http://192.168.1.10:8070",
  ])(
    "requires discovery for an invalid advertised service: %s", (url) => {
      const oldest = membershipWith({ type: "livekit", livekit_service_url: url })
      const newer = membershipWith({ type: "livekit", livekit_service_url: "https://newer" })
      expect(selectActiveServiceUrl([oldest, newer])).toBeUndefined()
    },
  )

  it.each(["http://localhost:8070", "http://127.0.0.1:8070", "http://[::1]:8070", "http://jwt.localhost"])(
    "accepts plain HTTP from other members only on this machine: %s", (url) => {
      expect(selectActiveServiceUrl([membershipWith({ type: "livekit", livekit_service_url: url })])).toBe(url)
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
    const discover = vi.fn().mockResolvedValue({ rtc_transports: [{ type: "livekit", livekit_service_url: "https://jwt" }] })
    const client = {
      http: { authedRequest: discover },
      getDomain: () => "example.org",
      getHomeserverUrl: () => "https://matrix.example.org",
    } as unknown as MatrixClient
    return { client, discover }
  }

  it("shares in-flight discovery and successful results only within the same client", async () => {
    const { client, discover } = mockClient()
    const other = mockClient()
    const result = Promise.withResolvers<{ rtc_transports: unknown[] }>()
    discover.mockReturnValueOnce(result.promise)
    const first = discoverLivekitServiceUrl(client)
    const second = discoverLivekitServiceUrl(client)
    expect(discover).toHaveBeenCalledOnce()
    result.resolve({ rtc_transports: [{ type: "livekit", livekit_service_url: "https://jwt" }] })
    expect(await Promise.all([first, second])).toEqual(["https://jwt", "https://jwt"])
    await discoverLivekitServiceUrl(client)
    expect(discover).toHaveBeenCalledOnce()
    expect(discover).toHaveBeenCalledWith("GET", "/rtc/transports", undefined, undefined, {
      prefix: "/_matrix/client/unstable/org.matrix.msc4143", abortSignal: expect.any(AbortSignal),
    })
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
    discover.mockResolvedValueOnce({ rtc_transports: [{ type: "livekit", livekit_service_url: "https://new-jwt" }] })
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

  it("forgets a cached service after it failed, but keeps a different one", async () => {
    const { client, discover } = mockClient()
    await discoverLivekitServiceUrl(client)
    forgetLivekitServiceUrl(client, "https://other")
    forgetLivekitServiceUrl(client, undefined)
    await discoverLivekitServiceUrl(client)
    expect(discover).toHaveBeenCalledOnce()
    forgetLivekitServiceUrl(client, "https://jwt")
    await discoverLivekitServiceUrl(client)
    expect(discover).toHaveBeenCalledTimes(2)
  })

  it("keeps a pending lookup when a service is forgotten", async () => {
    const { client, discover } = mockClient()
    const pending = Promise.withResolvers<{ rtc_transports: unknown[] }>()
    discover.mockReturnValueOnce(pending.promise)
    const first = discoverLivekitServiceUrl(client)
    forgetLivekitServiceUrl(client, "https://jwt")
    const second = discoverLivekitServiceUrl(client)
    pending.resolve({ rtc_transports: [{ type: "livekit", livekit_service_url: "https://jwt" }] })
    expect(await Promise.all([first, second])).toEqual(["https://jwt", "https://jwt"])
    expect(discover).toHaveBeenCalledOnce()
  })

  it("accepts plain HTTP from the own homeserver", async () => {
    const { client, discover } = mockClient()
    discover.mockResolvedValueOnce({ rtc_transports: [{ type: "livekit", livekit_service_url: "http://192.168.1.10:8070" }] })
    await expect(discoverLivekitServiceUrl(client)).resolves.toBe("http://192.168.1.10:8070")
  })

  it.each([
    ["https://jwt.example.org", undefined, "https://jwt.example.org/"],
    ["/livekit-jwt", "https://chat.example.org/rooms/", "https://chat.example.org/livekit-jwt"],
  ])("uses the build-time fallback %s as an absolute URL", async (value, page, expected) => {
    const { client, discover } = mockClient()
    discover.mockRejectedValueOnce(new Error("Not supported"))
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unavailable")))
    if (page) vi.stubGlobal("location", new URL(page))
    vi.stubEnv("NEXT_PUBLIC_LIVEKIT_SERVICE_URL", value)
    await expect(discoverLivekitServiceUrl(client)).resolves.toBe(expected)
  })

  it("validates discovery results and caches the well-known fallback", async () => {
    const { client, discover } = mockClient()
    discover.mockResolvedValueOnce({ rtc_transports: [{ type: "livekit", livekit_service_url: "" }] })
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      "org.matrix.msc4143.rtc_foci": [{ type: "livekit", livekit_service_url: "https://fallback" }],
    })))
    vi.stubGlobal("fetch", fetchMock)
    await expect(discoverLivekitServiceUrl(client)).resolves.toBe("https://fallback")
    await expect(discoverLivekitServiceUrl(client)).resolves.toBe("https://fallback")
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("https://example.org/.well-known/matrix/client", { signal: expect.any(AbortSignal) })
  })

  it.each(["resolve", "reject"])("bounds a hung transport request and ignores its late %s after a successful retry", async (completion) => {
    vi.useFakeTimers()
    const { client, discover } = mockClient()
    const pending = Promise.withResolvers<{ rtc_transports: unknown[] }>()
    discover.mockReturnValueOnce(pending.promise)
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const first = discoverLivekitServiceUrl(client)
    const failed = expect(first).rejects.toThrow()
    const signal = discover.mock.calls[0][4].abortSignal as AbortSignal
    await vi.advanceTimersByTimeAsync(9_999)
    expect(signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await failed
    expect(signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)

    await expect(discoverLivekitServiceUrl(client)).resolves.toBe("https://jwt")
    if (completion === "resolve") pending.resolve({ rtc_transports: [{ type: "livekit", livekit_service_url: "https://stale" }] })
    else pending.reject(new Error("Late network failure"))
    await pending.promise.catch(() => {})
    await expect(discoverLivekitServiceUrl(client)).resolves.toBe("https://jwt")
    expect(discover).toHaveBeenCalledTimes(2)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("aborts a hung well-known lookup after an OpenID failure and permits a fresh retry", async () => {
    vi.useFakeTimers()
    const { client, discover } = mockClient()
    discover.mockResolvedValue({ rtc_transports: [] })
    const pending = Promise.withResolvers<Response>()
    const fetchMock = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(new Response(JSON.stringify({
      "org.matrix.msc4143.rtc_foci": [{ type: "livekit", livekit_service_url: "https://recovered" }],
    })))
    vi.stubGlobal("fetch", fetchMock)
    const first = discoverLivekitServiceUrl(client)
    const joiningClient = { ...client, getOpenIdToken: async () => { throw new Error("OpenID unavailable") } } as unknown as MatrixClient
    await expect(getSfuConfig(joiningClient, first, "!r:x")).rejects.toThrow("OpenID unavailable")
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    const failed = expect(first).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(10_000)
    await failed
    expect(signal.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
    await expect(discoverLivekitServiceUrl(client)).resolves.toBe("https://recovered")
    pending.resolve(new Response(JSON.stringify({})))
    await pending.promise
    await expect(discoverLivekitServiceUrl(client)).resolves.toBe("https://recovered")
    expect(discover).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("applies one deadline to the entire lookup, including well-known response bodies", async () => {
    vi.useFakeTimers()
    const { client, discover } = mockClient()
    const transports = Promise.withResolvers<{ rtc_transports: unknown[] }>()
    const body = Promise.withResolvers<object>()
    discover.mockReturnValueOnce(transports.promise)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => body.promise })
    vi.stubGlobal("fetch", fetchMock)
    const first = discoverLivekitServiceUrl(client)
    const failed = expect(first).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(9_000)
    transports.resolve({ rtc_transports: [] })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledOnce()
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    await vi.advanceTimersByTimeAsync(1_000)
    await failed
    expect(signal.aborted).toBe(true)
    body.resolve({})
    await body.promise
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("expires a pending entry on demand when the timeout callback was delayed", async () => {
    vi.useFakeTimers()
    const { client, discover } = mockClient()
    discover.mockReturnValueOnce(new Promise(() => {}))
    const first = discoverLivekitServiceUrl(client)
    const failed = expect(first).rejects.toThrow()
    const signal = discover.mock.calls[0][4].abortSignal as AbortSignal
    vi.setSystemTime(Date.now() + 10_001)
    const retry = discoverLivekitServiceUrl(client)
    expect(signal.aborted).toBe(true)
    await failed
    await expect(retry).resolves.toBe("https://jwt")
    await expect(discoverLivekitServiceUrl(client)).resolves.toBe("https://jwt")
    expect(discover).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
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
