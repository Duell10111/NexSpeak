/** Owns only the preview's tracks, including capture results arriving after it was stopped. */
export class CameraPreview {
  private revision = 0
  private stream: MediaStream | null = null

  stop(): void {
    this.revision++
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
  }

  async start(deviceId: string): Promise<MediaStream | null> {
    this.stop()
    const revision = this.revision
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { deviceId: deviceId ? { ideal: deviceId } : undefined },
      })
      if (revision !== this.revision) {
        stream.getTracks().forEach((track) => track.stop())
        return null
      }
      this.stream = stream
      return stream
    } catch (error) {
      if (revision !== this.revision) return null
      throw error
    }
  }
}
