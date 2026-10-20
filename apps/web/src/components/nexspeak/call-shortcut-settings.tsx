"use client"

import { useCallback, useEffect, useState } from "react"
import { CALL_SHORTCUT_ACTIONS, callShortcutConflict, type CallShortcutAction, type CallShortcutStatuses } from "@nexspeak/core/global-shortcuts"
import { Button } from "@/components/ui/button"
import { useTranslation } from "@/hooks/useTranslation"
import { saveAudioSettings, type AudioSettings } from "@/lib/audio-settings"
import { desktopBridge } from "@/lib/desktop"
import { shortcutFromKeyboardEvent, shortcutLabel } from "@/lib/global-shortcuts"
import { PushToTalkSettings } from "@/components/nexspeak/push-to-talk-settings"

const ACTION_LABELS = {
  "toggle-mute": "settings.shortcutMute",
  "toggle-deafen": "settings.shortcutDeafen",
  "leave-call": "call.leave",
  "stop-screen-share": "settings.shortcutStopScreenShare",
} as const

/** A single capture owner prevents PTT and call shortcuts from recording the same key together. */
export function CallInputSettings({ settings }: { settings: AudioSettings }) {
  const [capture, setCapture] = useState<CallShortcutAction | "ptt" | null>(null)
  const setPttCapture = useCallback((active: boolean) => setCapture(active ? "ptt" : null), [])
  return <>
    <PushToTalkSettings settings={settings} isCapturing={capture === "ptt"} setIsCapturing={setPttCapture} captureDisabled={capture !== null && capture !== "ptt"} />
    <CallShortcutSettings settings={settings} capturing={capture === "ptt" ? null : capture} setCapturing={setCapture} captureDisabled={capture === "ptt"} />
  </>
}

function CallShortcutSettings({ settings, capturing, setCapturing, captureDisabled }: {
  settings: AudioSettings
  capturing: CallShortcutAction | null
  setCapturing: (action: CallShortcutAction | null) => void
  captureDisabled: boolean
}) {
  const { t } = useTranslation()
  const bridge = desktopBridge()
  const [error, setError] = useState<"conflict" | "unsupported" | null>(null)
  const [statuses, setStatuses] = useState<CallShortcutStatuses | null>(null)

  useEffect(() => bridge?.onCallShortcutStatus(setStatuses), [bridge])

  useEffect(() => {
    if (!capturing || !bridge) return
    // Unregister rather than intercepting the user's old global shortcut during capture.
    bridge.setCallShortcutsSuspended(true)
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat) return
      if (event.code === "Escape") {
        setCapturing(null)
        return
      }
      if (/^(Control|Alt|Shift|Meta)(Left|Right)$/.test(event.code)) return
      const binding = shortcutFromKeyboardEvent(event)
      if (!binding) {
        setError("unsupported")
        return
      }
      if (callShortcutConflict(settings.callShortcuts, capturing, binding, settings.inputMode === "push-to-talk" ? settings.pushToTalkKey : null)) {
        setError("conflict")
        return
      }
      saveAudioSettings({ callShortcuts: { ...settings.callShortcuts, [capturing]: binding } })
      setError(null)
      setCapturing(null)
    }
    const cancel = () => setCapturing(null)
    window.addEventListener("keydown", onKeyDown, true)
    window.addEventListener("blur", cancel)
    return () => {
      window.removeEventListener("keydown", onKeyDown, true)
      window.removeEventListener("blur", cancel)
      bridge.setCallShortcutsSuspended(false)
    }
  }, [capturing, bridge, settings.callShortcuts, settings.inputMode, settings.pushToTalkKey, setCapturing])

  if (!bridge) return null
  return (
    <section className="space-y-3" aria-label={t("settings.callShortcuts")}>
      <h3 className="text-sm font-semibold">{t("settings.callShortcuts")}</h3>
      <p className="text-xs text-muted-foreground">{t("settings.callShortcutsHint")}</p>
      {CALL_SHORTCUT_ACTIONS.map((action) => {
        const binding = settings.callShortcuts[action]
        const conflict = binding && callShortcutConflict(settings.callShortcuts, action, binding, settings.inputMode === "push-to-talk" ? settings.pushToTalkKey : null)
        return (
          <div key={action} className="space-y-1" role="group" aria-label={t(ACTION_LABELS[action])}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t(ACTION_LABELS[action])}</p>
                <p className="break-words text-xs text-muted-foreground" aria-live="polite">
                  {capturing === action ? t("settings.shortcutPressKeys") : binding ? shortcutLabel(binding, bridge.platform) : t("settings.shortcutUnassigned")}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={captureDisabled || capturing !== null} onClick={() => { setError(null); setCapturing(action) }}>
                  {binding ? t("settings.pttChangeKey") : t("settings.pttSetKey")}
                </Button>
                <Button size="sm" variant="ghost" disabled={!binding || captureDisabled || capturing !== null} onClick={() => saveAudioSettings({ callShortcuts: { ...settings.callShortcuts, [action]: null } })}>
                  {t("settings.shortcutClear")}
                </Button>
              </div>
            </div>
            {(conflict || statuses?.[action] === "conflict") && <p className="text-xs text-destructive" role="alert">{t("settings.shortcutConflict")}</p>}
            {statuses?.[action] === "unavailable" && <p className="text-xs text-destructive" role="alert">{t("settings.shortcutUnavailable")}</p>}
          </div>
        )
      })}
      {error && <p className="text-xs text-destructive" role="alert">{t(error === "conflict" ? "settings.shortcutConflict" : "settings.shortcutUnsupported")}</p>}
    </section>
  )
}
