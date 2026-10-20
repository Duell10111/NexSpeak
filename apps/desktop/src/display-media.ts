/** ScreenCaptureKit supports loopback capture starting with macOS 13 (Darwin 22). */
export function supportsSystemAudio(platform: string, kernelRelease: string): boolean {
  return platform === "win32" || (platform === "darwin" && Number(kernelRelease.split(".")[0]) >= 22)
}

/** Explicitly exclude our audio service on macOS, including macOS 13's ScreenCaptureKit path. */
export function screenShareAudioDevice(audioRequested: boolean, platform: string, kernelRelease: string) {
  if (!audioRequested || !supportsSystemAudio(platform, kernelRelease)) return undefined
  return platform === "darwin" ? "loopbackWithoutChrome" : "loopback"
}
