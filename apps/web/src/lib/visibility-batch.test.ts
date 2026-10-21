import { afterEach, describe, expect, it, vi } from "vitest"
import { createVisibilityBatch } from "./visibility-batch"

function environment(hidden = false) {
  const document = Object.assign(new EventTarget(), { hidden })
  const frames = new Map<number, FrameRequestCallback>()
  const microtasks: (() => void)[] = []
  let nextFrame = 0
  vi.stubGlobal("document", document)
  const requestFrame = vi.fn((callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame })
  const cancelFrame = vi.fn((id: number) => { frames.delete(id) })
  vi.stubGlobal("requestAnimationFrame", requestFrame)
  vi.stubGlobal("cancelAnimationFrame", cancelFrame)
  vi.stubGlobal("queueMicrotask", (callback: () => void) => { microtasks.push(callback) })
  return { document, frames, microtasks, requestFrame, cancelFrame }
}

afterEach(() => { vi.unstubAllGlobals() })

describe("createVisibilityBatch", () => {
  it("does no work at idle and batches visible event bursts into one frame", () => {
    const env = environment()
    const callback = vi.fn()
    const batch = createVisibilityBatch(callback)
    expect(env.requestFrame).not.toHaveBeenCalled()
    for (let i = 0; i < 10; i++) batch.refresh()
    expect(env.frames.size).toBe(1)
    env.frames.get(1)!(0)
    expect(callback).toHaveBeenCalledOnce()
    batch.dispose()
  })

  it("delivers hidden event bursts without waiting for animation frames", () => {
    const env = environment(true)
    const callback = vi.fn()
    const batch = createVisibilityBatch(callback)
    batch.refresh()
    batch.refresh()
    expect(env.requestFrame).not.toHaveBeenCalled()
    expect(env.microtasks).toHaveLength(1)
    env.microtasks.shift()!()
    expect(callback).toHaveBeenCalledOnce()
    batch.dispose()
  })

  it("flushes a pending frame when the window is hidden and keeps subsequent events batched", () => {
    const env = environment()
    const callback = vi.fn()
    const batch = createVisibilityBatch(callback)
    batch.refresh()
    env.document.hidden = true
    env.document.dispatchEvent(new Event("visibilitychange"))
    batch.refresh()
    expect(env.frames.size).toBe(0)
    expect(env.cancelFrame).toHaveBeenCalledWith(1)
    expect(env.microtasks).toHaveLength(1)
    env.microtasks.shift()!()
    expect(callback).toHaveBeenCalledOnce()
    batch.dispose()
  })

  it("cancels pending work and visibility listeners on disposal", () => {
    const env = environment()
    const callback = vi.fn()
    const batch = createVisibilityBatch(callback)
    batch.refresh()
    batch.dispose()
    env.document.hidden = true
    env.document.dispatchEvent(new Event("visibilitychange"))
    batch.refresh()
    expect(env.frames.size).toBe(0)
    expect(env.microtasks).toHaveLength(0)
    expect(callback).not.toHaveBeenCalled()
  })

  it("ignores an already queued microtask after disposal", () => {
    const env = environment(true)
    const callback = vi.fn()
    const batch = createVisibilityBatch(callback)
    batch.refresh()
    batch.dispose()
    env.microtasks.shift()!()
    expect(callback).not.toHaveBeenCalled()
  })
})
