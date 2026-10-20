import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { type ValidatedAuthMetadata } from "matrix-js-sdk"
import { clientMetadataFor, completeOidcLogin, readOidcCallback, startOidcLogin } from "./oidc"
import { createMatrixClient, disposeMatrixClient } from "./client"

describe("readOidcCallback", () => {
  it("reads the code and state of the issuer's redirect", () => {
    expect(readOidcCallback("?code=abc&state=xyz")).toEqual({ code: "abc", state: "xyz" })
  })

  it("reports errors, e.g. a cancelled login", () => {
    expect(readOidcCallback("?error=access_denied&state=xyz")).toEqual({ error: "access_denied" })
    expect(readOidcCallback("?error=access_denied&error_description=Nope&state=xyz")).toEqual({ error: "Nope" })
  })

  it("ignores other URLs, like the SSO return", () => {
    expect(readOidcCallback("?loginToken=abc")).toBeNull()
    expect(readOidcCallback("")).toBeNull()
  })
})

describe("OAuth authorization and token refresh", () => {
  const origin = "https://app.example.org"
  const homeserverUrl = "https://matrix.example.org"
  const metadata: ValidatedAuthMetadata = {
    issuer: "https://auth.example.org/",
    authorization_endpoint: "https://auth.example.org/authorize",
    token_endpoint: "https://auth.example.org/token",
    registration_endpoint: "https://auth.example.org/register",
    revocation_endpoint: "https://auth.example.org/revoke",
    grant_types_supported: ["authorization_code", "refresh_token"],
    response_types_supported: ["code"],
    response_modes_supported: ["query", "fragment"],
    code_challenge_methods_supported: ["S256"],
  }
  let deviceId: string
  let tokenRequest: URLSearchParams | undefined
  let issuer: string
  let expireAccessToken: boolean
  let revocations: URLSearchParams[]
  const persist = vi.fn()
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { "Content-Type": "application/json" },
    })
    if (url.endsWith("/auth_metadata")) return json({ ...metadata, issuer })
    if (url.endsWith("/register")) return json({ client_id: "client" })
    if (url.endsWith("/revoke")) {
      revocations.push(new URLSearchParams(init?.body as string))
      return json({})
    }
    if (url.endsWith("/token")) {
      tokenRequest = new URLSearchParams(init?.body as string)
      return json({ access_token: "fresh", refresh_token: "refresh-new", token_type: "Bearer" })
    }
    if (url.includes("/account/whoami")) {
      if (expireAccessToken && new Headers(init?.headers).get("Authorization") === "Bearer expired") {
        return json({ errcode: "M_UNKNOWN_TOKEN", error: "Expired", soft_logout: true }, 401)
      }
      return json({ user_id: "@alice:example.org", device_id: deviceId })
    }
    throw new Error(`Unexpected request: ${url}`)
  })

  beforeEach(() => {
    const storage = () => {
      const values = new Map<string, string>()
      return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value) },
        removeItem: (key: string) => { values.delete(key) },
      }
    }
    vi.stubGlobal("window", {})
    vi.stubGlobal("localStorage", storage())
    vi.stubGlobal("sessionStorage", storage())
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockClear()
    persist.mockClear()
    tokenRequest = undefined
    issuer = metadata.issuer
    expireAccessToken = false
    revocations = []
    deviceId = "DEVICE"
  })

  afterEach(() => {
    disposeMatrixClient()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function begin() {
    const url = new URL(await startOidcLogin({ homeserverUrl, config: metadata, origin }))
    const scope = url.searchParams.get("scope")!
    deviceId = scope.split(" ").find((part) => part.startsWith("urn:matrix:client:device:"))!.split(":").at(-1)!
    return url
  }

  it("exchanges a callback with the original PKCE verifier and consumes it once", async () => {
    const url = await begin()
    const state = url.searchParams.get("state")!
    expect(url.searchParams.get("response_mode")).toBe("query")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    await expect(completeOidcLogin("code", state, origin)).resolves.toMatchObject({
      homeserverUrl, deviceId, userId: "@alice:example.org", accessToken: "fresh",
      oidc: { clientId: "client", issuer: metadata.issuer, refreshToken: "refresh-new" },
    })
    const verifier = tokenRequest!.get("code_verifier")!
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
    expect(Buffer.from(digest).toString("base64url")).toBe(url.searchParams.get("code_challenge"))
    expect(tokenRequest!.get("redirect_uri")).toBe(`${origin}/login`)
    fetchMock.mockClear()
    await expect(completeOidcLogin("code", state, origin)).rejects.toThrow(/missing/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects a callback from another login or origin before making a request", async () => {
    const url = await begin()
    fetchMock.mockClear()
    await expect(completeOidcLogin("code", "different-state", origin)).rejects.toThrow(/does not match/)
    await expect(completeOidcLogin("code", url.searchParams.get("state")!, "https://other.example.org")).rejects.toThrow(/does not match/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects an expired callback before sending the code", async () => {
    const url = await begin()
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 16 * 60_000)
    fetchMock.mockClear()
    await expect(completeOidcLogin("code", url.searchParams.get("state")!, origin)).rejects.toThrow(/expired/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects an issuer change without disclosing the authorization code", async () => {
    const url = await begin()
    issuer = "https://other.example.org/"
    await expect(completeOidcLogin("code", url.searchParams.get("state")!, origin)).rejects.toThrow(/issuer changed/)
    expect(tokenRequest).toBeUndefined()
  })

  it("rejects a token for an unexpected Matrix device", async () => {
    const url = await begin()
    deviceId = "OTHER"
    await expect(completeOidcLogin("code", url.searchParams.get("state")!, origin)).rejects.toThrow(/unexpected OAuth device/)
  })

  it("refreshes an existing session, persists rotated tokens and revokes them at logout", async () => {
    expireAccessToken = true
    const client = createMatrixClient({
      homeserverUrl, userId: "@alice:example.org", deviceId,
      accessToken: "expired", refreshToken: "refresh-old", oauthClientId: "existing-client",
      onTokenRefresh: persist,
    })
    await expect(client.whoami()).resolves.toMatchObject({ user_id: "@alice:example.org", device_id: deviceId })
    expect(tokenRequest!.get("grant_type")).toBe("refresh_token")
    expect(tokenRequest!.get("client_id")).toBe("existing-client")
    expect(tokenRequest!.get("refresh_token")).toBe("refresh-old")
    expect(persist).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ accessToken: "fresh", refreshToken: "refresh-new" }))
    expect(client.getAccessToken()).toBe("fresh")
    await client.logout(true)
    expect(revocations.map((body) => [body.get("token"), body.get("token_type_hint"), body.get("client_id")])).toEqual(
      expect.arrayContaining([
        ["fresh", "access_token", "existing-client"],
        ["refresh-new", "refresh_token", "existing-client"],
      ]),
    )
    expect(revocations).toHaveLength(2)
  })
})

describe("clientMetadataFor", () => {
  it("registers a hosted instance as a web client of its own origin", () => {
    expect(clientMetadataFor("https://nexspeak.example.org", "https://nexspeak.example.org/login")).toMatchObject({
      application_type: "web",
      client_uri: "https://nexspeak.example.org",
      logo_uri: "https://nexspeak.example.org/icon-192.png",
    })
  })

  it("registers localhost as a native client with a loopback redirect (MAS rejects http web clients)", () => {
    expect(clientMetadataFor("http://localhost:3000", "http://localhost:3000/login")).toMatchObject({
      application_type: "native",
      client_uri: "https://github.com/Duell10111/NexSpeak",
      logo_uri: undefined,
      redirect_uris: ["http://localhost:3000/login"],
    })
  })
})
