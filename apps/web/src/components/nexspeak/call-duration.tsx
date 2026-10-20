"use client"

import { useSyncExternalStore } from "react"
import { useTranslation } from "@/hooks/useTranslation"
import {
  formatCallDuration,
  getSecondTickerServerSnapshot,
  getSecondTickerSnapshot,
  subscribeSecondTicker,
} from "@/lib/second-ticker"

/** Subscribe here so each tick only renders the duration, not its channel or sidebar. */
export function CallDuration({ startedTs, className }: { startedTs: number; className?: string }) {
  const now = useSyncExternalStore(subscribeSecondTicker, getSecondTickerSnapshot, getSecondTickerServerSnapshot)
  const { t } = useTranslation()
  const duration = formatCallDuration(startedTs, now)
  return (
    <span className={className} aria-label={t("call.runningFor", { duration })}>
      {duration}
    </span>
  )
}
