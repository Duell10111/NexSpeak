import { useEffect, useState } from "react"

const STATS_POLL_MS = 1_000

/**
 * Polls a WebRTC stats sampler while mounted, so mount it only while the stats are visible
 * (e.g. inside a menu or popover that unmounts when closed).
 */
export function usePolledStats<T>(createSampler: () => (() => Promise<T | null>) | null): T | null {
  const [stats, setStats] = useState<T | null>(null)

  useEffect(() => {
    const sample = createSampler()
    if (!sample) return
    let cancelled = false
    const poll = () =>
      void sample()
        .then((next) => {
          if (!cancelled) setStats(next)
        })
        .catch(() => {})
    poll()
    const timer = window.setInterval(poll, STATS_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [createSampler])

  return stats
}
