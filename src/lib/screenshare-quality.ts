export const SCREENSHARE_RESOLUTIONS = ["720", "1080", "1440", "source"] as const
export const SCREENSHARE_FRAMERATES = [15, 30, 60] as const

export type ScreenShareResolution = (typeof SCREENSHARE_RESOLUTIONS)[number]
export type ScreenShareFramerate = (typeof SCREENSHARE_FRAMERATES)[number]

export interface ScreenShareQuality {
  resolution: ScreenShareResolution
  fps: ScreenShareFramerate
}

export const DEFAULT_SCREENSHARE_QUALITY: ScreenShareQuality = { resolution: "1080", fps: 30 }

const STORAGE_KEY = "nexspeak:screenshare-quality"

const HEIGHTS: Record<Exclude<ScreenShareResolution, "source">, number> = { "720": 720, "1080": 1080, "1440": 1440 }

// Bitrate caps at 30 fps. "source" is budgeted for up to 4K.
const BASE_BITRATE: Record<ScreenShareResolution, number> = {
  "720": 2_500_000,
  "1080": 4_500_000,
  "1440": 7_000_000,
  source: 10_000_000,
}
const FPS_FACTOR: Record<ScreenShareFramerate, number> = { 15: 0.6, 30: 1, 60: 1.6 }

export function resolutionLabel(resolution: ScreenShareResolution): string {
  return resolution === "source" ? "Quelle" : `${resolution}p`
}

/** Upper bitrate for the top layer; congestion control still adapts below it. */
export function screenShareBitrate(quality: ScreenShareQuality): number {
  return Math.round(BASE_BITRATE[quality.resolution] * FPS_FACTOR[quality.fps])
}

/**
 * Capture constraints. Only upper bounds: the browser keeps the aspect ratio and never
 * scales a smaller window up.
 */
export function screenShareConstraints(quality: ScreenShareQuality): MediaTrackConstraints {
  const frameRate = { ideal: quality.fps, max: quality.fps }
  if (quality.resolution === "source") return { frameRate }
  const height = HEIGHTS[quality.resolution]
  return { width: { max: Math.round((height * 16) / 9) }, height: { max: height }, frameRate }
}

/**
 * High frame rates are for games and video: keep them smooth and give up sharpness under
 * load. Low frame rates are for text and code: keep them sharp instead.
 */
export function screenShareTuning(quality: ScreenShareQuality): {
  contentHint: "" | "detail" | "motion"
  degradationPreference: RTCDegradationPreference
} {
  if (quality.fps >= 60) return { contentHint: "motion", degradationPreference: "maintain-framerate" }
  if (quality.fps <= 15) return { contentHint: "detail", degradationPreference: "maintain-resolution" }
  return { contentHint: "", degradationPreference: "balanced" }
}

export function loadScreenShareQuality(): ScreenShareQuality {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as Partial<ScreenShareQuality> | null
    return {
      resolution: SCREENSHARE_RESOLUTIONS.includes(parsed?.resolution as ScreenShareResolution)
        ? (parsed!.resolution as ScreenShareResolution)
        : DEFAULT_SCREENSHARE_QUALITY.resolution,
      fps: SCREENSHARE_FRAMERATES.includes(parsed?.fps as ScreenShareFramerate)
        ? (parsed!.fps as ScreenShareFramerate)
        : DEFAULT_SCREENSHARE_QUALITY.fps,
    }
  } catch {
    return DEFAULT_SCREENSHARE_QUALITY
  }
}

export function saveScreenShareQuality(quality: ScreenShareQuality): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(quality))
  } catch {
    // Remembering the choice is a convenience only.
  }
}
