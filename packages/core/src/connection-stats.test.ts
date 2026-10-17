import { describe, expect, it } from "vitest"
import { createConnectionSampler, readConnectionTotals } from "./connection-stats"

function report(stats: Array<Record<string, unknown>>): RTCStatsReport {
  return new Map(stats.map((stat) => [stat.id as string, stat])) as unknown as RTCStatsReport
}

const chromePublisher = (sent: number, lost: number, rtt = 0.023) =>
  report([
    { id: "T1", type: "transport", selectedCandidatePairId: "CP1" },
    { id: "CP1", type: "candidate-pair", localCandidateId: "L1", remoteCandidateId: "R1", currentRoundTripTime: rtt },
    { id: "CP2", type: "candidate-pair", localCandidateId: "L2", remoteCandidateId: "R2", currentRoundTripTime: 0.5 },
    { id: "L1", type: "local-candidate", candidateType: "host", protocol: "udp" },
    { id: "R1", type: "remote-candidate", address: "203.0.113.7", port: 7882, protocol: "udp" },
    { id: "OUT", type: "outbound-rtp", packetsSent: sent },
    { id: "RIN", type: "remote-inbound-rtp", packetsLost: lost, roundTripTime: 0.1 },
  ])

const subscriber = (received: number, lost: number) =>
  report([{ id: "IN", type: "inbound-rtp", packetsReceived: received, packetsLost: lost }])

describe("readConnectionTotals", () => {
  it("reads ping and transport from the selected candidate pair", () => {
    const totals = readConnectionTotals([chromePublisher(100, 0), subscriber(50, 0)])
    expect(totals.pingMs).toBeCloseTo(23)
    expect(totals).toMatchObject({ protocol: "udp", relayed: false, server: "203.0.113.7:7882", packetsReceived: 50 })
  })

  it("detects TURN relays and falls back to the RTCP round trip (Firefox)", () => {
    const totals = readConnectionTotals([
      report([
        { id: "CP", type: "candidate-pair", selected: true, localCandidateId: "L", remoteCandidateId: "R" },
        { id: "L", type: "local-candidate", candidateType: "relay", relayProtocol: "tcp" },
        { id: "R", type: "remote-candidate", address: "198.51.100.1", protocol: "udp" },
        { id: "RIN", type: "remote-inbound-rtp", packetsLost: 0, roundTripTime: 0.042 },
      ]),
    ])
    expect(totals).toMatchObject({ protocol: "tcp", relayed: true, server: "198.51.100.1" })
    expect(totals.pingMs).toBeCloseTo(42)
  })
})

describe("createConnectionSampler", () => {
  it("averages pings and measures packet loss between samples", async () => {
    const samples = [
      [chromePublisher(1000, 10, 0.02), subscriber(1000, 0)],
      [chromePublisher(2000, 60, 0.04), subscriber(1900, 100)],
    ]
    const sample = createConnectionSampler(async () => samples.shift() ?? [])
    const first = await sample()
    expect(first).toMatchObject({ outboundLoss: null, inboundLoss: null })
    const second = await sample()
    expect(second?.pingMs).toBeCloseTo(40)
    expect(second?.averagePingMs).toBeCloseTo(30)
    expect(second?.outboundLoss).toBeCloseTo(0.05)
    expect(second?.inboundLoss).toBeCloseTo(0.1)
    expect(await sample()).toBeNull()
  })
})
