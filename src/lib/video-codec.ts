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
  /** "cpu" means the encoder cannot keep up; "bandwidth" means the upload limits quality. */
  limitation: "none" | "cpu" | "bandwidth" | "other"
}

type OutboundRtpStats = RTCOutboundRtpStreamStats & {
  encoderImplementation?: string
  powerEfficientEncoder?: boolean
  qualityLimitationReason?: string
}

/** What the encoder of a sender is actually doing, from WebRTC stats (top simulcast layer). */
export async function readEncoderInfo(sender: RTCRtpSender): Promise<EncoderInfo | null> {
  const report = await sender.getStats()
  let top: OutboundRtpStats | undefined
  report.forEach((stat: RTCStats) => {
    if (stat.type !== "outbound-rtp") return
    const outbound = stat as OutboundRtpStats
    if (!top || (outbound.frameHeight ?? 0) > (top.frameHeight ?? 0)) top = outbound
  })
  if (!top) return null
  const codecStats = top.codecId ? (report.get(top.codecId) as { mimeType: string } | undefined) : undefined
  const reason = top.qualityLimitationReason
  return {
    codec: codecStats?.mimeType.split("/")[1] ?? "",
    hardware: top.powerEfficientEncoder ?? null,
    implementation: top.encoderImplementation ?? "",
    width: top.frameWidth ?? 0,
    height: top.frameHeight ?? 0,
    fps: Math.round(top.framesPerSecond ?? 0),
    limitation: reason === "cpu" || reason === "bandwidth" || reason === "none" ? reason : reason ? "other" : "none",
  }
}
