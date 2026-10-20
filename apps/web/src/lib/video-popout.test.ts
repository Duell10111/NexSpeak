import { afterEach, describe, expect, it, vi } from "vitest"
import type { CallVideoFeed } from "@nexspeak/core/matrix/call-session"
import { VideoPopout } from "./video-popout"

class Node extends EventTarget {
  ownerDocument: FakeDocument
  parent: Node | null = null
  children: Node[] = []
  style = { cssText: "", transform: "" }
  className = ""
  textContent = ""
  constructor(document: FakeDocument) { super(); this.ownerDocument = document }
  append(node: Node) {
    node.remove()
    node.parent = this
    node.ownerDocument = this.ownerDocument
    this.children.push(node)
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this)
    this.parent = null
  }
  removeAttribute(name: string) { if (name === "style") this.style.cssText = "" }
  get isConnected(): boolean { return this === this.ownerDocument.body || !!this.parent?.isConnected }
}

class FakeVideo extends Node {
  autoplay = false
  playsInline = false
  muted = false
  readyState = 1
  requestPictureInPicture = vi.fn(async () => {
    this.ownerDocument.pictureInPictureElement = this
    return nativeWindow
  })
}
class FakeDocument {
  body = new Node(this)
  title = ""
  pictureInPictureElement: FakeVideo | null = null
  exitPictureInPicture = vi.fn(async () => { this.pictureInPictureElement = null })
  createElement(tag: string): Node { return tag === "video" ? new FakeVideo(this) : new Node(this) }
}
class FakeWindow extends EventTarget {
  document = new FakeDocument()
  close = vi.fn(() => this.dispatchEvent(new Event("pagehide")))
}
const nativeWindow = Object.assign(new EventTarget(), { width: 320, height: 180 })

function setup() {
  const document = new FakeDocument()
  const pip = new FakeWindow()
  const requestWindow = vi.fn(async () => pip)
  vi.stubGlobal("document", document)
  vi.stubGlobal("window", { documentPictureInPicture: { requestWindow } })
  vi.stubGlobal("HTMLMediaElement", { HAVE_METADATA: 1 })
  const mediaStreamTrack = new EventTarget()
  const track = { attach: vi.fn(), detach: vi.fn(), mediaStreamTrack }
  const feed = { track, isLocal: false, isScreenshare: true } as unknown as CallVideoFeed
  const manager = new VideoPopout()
  const home = new Node(document)
  document.body.append(home)
  const unmount = manager.mount(feed, home as unknown as HTMLElement)
  const video = home.children[0] as FakeVideo
  return { manager, home, video, feed, track, mediaStreamTrack, document, pip, requestWindow, unmount }
}
const labels = { title: "Alice", returnToCall: "Return to call" }
afterEach(() => vi.unstubAllGlobals())

describe("video pop-out lifecycle", () => {
  it("moves the same attached element into Document PiP and back without another decoder", async () => {
    const { manager, video, feed, track, home, pip } = setup()
    await manager.open(feed, labels)
    expect(pip.document.body.children).toContain(video)
    expect(home.children).not.toContain(video)
    expect(manager.getSnapshot()).toBe(feed.track)
    pip.close()
    expect(home.children).toEqual([video])
    expect(manager.getSnapshot()).toBeNull()
    expect(track.attach).toHaveBeenCalledExactlyOnceWith(video)
    expect(track.detach).not.toHaveBeenCalled()
    manager.destroy()
    expect(track.detach).toHaveBeenCalledExactlyOnceWith(video)
  })

  it("keeps the same element while the main call switches between grid and focus", async () => {
    const { manager, video, feed, document, unmount, track } = setup()
    await manager.open(feed, labels)
    unmount()
    const nextHome = new Node(document)
    manager.mount(feed, nextHome as unknown as HTMLElement)
    manager.close()
    expect(nextHome.children).toEqual([video])
    expect(track.attach).toHaveBeenCalledTimes(1)
    expect(track.detach).not.toHaveBeenCalled()
    manager.destroy()
  })

  it("closes and detaches a pop-out whose track was removed, then cleans up on call end", async () => {
    const { manager, feed, pip, track, unmount } = setup()
    await manager.open(feed, labels)
    unmount()
    manager.retain([])
    expect(pip.close).toHaveBeenCalledTimes(1)
    expect(track.detach).toHaveBeenCalledTimes(1)
    expect(manager.getSnapshot()).toBeNull()
    manager.destroy()
    expect(track.detach).toHaveBeenCalledTimes(1)
  })

  it("returns on media track end, removing its listener before the next pop-out", async () => {
    const { manager, feed, mediaStreamTrack, pip } = setup()
    await manager.open(feed, labels)
    mediaStreamTrack.dispatchEvent(new Event("ended"))
    expect(pip.close).toHaveBeenCalledTimes(1)
    mediaStreamTrack.dispatchEvent(new Event("ended"))
    expect(pip.close).toHaveBeenCalledTimes(1)
    manager.destroy()
  })

  it("closes a late window if the call ended while the browser was opening PiP", async () => {
    const { manager, feed, pip, requestWindow, track } = setup()
    let resolve!: (window: FakeWindow) => void
    requestWindow.mockImplementation(() => new Promise((done) => { resolve = done }))
    const opening = manager.open(feed, labels)
    manager.destroy()
    resolve(pip)
    await opening
    expect(pip.close).toHaveBeenCalledTimes(1)
    expect(pip.document.body.children).toEqual([])
    expect(manager.getSnapshot()).toBeNull()
    expect(track.detach).toHaveBeenCalledTimes(1)
  })

  it("leaves the original video attached when a PiP request is rejected", async () => {
    const { manager, feed, video, home, requestWindow, track } = setup()
    requestWindow.mockRejectedValue(new Error("Denied"))
    await expect(manager.open(feed, labels)).rejects.toThrow("Denied")
    expect(home.children).toEqual([video])
    expect(track.detach).not.toHaveBeenCalled()
    expect(manager.getSnapshot()).toBeNull()
    manager.destroy()
  })

  it("uses native PiP dimensions for adaptive streaming and hides the main rendering", async () => {
    const { manager, feed, video, document, home, unmount, track } = setup()
    await manager.open(feed, labels, true)
    expect(video.requestPictureInPicture).toHaveBeenCalledTimes(1)
    expect(video.parent).toBe(document.body)
    expect(video.style.cssText).toContain("width:320px;height:180px;opacity:0")
    nativeWindow.width = 480
    nativeWindow.dispatchEvent(new Event("resize"))
    expect(video.style.cssText).toContain("width:480px")
    unmount()
    manager.mount(feed, home as unknown as HTMLElement)
    video.dispatchEvent(new Event("leavepictureinpicture"))
    expect(video.style.cssText).toBe("")
    expect(home.children).toEqual([video])
    expect(track.attach).toHaveBeenCalledTimes(1)
    nativeWindow.width = 320
    nativeWindow.dispatchEvent(new Event("resize"))
    expect(video.style.cssText).toBe("")
    manager.destroy()
  })

  it("cancels waiting for the first frame of a paused own preview when the call ends", async () => {
    const { manager, feed, video, unmount, track } = setup()
    video.readyState = 0
    const opening = manager.open(feed, labels, true)
    unmount()
    manager.destroy()
    await opening
    expect(video.requestPictureInPicture).not.toHaveBeenCalled()
    expect(track.detach).toHaveBeenCalledTimes(1)
    expect(manager.getSnapshot()).toBeNull()
  })
  it("does not let an old rejected request delete a newer same-track pop-out", async () => {
    const { manager, feed, track, requestWindow, unmount, pip } = setup()
    let reject!: (error: Error) => void
    requestWindow.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    const first = manager.open(feed, labels)
    unmount()
    const second = manager.open(feed, labels)
    await second
    reject(new Error("Old request cancelled"))
    await first
    expect(manager.getSnapshot()).toBe(feed.track)
    expect(pip.document.body.children).toHaveLength(2)
    expect(track.attach).toHaveBeenCalledTimes(2)
    expect(track.detach).toHaveBeenCalledTimes(1)
    manager.destroy()
    expect(track.detach).toHaveBeenCalledTimes(2)
  })

  it("waits for native PiP exit before requesting another track", async () => {
    const { manager, feed, video, document } = setup()
    await manager.open(feed, labels, true)
    const secondFeed = { ...feed, track: { ...feed.track, mediaStreamTrack: new EventTarget() } } as CallVideoFeed
    const secondHome = new Node(document)
    manager.mount(secondFeed, secondHome as unknown as HTMLElement)
    const secondVideo = secondHome.children[0] as FakeVideo
    let exited!: () => void
    document.exitPictureInPicture.mockImplementation(() => new Promise<void>((resolve) => { exited = resolve }))
    const opening = manager.open(secondFeed, labels, true)
    expect(secondVideo.requestPictureInPicture).not.toHaveBeenCalled()
    expect(video.style.cssText).toBe("")
    exited()
    await opening
    expect(secondVideo.requestPictureInPicture).toHaveBeenCalledTimes(1)
    expect(manager.getSnapshot()).toBe(secondFeed.track)
    manager.destroy()
  })

  it("returns the video to its current home after browsing away and back", async () => {
    const { manager, feed, pip, document, video, unmount, track } = setup()
    await manager.open(feed, labels)
    unmount()
    expect(pip.document.body.children).toContain(video)
    const newHome = new Node(document)
    manager.mount(feed, newHome as unknown as HTMLElement)
    manager.close()
    expect(newHome.children).toEqual([video])
    expect(track.attach).toHaveBeenCalledTimes(1)
    manager.destroy()
  })

})
