"use client"

import { useEffect, useRef, useState } from "react"
import { RefreshCw } from "lucide-react"
import { toast } from "sonner"
import type { UpdateStatus } from "@nexspeak/core/desktop-bridge"
import { useCallContext } from "@/components/nexspeak/call-context"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { useTranslation } from "@/hooks/useTranslation"
import { desktopBridge } from "@/lib/desktop"

function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => desktopBridge()?.onUpdateStatus(setStatus), [])
  return status
}

/**
 * Desktop app only: offers to restart once an update is downloaded. Waits until the user is not
 * in a call, so it never interrupts one (the update also installs when the app quits).
 */
export function DesktopUpdateNotice() {
  const { t } = useTranslation()
  const { call } = useCallContext()
  const inCall = Boolean(call)
  const status = useUpdateStatus()
  const version = status?.state === "ready" ? status.version : null
  const shownFor = useRef<string | null>(null)

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

/** Desktop app only (Settings → About): app version, channel and "Check for updates". */
export function DesktopUpdateSection() {
  const { t } = useTranslation()
  const { call } = useCallContext()
  const inCall = Boolean(call)
  const status = useUpdateStatus()
  const bridge = desktopBridge()
  if (!bridge || !status) return null

  const busy = status.state === "checking" || status.state === "downloading"
  let message: string | null = null
  switch (status.state) {
    case "checking":
      message = t("about.updateChecking")
      break
    case "up-to-date":
      message = t("about.updateUpToDate")
      break
    case "waiting-for-call":
      message = t("about.updateWaitingForCall", { version: status.version })
      break
    case "downloading":
      message = t("about.updateDownloading", { version: status.version, percent: status.percent })
      break
    case "ready":
      message = t(inCall ? "about.updateReadyInCall" : "about.updateReady", { version: status.version })
      break
    case "error":
      message =
        status.error === "offline"
          ? t("about.updateOffline")
          : status.error === "unsigned"
            ? t("about.updateUnsigned")
            : status.error === "unsupported"
              ? t("about.updateUnsupported")
              : status.message
                ? t("about.updateFailed", { message: status.message })
                : t("about.updateFailedUnknown")
      break
  }

  return (
    <div className="space-y-2" data-testid="desktop-update">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {t("about.desktopVersion", { version: bridge.appVersion })} ·{" "}
          {t(bridge.channel === "nightly" ? "about.channelNightly" : "about.channelStable")}
        </p>
        {status.state === "ready" ? (
          <Button size="sm" disabled={inCall} onClick={() => bridge.installUpdate()}>
            {t("about.restartToUpdate")}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => bridge.checkForUpdates()}>
            {busy ? <Spinner className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
            {t("about.checkForUpdates")}
          </Button>
        )}
      </div>
      {message && (
        <p className={status.state === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"} role="status">
          {message}
        </p>
      )}
      {status.state === "downloading" && <Progress value={status.percent} className="h-1.5" />}
    </div>
  )
}

/** Desktop app only: "Check for updates…" in the tray or app menu opens Settings → About. */
export function useShowUpdates(show: () => void) {
  const showRef = useRef(show)
  useEffect(() => {
    showRef.current = show
  })
  useEffect(() => desktopBridge()?.onShowUpdates(() => showRef.current()), [])
}
