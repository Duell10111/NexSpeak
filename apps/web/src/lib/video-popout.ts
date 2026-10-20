import type { CallVideoFeed } from "@nexspeak/core/matrix/call-session"

type VideoFeed = Pick<CallVideoFeed, "track" | "isLocal" | "isScreenshare">
type VideoTrack = CallVideoFeed["track"]

type DocumentPipWindow = Window & {
  documentPictureInPicture?: {
    requestWindow(options: { width: number; height: number }): Promise<Window>
  }
}

interface Entry {
  feed: VideoFeed
  video: HTMLVideoElement
  home: HTMLElement | null
}

interface Popout {
  entry: Entry
  close: () => Promise<void> | void
  dispose: () => void
}

/** Owns the existing video element across tile layout changes and PiP windows. */
export class VideoPopout {
  private entries = new Map<VideoTrack, Entry>()
  private listeners = new Set<() => void>()
  private current: Popout | null = null
  private pending: Entry | null = null
  private generation = 0
  private abortPending: (() => void) | null = null

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = (): VideoTrack | null => this.current?.entry.feed.track ?? null

  private emit() {
    this.listeners.forEach((listener) => listener())
  }

  private ensure(feed: VideoFeed, document: Document): Entry {
    const existing = this.entries.get(feed.track)
    if (existing) return existing
    const video = document.createElement("video")
    video.autoplay = true
    video.playsInline = true
    video.muted = true
    video.className = `absolute inset-0 h-full w-full ${feed.isScreenshare ? "object-contain" : "object-cover"}${feed.isLocal && !feed.isScreenshare ? " -scale-x-100" : ""}`
    feed.track.attach(video)
    const entry = { feed, video, home: null }
    this.entries.set(feed.track, entry)
    return entry
  }

  mount(feed: VideoFeed, home: HTMLElement): () => void {
    const entry = this.ensure(feed, home.ownerDocument)
    entry.home = home
    if (this.current?.entry !== entry) home.append(entry.video)
    return () => {
      if (entry.home !== home) return
      entry.home = null
      if (this.current?.entry !== entry && this.pending !== entry) this.release(entry)
    }
  }

  private release(entry: Entry) {
    if (this.entries.get(entry.feed.track) !== entry) return
    entry.feed.track.detach(entry.video)
    entry.video.remove()
    this.entries.delete(entry.feed.track)
  }

  /** Close on unsubscribe, camera off, participant departure or call teardown. */
  retain(feeds: CallVideoFeed[]) {
    if (!this.current && !this.pending) return
    const tracks = new Set(feeds.map((feed) => feed.track))
    if ((this.current && !tracks.has(this.current.entry.feed.track)) || (this.pending && !tracks.has(this.pending.feed.track))) this.close()
  }

  close = () => {
    this.generation += 1
    this.abortPending?.()
    this.abortPending = null
    const current = this.current
    this.current = null
    const pending = this.pending
    this.pending = null
    let closing: Promise<void> | void = undefined
    if (current) {
      current.dispose()
      closing = current.close()
      const { entry } = current
      entry.video.removeAttribute("style")
      if (entry.home) entry.home.append(entry.video)
      else this.release(entry)
      this.emit()
    }
    if (pending && !pending.home && pending !== current?.entry) this.release(pending)
    return closing
  }

  destroy() {
    this.close()
    for (const entry of this.entries.values()) this.release(entry)
  }

  async open(feed: VideoFeed, labels: { title: string; returnToCall: string }, native = false): Promise<void> {
    const closing = this.close()
    const generation = this.generation
    const entry = this.ensure(feed, document)
    this.pending = entry
    const { video } = entry
    const abort = new AbortController()
    this.abortPending = () => abort.abort()
    const mediaTrack = feed.track.mediaStreamTrack
    const onEnded = () => this.close()
    mediaTrack.addEventListener("ended", onEnded, { signal: abort.signal })
    let dispose = () => mediaTrack.removeEventListener("ended", onEnded)
    let closeWindow: () => Promise<void> | void = () => {}
    try {
      const documentPip = (window as DocumentPipWindow).documentPictureInPicture
      if (!native && documentPip) {
        const pip = await documentPip.requestWindow({ width: 640, height: 360 })
        closeWindow = () => pip.close()
        if (generation !== this.generation) { pip.close(); return }
        pip.document.title = labels.title
        pip.document.body.style.cssText = "margin:0;background:black;color:white;overflow:hidden"
        video.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:contain"
        // No CSS bundle, React root, second media element or second decoder in this window.
        if (feed.isLocal && !feed.isScreenshare) video.style.transform = "scaleX(-1)"
        pip.document.body.append(video)
        const back = pip.document.createElement("button")
        back.textContent = labels.returnToCall
        back.style.cssText = "position:absolute;top:8px;right:8px;padding:8px;border:0;border-radius:6px;background:#222;color:white;cursor:pointer"
        back.addEventListener("click", this.close)
        pip.document.body.append(back)
        pip.addEventListener("pagehide", this.close)
        const removeMediaListener = dispose
        dispose = () => {
          removeMediaListener()
          pip.removeEventListener("pagehide", this.close)
          back.removeEventListener("click", this.close)
          back.remove()
        }
      } else {
        // The own-stream preview may be paused: attach only on this explicit request and
        // wait for its first frame. The pending operation is cancelled on call/track end.
        if (!video.isConnected) {
          video.style.cssText = "position:fixed;width:640px;height:360px;opacity:0;pointer-events:none"
          document.body.append(video)
        }
        if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
          await new Promise<void>((resolve, reject) => {
            const cleanup = () => {
              video.removeEventListener("loadedmetadata", ready)
              abort.signal.removeEventListener("abort", cancelled)
            }
            const ready = () => { cleanup(); resolve() }
            const cancelled = () => { cleanup(); reject(new DOMException("Pop-out cancelled", "AbortError")) }
            video.addEventListener("loadedmetadata", ready, { once: true })
            abort.signal.addEventListener("abort", cancelled, { once: true })
            if (abort.signal.aborted) cancelled()
          })
        }
        // Chromium's native video PiP is always on top, including the sandboxed desktop app.
        if (closing) await closing
        if (generation !== this.generation) return
        const pip = await video.requestPictureInPicture()
        closeWindow = () => {
          if (document.pictureInPictureElement === video) return document.exitPictureInPicture().catch(() => {})
        }
        if (generation !== this.generation) {
          if (this.pending?.video !== video && this.current?.entry.video !== video) closeWindow()
          return
        }
        // LiveKit reads clientWidth/clientHeight. Match the native window, even in a hidden
        // main window; hiding only the main element avoids a second on-screen rendering.
        const resize = () => {
          video.style.cssText = `position:absolute;width:${pip.width}px;height:${pip.height}px;opacity:0;pointer-events:none`
        }
        resize()
        // Keep the element connected independently of React's grid/focus/preview layout.
        document.body.append(video)
        pip.addEventListener("resize", resize)
        video.addEventListener("leavepictureinpicture", this.close)
        const removeMediaListener = dispose
        dispose = () => {
          removeMediaListener()
          pip.removeEventListener("resize", resize)
          video.removeEventListener("leavepictureinpicture", this.close)
        }
      }
      this.pending = null
      this.abortPending = null
      this.current = { entry, close: closeWindow, dispose }
      this.emit()
    } catch (error) {
      dispose()
      if (generation !== this.generation) return
      closeWindow()
      video.removeAttribute("style")
      if (entry.home) entry.home.append(video)
      if (this.pending === entry) {
        this.pending = null
        this.abortPending = null
      }
      if (!entry.home && this.entries.has(feed.track)) this.release(entry)
      throw error
    } finally {
      if (generation !== this.generation) dispose()
    }
  }
}

export function supportsVideoPopout(): boolean {
  return typeof window !== "undefined" && (!!(window as DocumentPipWindow).documentPictureInPicture || document.pictureInPictureEnabled)
}
