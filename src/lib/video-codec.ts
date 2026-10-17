/**
 * Video codec choice and encoder diagnostics.
 *
 * H.264 is the one codec every desktop GPU encodes in hardware: VideoToolbox on macOS,
 * NVENC (NVIDIA), AMF (AMD) and Quick Sync (Intel) through Media Foundation on Windows.
 * Hardware encoding keeps CPU and GPU shader load low while a game is running. Browsers
 * fall back to a software H.264 encoder (OpenH264) on their own when no hardware encoder
 * is available, so H.264 is never worse than VP8 there.
 */

export type PublishVideoCodec = "h264" | "vp8"

export function preferredVideoCodec(): PublishVideoCodec {
  if (typeof RTCRtpSender === "undefined" || !("getCapabilities" in RTCRtpSender)) return "vp8"
  const codecs = RTCRtpSender.getCapabilities("video")?.codecs ?? []
  return codecs.some((codec) => codec.mimeType.toLowerCase() === "video/h264") ? "h264" : "vp8"
}

type Limitation = "none" | "cpu" | "bandwidth" | "other"

export interface EncoderInfo {
  /** e.g. "H264" */
  codec: string
  /** true: hardware encoder; false: software; null: the browser does not say. */
  hardware: boolean | null
  /** Browser-specific encoder name, e.g. "VideoToolbox", "MediaFoundationVideoEncodeAccelerator", "OpenH264". */
  implementation: string
  width: number
  height: number
  fps: number
  /** Sent bits per second over all simulcast layers; null until a second sample exists. */
  bitrate: number | null
  /** What congestion control currently allows, over all layers. */
  targetBitrate: number
  /** Average encode time per frame of the top layer in ms; null until a second sample exists. */
  encodeMs: number | null
  /** "cpu" means the encoder cannot keep up; "bandwidth" means the upload limits quality. */
  limitation: Limitation
}

export interface DecoderInfo {
  codec: string
  hardware: boolean | null
  implementation: string
  width: number
  height: number
  fps: number
  bitrate: number | null
  /** Since the stream started. */
  framesDropped: number
  freezeCount: number
  packetsLost: number
}

type OutboundRtpStats = RTCOutboundRtpStreamStats & {
  encoderImplementation?: string
  powerEfficientEncoder?: boolean
  qualityLimitationReason?: string
  totalEncodeTime?: number
  framesEncoded?: number
  targetBitrate?: number
}

type InboundRtpStats = RTCInboundRtpStreamStats & {
  decoderImplementation?: string
  powerEfficientDecoder?: boolean
  freezeCount?: number
}

function codecName(report: RTCStatsReport, codecId: string | undefined): string {
  const codec = codecId ? (report.get(codecId) as { mimeType?: string } | undefined) : undefined
  return codec?.mimeType?.split("/")[1] ?? ""
}

function toLimitation(reason: string | undefined): Limitation {
  if (reason === "cpu" || reason === "bandwidth" || reason === "none") return reason
  return reason ? "other" : "none"
}

function rate(bytes: number, previousBytes: number | undefined, ms: number): number | null {
  return previousBytes === undefined || ms <= 0 ? null : ((bytes - previousBytes) * 8 * 1000) / ms
}

/**
 * What a sender's encoder is actually doing, from WebRTC stats. Keeps the previous
 * sample to derive bitrate and encode time, so create one per sender and call it repeatedly.
 */
export function createEncoderSampler(sender: RTCRtpSender): () => Promise<EncoderInfo | null> {
  let previous: { timestamp: number; bytes: number; encodeTime: number; frames: number } | undefined
  return async () => {
    const report = await sender.getStats()
    const layers: OutboundRtpStats[] = []
    report.forEach((stat: RTCStats) => {
      if (stat.type === "outbound-rtp") layers.push(stat as OutboundRtpStats)
    })
    if (layers.length === 0) return null
    const top = layers.reduce((best, layer) => ((layer.frameHeight ?? 0) > (best.frameHeight ?? 0) ? layer : best))
    const sample = {
      timestamp: top.timestamp,
      bytes: layers.reduce((sum, layer) => sum + (layer.bytesSent ?? 0), 0),
      encodeTime: top.totalEncodeTime ?? 0,
      frames: top.framesEncoded ?? 0,
    }
    const elapsed = previous ? sample.timestamp - previous.timestamp : 0
    const frames = previous ? sample.frames - previous.frames : 0
    const info: EncoderInfo = {
      codec: codecName(report, top.codecId),
      hardware: top.powerEfficientEncoder ?? null,
      implementation: top.encoderImplementation ?? "",
      width: top.frameWidth ?? 0,
      height: top.frameHeight ?? 0,
      fps: Math.round(top.framesPerSecond ?? 0),
      bitrate: rate(sample.bytes, previous?.bytes, elapsed),
      targetBitrate: layers.reduce((sum, layer) => sum + (layer.targetBitrate ?? 0), 0),
      encodeMs: previous && frames > 0 ? ((sample.encodeTime - previous.encodeTime) * 1000) / frames : null,
      limitation: toLimitation(top.qualityLimitationReason),
    }
    previous = sample
    return info
  }
}

/** What arrives at a receiver and how it decodes, like createEncoderSampler. */
export function createDecoderSampler(receiver: RTCRtpReceiver): () => Promise<DecoderInfo | null> {
  let previous: { timestamp: number; bytes: number } | undefined
  return async () => {
    const report = await receiver.getStats()
    let inbound: InboundRtpStats | undefined
    report.forEach((stat: RTCStats) => {
      if (stat.type === "inbound-rtp") inbound = stat as InboundRtpStats
    })
    if (!inbound) return null
    const sample = { timestamp: inbound.timestamp, bytes: inbound.bytesReceived ?? 0 }
    const info: DecoderInfo = {
      codec: codecName(report, inbound.codecId),
      hardware: inbound.powerEfficientDecoder ?? null,
      implementation: inbound.decoderImplementation ?? "",
      width: inbound.frameWidth ?? 0,
      height: inbound.frameHeight ?? 0,
      fps: Math.round(inbound.framesPerSecond ?? 0),
      bitrate: rate(sample.bytes, previous?.bytes, previous ? sample.timestamp - previous.timestamp : 0),
      framesDropped: inbound.framesDropped ?? 0,
      freezeCount: inbound.freezeCount ?? 0,
      packetsLost: inbound.packetsLost ?? 0,
    }
    previous = sample
    return info
  }
}

export function formatMbit(bitsPerSecond: number): string {
  return `${(bitsPerSecond / 1_000_000).toLocaleString("de-DE", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} Mbit/s`
}

/**
 * Firefox encodes H.264 with Cisco's OpenH264 (software) instead of the GPU, at least on
 * macOS, and reports neither its encoder nor CPU limits in WebRTC stats.
 */
export function hasSoftwareOnlyVideoEncoder(userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent): boolean {
  return /firefox/i.test(userAgent)
}

/**
 * The encoder needs most of the time between two frames. WebRTC then lowers the resolution
 * in 3/4 steps and drops frames; not every browser reports that as a CPU limit.
 */
export function isEncoderOverloaded(encodeMs: number | null, targetFps: number): boolean {
  return encodeMs !== null && encodeMs > (1000 / targetFps) * 0.8
}
