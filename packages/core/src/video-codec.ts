/**
 * Video codec choice and encoder diagnostics.
 *
 * H.264 is the one codec every desktop GPU encodes in hardware: VideoToolbox on macOS,
 * NVENC (NVIDIA), AMF (AMD) and Quick Sync (Intel) through Media Foundation on Windows.
 * Hardware encoding keeps CPU and GPU shader load low while a game is running. Browsers
 * fall back to a software H.264 encoder (OpenH264) on their own when no hardware encoder
 * is available, so H.264 is never worse than VP8 there.
 */

import { intlLocale } from '@nexspeak/i18n'

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
  return `${(bitsPerSecond / 1_000_000).toLocaleString(intlLocale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 })} Mbit/s`
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
 * Exchange Main and Constrained Baseline for packetization mode 1, without changing
 * payload types, RTX associations or levels. This is its own inverse, including when
 * an answer contains only one of the profiles.
 */
export function swapH264Profiles(sdp: string): string {
  return sdp
    .split(/(?=^m=)/m)
    .map((section) => {
      if (!section.startsWith("m=video ")) return section
      const h264 = new Set(Array.from(section.matchAll(/^a=rtpmap:(\d+) H264\/90000\r?$/gim), (match) => match[1]))
      return section.replace(/^a=fmtp:(\d+) (.+)$/gm, (line, payload: string, params: string) => {
        if (!h264.has(payload) || !/(?:^|;)packetization-mode=1(?:;|\r?$)/.test(params)) return line
        return line.replace(/profile-level-id=(42e0|4d00)([0-9a-f]{2})(?=;|\r?$)/i, (_: string, profile: string, level: string) =>
          `profile-level-id=${profile.toLowerCase() === "42e0" ? "4d00" : "42e0"}${level}`,
        )
      })
    })
    .join("")
}

function isChromium(userAgent: string): boolean {
  return /Chrome\//.test(userAgent) && !/Firefox\//.test(userAgent)
}

let mainProfilePatchInstalled = false

/**
 * LiveKit negotiates Constrained Baseline, which Chromium on macOS encodes in
 * software. Advertise the browser's native Main payload as Baseline to LiveKit,
 * then translate offers and answers back at the browser boundary. Both sides keep
 * the same payload numbers; Chromium's own codec registry is never profile-swapped.
 *
 * Translating createOffer (also the initial offer-with-join) is essential: changing
 * only setLocalDescription poisons later offers with the local profiles, and new
 * transceivers/placeholders then collide with the SFU's existing payload mapping.
 * The exchange covers every video section in the bundle, including recvonly ones
 * on single-PC connections. Legacy subscriber connections remain untouched.
 * No timers, per-frame work or extra encoder sessions are needed.
 */
export function installH264MainProfilePreference(): void {
  if (mainProfilePatchInstalled || typeof RTCPeerConnection === "undefined") return
  if (!isChromium(navigator.userAgent)) return
  mainProfilePatchInstalled = true
  const translated = new WeakSet<RTCPeerConnection>()
  const preferred = new WeakSet<RTCRtpTransceiver>()
  const codecs = RTCRtpReceiver.getCapabilities("video")?.codecs ?? []
  const main = (codec: RTCRtpCodec) => codec.mimeType.toLowerCase() === "video/h264"
    && /(?:^|;)packetization-mode=1(?:;|$)/.test(codec.sdpFmtpLine ?? "")
    && /profile-level-id=4d00/i.test(codec.sdpFmtpLine ?? "")
  const mainCodecs = codecs.filter(main)
  if (mainCodecs.length === 0) return
  const preferences = [...mainCodecs, ...codecs.filter((codec) => !main(codec))]
  const prototype = RTCPeerConnection.prototype
  const createOffer = prototype.createOffer as (this: RTCPeerConnection, options?: RTCOfferOptions) => Promise<RTCSessionDescriptionInit>
  const setLocal = prototype.setLocalDescription as (this: RTCPeerConnection, description?: RTCLocalSessionDescriptionInit) => Promise<void>
  const setRemote = prototype.setRemoteDescription as (this: RTCPeerConnection, description: RTCSessionDescriptionInit) => Promise<void>

  prototype.createOffer = async function (this: RTCPeerConnection, options?: RTCOfferOptions) {
    // The SFU also accepts Baseline packetization mode 0. Put Main mode 1 first
    // natively so the SFU selects its translated Baseline mode 1 entry, including
    // on the initial recvonly placeholders and on newly published tracks.
    for (const transceiver of this.getTransceivers()) {
      if (transceiver.receiver.track.kind !== "video" || preferred.has(transceiver)) continue
      transceiver.setCodecPreferences(preferences)
      preferred.add(transceiver)
    }
    const offer = await createOffer.call(this, options)
    if (!offer.sdp) return offer
    const sdp = swapH264Profiles(offer.sdp)
    if (sdp === offer.sdp) return offer
    translated.add(this)
    return { type: offer.type, sdp }
  } as typeof prototype.createOffer

  prototype.setLocalDescription = function (this: RTCPeerConnection, description?: RTCLocalSessionDescriptionInit) {
    if (description?.type === "offer" && description.sdp && translated.has(this)) {
      return setLocal.call(this, { type: "offer", sdp: swapH264Profiles(description.sdp) })
    }
    return setLocal.call(this, description)
  }

  prototype.setRemoteDescription = function (this: RTCPeerConnection, description: RTCSessionDescriptionInit) {
    if (description.type === "answer" && description.sdp && translated.has(this)) {
      return setRemote.call(this, { type: "answer", sdp: swapH264Profiles(description.sdp) })
    }
    return setRemote.call(this, description)
  }

  // LiveKit reads these again for reconnect sync and when restarting ICE while
  // an offer is pending. Keep that SDP in the same wire format as createOffer.
  for (const [name, type] of [["localDescription", "offer"], ["remoteDescription", "answer"]] as const) {
    let owner: object | null = prototype
    let descriptor: PropertyDescriptor | undefined
    while (owner && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(owner, name)
      owner = Object.getPrototypeOf(owner)
    }
    const get = descriptor?.get
    if (!get) continue
    Object.defineProperty(prototype, name, {
      ...descriptor,
      get(this: RTCPeerConnection) {
        const description = get.call(this) as RTCSessionDescription | null
        if (!description || description.type !== type || !translated.has(this)) return description
        return new RTCSessionDescription({ type, sdp: swapH264Profiles(description.sdp) })
      },
    })
  }
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
