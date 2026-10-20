/** Shared clock for mounted durations. No timer or event listener remains without subscribers. */
const listeners = new Set<() => void>()
let now = 0
let timer: ReturnType<typeof setTimeout> | undefined

function publish() {
  now = Date.now()
  listeners.forEach((listener) => listener())
}

function schedule() {
  if (timer !== undefined || listeners.size === 0 || document.visibilityState !== "visible") return
  // Recalculate the delay every time, so throttling does not accumulate drift.
  timer = setTimeout(() => {
    timer = undefined
    publish()
    schedule()
  }, 1000 - Date.now() % 1000)
}

function stop() {
  clearTimeout(timer)
  timer = undefined
}

function onVisibilityChange() {
  stop()
  if (document.visibilityState === "visible") {
    publish()
    schedule()
  }
}

export function subscribeSecondTicker(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", onVisibilityChange)
    // Refresh even when mounting in a hidden window; do not start a timer there.
    publish()
    schedule()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      stop()
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }
}

export const getSecondTickerSnapshot = () => now
export const getSecondTickerServerSnapshot = () => 0

export function formatCallDuration(startedTs: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedTs) / 1000))
  const minutes = Math.floor(seconds / 60)
  const remainder = String(seconds % 60).padStart(2, "0")
  return minutes < 60
    ? `${minutes}:${remainder}`
    : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${remainder}`
}
