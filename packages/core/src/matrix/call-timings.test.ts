import { afterEach, describe, expect, it, vi } from "vitest"
import { CallTimings } from "./call-timings"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("call join timings", () => {
  it("does not log or read the clock unless explicitly enabled", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null })
    const log = vi.spyOn(console, "info").mockImplementation(() => {})
    const clock = vi.spyOn(performance, "now")
    await expect(new CallTimings().measure("discovery", async () => "https://jwt")).resolves.toBe("https://jwt")
    expect(log).not.toHaveBeenCalled()
    expect(clock).not.toHaveBeenCalled()
  })

  it("works when storage is unavailable", async () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("Storage blocked") } })
    await expect(new CallTimings().measure("connection", async () => 42)).resolves.toBe(42)
  })

  it("logs duration and elapsed time without operation results or errors", async () => {
    vi.stubGlobal("localStorage", { getItem: () => "1" })
    const log = vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(performance, "now").mockReturnValueOnce(100).mockReturnValueOnce(120).mockReturnValueOnce(150)
      .mockReturnValueOnce(160).mockReturnValueOnce(200)
    const timings = new CallTimings()
    await timings.measure("openid", async () => ({ access_token: "secret" }))
    await expect(timings.measure("connection", async () => { throw new Error("private details") })).rejects.toThrow("private details")
    expect(log.mock.calls).toEqual([
      ["[call timing]", { phase: "openid", status: "ready", durationMs: 30, elapsedMs: 50 }],
      ["[call timing]", { phase: "connection", status: "failed", durationMs: 40, elapsedMs: 100 }],
    ])
  })
})
