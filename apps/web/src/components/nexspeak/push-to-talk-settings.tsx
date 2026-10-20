"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Keyboard } from "lucide-react"
import type { PushToTalkStatus } from "@nexspeak/core/desktop-bridge"
import { CALL_SHORTCUT_ACTIONS, conflictsWithPushToTalk } from "@nexspeak/core/global-shortcuts"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { useTranslation } from "@/hooks/useTranslation"
import { MAX_PUSH_TO_TALK_RELEASE_DELAY_MS, saveAudioSettings, type AudioSettings, type InputMode } from "@/lib/audio-settings"
import { desktopBridge } from "@/lib/desktop"
import { keyboardKeyLabel, keyFromKeyboardEvent, keyFromMouseEvent, mouseButtonNumber } from "@/lib/push-to-talk"
import { cn } from "@/lib/utils"

interface KeyboardLayoutApi {
  getLayoutMap(): Promise<ReadonlyMap<string, string>>
}

/** The browser's keyboard layout (Chromium only), so keys are labelled as printed. */
export function useKeyboardLayout(): ReadonlyMap<string, string> | undefined {
  const [layout, setLayout] = useState<ReadonlyMap<string, string>>()
  useEffect(() => {
    const keyboard = (navigator as Navigator & { keyboard?: KeyboardLayoutApi }).keyboard
    keyboard
      ?.getLayoutMap()
      .then(setLayout)
      .catch(() => {})
  }, [])
  return layout
}

/** Desktop app only: whether the key also works while another app (a game) has the focus. */
function useDesktopPushToTalkStatus(enabled: boolean) {
  const [status, setStatus] = useState<PushToTalkStatus | null>(null)
  useEffect(() => {
    if (!enabled) return
    void desktopBridge()?.getPushToTalkStatus().then(setStatus)
  }, [enabled])
  const requestPermission = () => void desktopBridge()?.requestPushToTalkPermission().then(setStatus)
  return { status, requestPermission }
}

/** Waits for the next key or mouse button; Escape cancels. */
function useKeyCapture(isCapturing: boolean, onDone: (key: string | null) => void) {
  useEffect(() => {
    if (!isCapturing) return
    const bridge = desktopBridge()
    bridge?.setCallShortcutsSuspended(true)
    // Capture phase on window: runs before the dialog's own Escape handling.
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      onDone(event.code === "Escape" ? null : keyFromKeyboardEvent(event))
    }
    const onMouseDown = (event: MouseEvent) => {
      const key = keyFromMouseEvent(event)
      if (!key) return
      event.preventDefault()
      event.stopPropagation()
      onDone(key)
    }
    const onBlur = () => onDone(null)
    window.addEventListener("keydown", onKeyDown, true)
    window.addEventListener("mousedown", onMouseDown, true)
    window.addEventListener("blur", onBlur)
    return () => {
      window.removeEventListener("keydown", onKeyDown, true)
      window.removeEventListener("mousedown", onMouseDown, true)
      window.removeEventListener("blur", onBlur)
      bridge?.setCallShortcutsSuspended(false)
    }
  }, [isCapturing, onDone])
}

function conflictsWithCallShortcut(key: string, callShortcuts: AudioSettings["callShortcuts"]): boolean {
  return CALL_SHORTCUT_ACTIONS.some((action) => {
    const binding = callShortcuts[action]
    return Boolean(binding && conflictsWithPushToTalk(binding, key))
  })
}

export function PushToTalkSettings({ settings, isCapturing, setIsCapturing, captureDisabled }: {
  settings: AudioSettings
  isCapturing: boolean
  setIsCapturing: (active: boolean) => void
  captureDisabled: boolean
}) {
  const { t } = useTranslation()
  const layout = useKeyboardLayout()
  // The last key rejected for overlapping a call shortcut; the warning disappears once it no longer does.
  const [rejectedKey, setRejectedKey] = useState<string | null>(null)
  const isPushToTalk = settings.inputMode === "push-to-talk"
  const isDesktop = Boolean(desktopBridge())
  const { status, requestPermission } = useDesktopPushToTalkStatus(isDesktop && isPushToTalk)

  // Read through a ref, so a settings change during capture does not restart it (see useKeyCapture).
  const callShortcutsRef = useRef(settings.callShortcuts)
  useEffect(() => {
    callShortcutsRef.current = settings.callShortcuts
  })
  const finishCapture = useCallback((key: string | null) => {
    setIsCapturing(false)
    if (key && conflictsWithCallShortcut(key, callShortcutsRef.current)) {
      setRejectedKey(key)
      return
    }
    setRejectedKey(null)
    if (key) saveAudioSettings({ pushToTalkKey: key })
  }, [setIsCapturing])
  useKeyCapture(isCapturing, finishCapture)
  const hasConflict = !isCapturing && rejectedKey !== null && conflictsWithCallShortcut(rejectedKey, settings.callShortcuts)

  const key = settings.pushToTalkKey
  const mouseButton = key ? mouseButtonNumber(key) : null
  const keyLabel = !key
    ? null
    : mouseButton !== null
      ? t("settings.pttMouseButton", { number: mouseButton })
      : keyboardKeyLabel(key, layout)

  const modes: Array<{ value: InputMode; label: string }> = [
    { value: "voice-activity", label: t("settings.voiceActivity") },
    { value: "push-to-talk", label: t("settings.pushToTalk") },
  ]

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Keyboard className="h-4 w-4 text-muted-foreground" />
        <Label className="font-semibold">{t("settings.inputMode")}</Label>
      </div>
      <div role="radiogroup" aria-label={t("settings.inputMode")} className="grid grid-cols-2 gap-2">
        {modes.map((mode) => (
          <button
            key={mode.value}
            type="button"
            role="radio"
            aria-checked={settings.inputMode === mode.value}
            disabled={isCapturing || captureDisabled}
            onClick={() => saveAudioSettings({ inputMode: mode.value })}
            className={cn(
              "rounded-md border px-3 py-2 text-sm transition-colors",
              settings.inputMode === mode.value
                ? "border-primary bg-primary/10 font-medium"
                : "border-border hover:bg-accent",
            )}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {isPushToTalk && (
        <div className="space-y-4 rounded-md bg-muted/40 p-3">
          {hasConflict && <p className="text-xs text-destructive" role="alert">{t("settings.shortcutConflict")}</p>}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t("settings.pttKey")}</p>
              <p
                className={cn("text-sm", key ? "truncate text-foreground" : "text-destructive")}
                aria-live="polite"
              >
                {isCapturing ? t("settings.pttPressKey") : (keyLabel ?? t("settings.pttNoKey"))}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsCapturing(true)}
              disabled={isCapturing || captureDisabled}
              className="shrink-0"
            >
              {key ? t("settings.pttChangeKey") : t("settings.pttSetKey")}
            </Button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="ptt-release-delay">{t("settings.pttReleaseDelay")}</Label>
              <span className="text-sm font-medium text-muted-foreground">
                {settings.pushToTalkReleaseDelayMs} ms
              </span>
            </div>
            <Slider
              id="ptt-release-delay"
              min={0}
              max={MAX_PUSH_TO_TALK_RELEASE_DELAY_MS}
              step={20}
              value={[settings.pushToTalkReleaseDelayMs]}
              onValueChange={(value) => saveAudioSettings({ pushToTalkReleaseDelayMs: value[0] })}
            />
          </div>

          {!isDesktop && <p className="text-xs text-muted-foreground">{t("settings.pttBrowserHint")}</p>}
          {status === "unsupported" && (
            <p className="text-xs text-muted-foreground">{t("settings.pttUnsupportedHint")}</p>
          )}
          {status === "permission-required" && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t("settings.pttPermissionHint")}</p>
              <Button size="sm" variant="outline" onClick={requestPermission}>
                {t("settings.pttGrantPermission")}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
