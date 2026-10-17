import { describe, expect, it } from "vitest"
import { clientMetadataFor, readOidcCallback } from "./oidc"

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

describe("clientMetadataFor", () => {
  it("registers a hosted instance as a web client of its own origin", () => {
    expect(clientMetadataFor("https://nexspeak.example.org", "https://nexspeak.example.org/login")).toMatchObject({
      applicationType: "web",
      clientUri: "https://nexspeak.example.org",
      logoUri: "https://nexspeak.example.org/icon-192.png",
    })
  })

  it("registers localhost as a native client with a loopback redirect (MAS rejects http web clients)", () => {
    expect(clientMetadataFor("http://localhost:3000", "http://localhost:3000/login")).toMatchObject({
      applicationType: "native",
      clientUri: "https://github.com/Duell10111/NexSpeak",
      logoUri: undefined,
      redirectUris: ["http://localhost:3000/login"],
    })
  })
})
