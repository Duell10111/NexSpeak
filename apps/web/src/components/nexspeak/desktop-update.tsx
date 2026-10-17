"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useCallContext } from "@/components/nexspeak/call-context"
import { useTranslation } from "@/hooks/useTranslation"
import { desktopBridge } from "@/lib/desktop"

/**
 * Desktop app only: offers to restart once an update is downloaded. Waits until the user is not
 * in a call, so it never interrupts one (the update also installs when the app quits).
 */
export function DesktopUpdateNotice() {
  const { t } = useTranslation()
  const { call } = useCallContext()
  const inCall = Boolean(call)
  const [version, setVersion] = useState<string | null>(null)
  const shownFor = useRef<string | null>(null)

  useEffect(() => desktopBridge()?.onUpdateReady(setVersion), [])

  useEffect(() => {
    if (!version || shownFor.current === version) return
    if (inCall) return
    shownFor.current = version
    toast(t("desktop.updateReady", { version }), {
      description: t("desktop.updateReadyDescription"),
      duration: Infinity,
      action: { label: t("desktop.updateRestart"), onClick: () => desktopBridge()?.installUpdate() },
    })
  }, [version, inCall, t])

  return null
}
