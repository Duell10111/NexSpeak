"use client"

import { useEffect } from "react"
import { useCallContext } from "@/components/nexspeak/call-context"
import { useTranslation } from "@/hooks/useTranslation"
import { desktopBridge } from "@/lib/desktop"

/** Desktop app only: sends the tray and app menu texts in the current language. */
export function DesktopTrayLabels() {
  const { t } = useTranslation()
  useEffect(() => {
    desktopBridge()?.setTrayLabels({
      show: t("desktop.trayShow"),
      mute: t("call.muteMic"),
      deafen: t("call.deafen"),
      leaveCall: t("call.leave"),
      restartToUpdate: t("desktop.trayRestartToUpdate"),
      checkForUpdates: t("desktop.trayCheckForUpdates"),
      updateUpToDate: t("desktop.notifyUpToDate"),
      updateFound: t("desktop.notifyUpdateFound"),
      updateFailed: t("desktop.notifyUpdateFailed"),
      quit: t("desktop.trayQuit"),
    })
  }, [t])
  return null
}

/** Desktop app only: mirrors mute/deafen into the tray menu and runs its commands. */
export function DesktopTrayVoice() {
  const { call, isMicMuted, isDeafened, toggleMicrophone, toggleDeafen, leaveCall } = useCallContext()
  const inCall = Boolean(call)

  useEffect(() => {
    desktopBridge()?.setVoiceState({ muted: isMicMuted, deafened: isDeafened, inCall })
  }, [isMicMuted, isDeafened, inCall])

  // Logged out: the tray only offers to open and to quit.
  useEffect(() => () => desktopBridge()?.setVoiceState(null), [])

  useEffect(() => {
    return desktopBridge()?.onTrayCommand((command) => {
      if (command === "toggle-mute") void toggleMicrophone()
      else if (command === "toggle-deafen") toggleDeafen()
      else if (command === "leave-call") leaveCall()
    })
  }, [toggleMicrophone, toggleDeafen, leaveCall])

  return null
}
