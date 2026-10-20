import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  formatCallDuration,
  getSecondTickerServerSnapshot,
  getSecondTickerSnapshot,
  subscribeSecondTicker,
} from "./second-ticker"

describe("call duration formatting", () => {
  it.each([
    [0, "0:00"],
    [999, "0:00"],
    [1000, "0:01"],
    [59_999, "0:59"],
    [60_000, "1:00"],
    [3_599_999, "59:59"],
    [3_600_000, "1:00:00"],
    [7_193_000, "1:59:53"],
    [360_000_000, "100:00:00"],
    [-5000, "0:00"],
  ])("formats an elapsed time of %i ms as %s", (elapsed, expected) => {
    expect(formatCallDuration(10_000, 10_000 + elapsed)).toBe(expected)
  })
})

describe("shared second ticker", () => {
  let document: EventTarget & { visibilityState: string }
  const cleanups: Array<() => void> = []

  function subscribe(listener = vi.fn()) {
    const unsubscribe = subscribeSecondTicker(listener)
    cleanups.push(unsubscribe)
    return { listener, unsubscribe }
  }

  function setVisibility(state: string) {
    document.visibilityState = state
    document.dispatchEvent(new Event("visibilitychange"))
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(10_250)
    document = Object.assign(new EventTarget(), { visibilityState: "visible" })
    vi.stubGlobal("document", document)
  })

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup())
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("shares one timer, aligns to full seconds, and stops after the last subscriber leaves", () => {
    const removeListener = vi.spyOn(document, "removeEventListener")
    const first = subscribe()
    const second = subscribe()
    first.listener.mockClear()
    expect(getSecondTickerSnapshot()).toBe(10_250)
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(749)
    expect(first.listener).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(getSecondTickerSnapshot()).toBe(11_000)
    expect(first.listener).toHaveBeenCalledTimes(1)
    expect(second.listener).toHaveBeenCalledTimes(1)
    first.unsubscribe()
    expect(vi.getTimerCount()).toBe(1)
    second.unsubscribe()
    expect(vi.getTimerCount()).toBe(0)
    expect(removeListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function))
    expect(getSecondTickerServerSnapshot()).toBe(0)
  })

  it("does no ticking while hidden and catches up immediately when visible", () => {
    const { listener } = subscribe()
    setVisibility("hidden")
    listener.mockClear()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(65_123)
    expect(listener).not.toHaveBeenCalled()
    setVisibility("visible")
    expect(getSecondTickerSnapshot()).toBe(75_373)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(627)
    expect(getSecondTickerSnapshot()).toBe(76_000)
  })

  it("does not start a timer when mounted hidden and can restart after unmounting", () => {
    setVisibility("hidden")
    const first = subscribe()
    expect(vi.getTimerCount()).toBe(0)
    first.unsubscribe()
    vi.advanceTimersByTime(5000)
    setVisibility("visible")
    expect(vi.getTimerCount()).toBe(0)
    const second = subscribe()
    expect(getSecondTickerSnapshot()).toBe(15_250)
    expect(vi.getTimerCount()).toBe(1)
    second.unsubscribe()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("reads wall time rather than counting ticks after a clock jump", () => {
    subscribe()
    vi.setSystemTime(123_456)
    vi.advanceTimersToNextTimer()
    expect(getSecondTickerSnapshot()).toBe(Date.now())
    const delay = 1000 - Date.now() % 1000
    vi.advanceTimersByTime(delay)
    expect(getSecondTickerSnapshot() % 1000).toBe(0)
  })
})
