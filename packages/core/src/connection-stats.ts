/**
 * Connection details of a call (ping, packet loss, transport), like Discord's
 * "Voice Connected" popover. Everything comes from the WebRTC stats of the
 * connections to the SFU and is only sampled while someone looks at it.
 */

/** Pings kept for the average and the graph (one per sample). */
export const PING_HISTORY_LENGTH = 60
/** Packet loss is measured over this many samples, so single RTCP reports don't make it jump. */
const LOSS_WINDOW = 10

export interface ConnectionTotals {
  /** Round trip to the SFU of the active ICE candidate pair, null when unknown. */
  pingMs: number | null
  /** Cumulative counters since the connection started. */
  packetsSent: number
  packetsLostOutbound: number
  packetsReceived: number
  packetsLostInbound: number
  /** "udp" or "tcp" between us and the SFU (or the TURN server). */
  protocol: string
  /** Media goes through a TURN relay. */
  relayed: boolean
  /** Address of the SFU (or TURN server) we are connected to. */
  server: string
}

export interface ConnectionInfo {
  pingMs: number | null
  averagePingMs: number | null
  /** Recent pings, oldest first. */
  pingHistory: number[]
  /** Share of our packets the SFU did not receive (0..1), recent samples only. */
  outboundLoss: number | null
  /** Share of packets from the SFU we did not receive (0..1), recent samples only. */
  inboundLoss: number | null
  protocol: string
  relayed: boolean
  server: string
}

type CandidatePairStats = RTCIceCandidatePairStats & { selected?: boolean }
type CandidateStats = RTCStats & {
  address?: string
  port?: number
  protocol?: string
  candidateType?: string
  relayProtocol?: string
}

function activeCandidatePair(report: RTCStatsReport): CandidatePairStats | undefined {
  let pair: CandidatePairStats | undefined
  report.forEach((stat: RTCStats) => {
    const id = (stat as RTCTransportStats).selectedCandidatePairId
    if (!pair && stat.type === "transport" && id) pair = report.get(id) as CandidatePairStats | undefined
  })
  // Firefox has no transport stats but flags the pair itself.
  report.forEach((stat: RTCStats) => {
    const candidate = stat as CandidatePairStats
    if (!pair && stat.type === "candidate-pair" && (candidate.selected || (candidate.nominated && candidate.state === "succeeded"))) {
      pair = candidate
    }
  })
  return pair
}

/** Sums up the stats of all connections to the SFU (publisher and subscriber). */
export function readConnectionTotals(reports: RTCStatsReport[]): ConnectionTotals {
  const totals: ConnectionTotals = {
    pingMs: null,
    packetsSent: 0,
    packetsLostOutbound: 0,
    packetsReceived: 0,
    packetsLostInbound: 0,
    protocol: "",
    relayed: false,
    server: "",
  }
  let rtcpRoundTrip: number | undefined
  for (const report of reports) {
    report.forEach((stat: RTCStats) => {
      if (stat.type === "outbound-rtp") {
        totals.packetsSent += (stat as RTCOutboundRtpStreamStats).packetsSent ?? 0
      } else if (stat.type === "remote-inbound-rtp") {
        const remote = stat as RTCStats & { packetsLost?: number; roundTripTime?: number }
        totals.packetsLostOutbound += Math.max(0, remote.packetsLost ?? 0)
        rtcpRoundTrip ??= remote.roundTripTime
      } else if (stat.type === "inbound-rtp") {
        const inbound = stat as RTCInboundRtpStreamStats
        totals.packetsReceived += inbound.packetsReceived ?? 0
        totals.packetsLostInbound += Math.max(0, inbound.packetsLost ?? 0)
      }
    })
    const pair = activeCandidatePair(report)
    if (!pair || totals.server) continue
    const local = report.get(pair.localCandidateId) as CandidateStats | undefined
    const remote = report.get(pair.remoteCandidateId) as CandidateStats | undefined
    if (pair.currentRoundTripTime !== undefined) totals.pingMs = pair.currentRoundTripTime * 1000
    totals.relayed = local?.candidateType === "relay"
    totals.protocol = (totals.relayed ? local?.relayProtocol : remote?.protocol) ?? remote?.protocol ?? ""
    if (remote?.address) totals.server = remote.port ? `${remote.address}:${remote.port}` : remote.address
  }
  // Without a round trip on the ICE pair (Firefox), fall back to the one from RTCP.
  if (totals.pingMs === null && rtcpRoundTrip !== undefined) totals.pingMs = rtcpRoundTrip * 1000
  return totals
}

function lossBetween(lost: number, delivered: number): number | null {
  const total = lost + delivered
  return total > 0 ? Math.min(1, Math.max(0, lost / total)) : null
}

/** Derives the shown details from the recent totals (oldest first). */
export function summarizeConnection(history: ConnectionTotals[]): ConnectionInfo | null {
  const latest = history.at(-1)
  if (!latest) return null
  const base = history[Math.max(0, history.length - 1 - LOSS_WINDOW)]
  const pings = history.flatMap((sample) => (sample.pingMs === null ? [] : [sample.pingMs]))
  const lostOutbound = latest.packetsLostOutbound - base.packetsLostOutbound
  const lostInbound = latest.packetsLostInbound - base.packetsLostInbound
  return {
    pingMs: latest.pingMs,
    averagePingMs: pings.length ? pings.reduce((sum, ping) => sum + ping, 0) / pings.length : null,
    pingHistory: pings,
    // packetsSent counts lost packets too.
    outboundLoss:
      base === latest ? null : lossBetween(lostOutbound, latest.packetsSent - base.packetsSent - lostOutbound),
    inboundLoss: base === latest ? null : lossBetween(lostInbound, latest.packetsReceived - base.packetsReceived),
    protocol: latest.protocol,
    relayed: latest.relayed,
    server: latest.server,
  }
}

/**
 * Samples the connection details. Keeps the recent samples for the average ping and the
 * packet loss, so create one while the details are shown and call it repeatedly.
 */
export function createConnectionSampler(
  getReports: () => Promise<RTCStatsReport[]>,
): () => Promise<ConnectionInfo | null> {
  const history: ConnectionTotals[] = []
  return async () => {
    const reports = await getReports()
    if (reports.length === 0) return null
    history.push(readConnectionTotals(reports))
    if (history.length > PING_HISTORY_LENGTH) history.shift()
    return summarizeConnection(history)
  }
}
