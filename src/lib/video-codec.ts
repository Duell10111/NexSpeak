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
 * in 3/4 steps and drops frames; not every browser reports that as a CPU limit. Only meaningful
 * for software encoders: hardware encoders run pipelined and report latency as encode time.
 */
export function isEncoderOverloaded(encodeMs: number | null, targetFps: number): boolean {
  return encodeMs !== null && encodeMs > (1000 / targetFps) * 0.8
}

/**
 * LiveKit only negotiates H.264 Constrained Baseline (42e01f). Chrome on macOS encodes that
 * profile in software (OpenH264) and only uses VideoToolbox for Main. Main without B-frames
 * (WebRTC encoders never use them) decodes in every browser that decodes H.264.
 *
 * So the publishing connection uses Main under the payload type the SFU negotiated as
 * Constrained Baseline, consistently on both sides of our local JSEP state:
 *  - our local offer swaps the profiles of the Constrained Baseline and Main payload types
 *    (LiveKit still sends its own, unchanged offer to the SFU),
 *  - the SFU's answer is read as Main for that payload type.
 * The SFU forwards the stream unchanged; viewers' SDP is untouched. Rewriting only the answer
 * is not enough: newer Chromium then sends with the payload type of its own Main entry, which
 * the SFU does not know, and viewers receive no frames.
 */
export function swapH264ProfilesInOffer(sdp: string): string {
  return sdp
    .split(/(?=^m=)/m)
    .map((section) => {
      if (!section.startsWith("m=video")) return section
      const lines = section.split("\r\n")
      const find = (profile: string) =>
        lines.findIndex(
          (line) =>
            line.startsWith("a=fmtp:") &&
            line.includes("packetization-mode=1") &&
            new RegExp(`profile-level-id=${profile}[0-9a-f]{2}(;|$)`, "i").test(line),
        )
      const baseline = find("42e0")
      const main = find("4d00")
      if (baseline < 0 || main < 0) return section
      const id = (line: string) => line.match(/profile-level-id=([0-9a-f]{6})/i)![1]
      const baselineId = id(lines[baseline])
      const mainId = id(lines[main])
      lines[baseline] = lines[baseline].replace(baselineId, mainId)
      lines[main] = lines[main].replace(mainId, baselineId)
      return lines.join("\r\n")
    })
    .join("")
}

export function preferH264MainProfile(sdp: string): string {
  return sdp.replace(/profile-level-id=42[0-9a-f]{2}([0-9a-f]{2})/gi, "profile-level-id=4d00$1")
}

function isChromium(userAgent: string): boolean {
  return /Chrome\//.test(userAgent) && !/Firefox\//.test(userAgent)
}

let mainProfilePatchInstalled = false

/**
 * Applies the profile swap in Chromium. Not for Firefox and Safari: Firefox has no hardware
 * encoder anyway, and Safari already uses VideoToolbox for Baseline. If the browser rejects
 * the rewritten offer, the connection continues with the original one, unchanged.
 */
export function installH264MainProfilePreference(): void {
  if (mainProfilePatchInstalled || typeof RTCPeerConnection === "undefined") return
  if (!isChromium(navigator.userAgent)) return
  mainProfilePatchInstalled = true
  // Connections whose current local offer uses the swapped profiles.
  const swapped = new WeakSet<RTCPeerConnection>()
  const prototype = RTCPeerConnection.prototype
  const setLocal = prototype.setLocalDescription as (this: RTCPeerConnection, ...args: unknown[]) => Promise<void>
  const setRemote = prototype.setRemoteDescription as (this: RTCPeerConnection, ...args: unknown[]) => Promise<void>

  prototype.setLocalDescription = async function (this: RTCPeerConnection, description?: RTCLocalSessionDescriptionInit) {
    if (description?.type !== "offer" || !description.sdp) return setLocal.call(this, description)
    const sdp = swapH264ProfilesInOffer(description.sdp)
    if (sdp !== description.sdp) {
      try {
        await setLocal.call(this, { type: "offer", sdp })
        swapped.add(this)
        return
      } catch (error) {
        console.warn("H.264 Main profile not accepted, keeping Constrained Baseline", error)
      }
    }
    swapped.delete(this)
    return setLocal.call(this, description)
  } as typeof prototype.setLocalDescription

  prototype.setRemoteDescription = function (this: RTCPeerConnection, description: RTCSessionDescriptionInit) {
    if (description?.type === "answer" && description.sdp && swapped.has(this)) {
      return setRemote.call(this, { type: "answer", sdp: preferH264MainProfile(description.sdp) })
    }
    return setRemote.call(this, description)
  } as typeof prototype.setRemoteDescription
}

/**
 * Hardware H.264 encoders (VideoToolbox, and others) refuse odd frame sizes, and the browser
 * silently falls back to software, e.g. for a 1728×1117 window. Returns the smallest scale
 * factor ≥ minScale for which the scaled size is even in both dimensions, whether the browser
 * rounds (Chrome does) or truncates.
 */
export function evenScale(width: number, height: number, minScale = 1): number {
  if (width <= 0 || height <= 0) return minScale
  const isEvenAt = (scale: number) => {
    const scaledWidth = width / scale
    const scaledHeight = height / scale
    // Below .5 (with a margin) rounding and truncation agree, whichever the browser uses.
    const fits = (value: number) => value - Math.floor(value) < 0.49 && Math.floor(value) % 2 === 0
    return fits(scaledWidth) && fits(scaledHeight)
  }
  if (isEvenAt(minScale)) return minScale
  // Hit an even height or width exactly and check the other side; the smallest factor wins.
  // A hair below the exact factor so floating point error cannot land just under the target.
  const firstFit = (size: number) => {
    for (let target = Math.floor(size / minScale / 2) * 2; target >= 2; target -= 2) {
      const scale = (size / target) * (1 - 1e-9)
      if (scale >= minScale && isEvenAt(scale)) return scale
    }
    return Infinity
  }
  const scale = Math.min(firstFit(height), firstFit(width))
  if (Number.isFinite(scale)) return scale
  return minScale
}
