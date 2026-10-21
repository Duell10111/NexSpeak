/** Batch event bursts without waiting for animation frames in a hidden tab or minimized window. */
export function createVisibilityBatch(callback: () => void): { refresh: () => void; dispose: () => void } {
  let frame: number | null = null
  let pending = false
  let disposed = false
  const flush = () => {
    frame = null
    pending = false
    if (!disposed) callback()
  }
  const refresh = () => {
    if (pending || disposed) return
    pending = true
    if (document.hidden) queueMicrotask(flush)
    else frame = requestAnimationFrame(flush)
  }
  const onVisibilityChange = () => {
    // A frame queued just before minimizing would otherwise wait until the app is restored.
    if (!document.hidden || frame === null) return
    cancelAnimationFrame(frame)
    frame = null
    queueMicrotask(flush)
  }
  document.addEventListener("visibilitychange", onVisibilityChange)
  return {
    refresh,
    dispose: () => {
      disposed = true
      if (frame !== null) cancelAnimationFrame(frame)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    },
  }
}
