import { useEffect } from "react"
import type { CallSession } from "@nexspeak/core/matrix/call-session"
import type { AudioSettings } from "@/lib/audio-settings"
import { desktopBridge } from "@/lib/desktop"
import { isEditableTarget, keyFromKeyboardEvent, keyFromMouseEvent } from "@/lib/push-to-talk"

/**
 * Push-to-talk for the running call. In the desktop app the key works system-wide (also in games)
 * through the main process; in the browser, or where the global hook is unavailable, only while
 * NexSpeak has the focus. Nothing listens outside of a call.
 */
export function usePushToTalk(session: CallSession | null, settings: AudioSettings): void {
  const enabled = settings.inputMode === "push-to-talk"
  const key = enabled ? settings.pushToTalkKey : null
  const releaseDelayMs = settings.pushToTalkReleaseDelayMs

  useEffect(() => {
    session?.setPushToTalk(enabled)
  }, [session, enabled])

  useEffect(() => {
    if (!session || !key) return

    let releaseTimer: ReturnType<typeof setTimeout> | undefined
    const setPressed = (pressed: boolean) => {
      clearTimeout(releaseTimer)
      if (pressed || releaseDelayMs === 0) session.setPushToTalkPressed(pressed)
      else releaseTimer = setTimeout(() => session.setPushToTalkPressed(false), releaseDelayMs)
    }

    // Window events, until the desktop app reports that its global hook has taken over.
    let useWindowEvents = true
    const onKeyDown = (event: KeyboardEvent) => {
      if (!useWindowEvents || event.repeat || keyFromKeyboardEvent(event) !== key) return
      if (!isEditableTarget(event.target)) setPressed(true)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (useWindowEvents && keyFromKeyboardEvent(event) === key) setPressed(false)
    }
    const onMouseDown = (event: MouseEvent) => {
      if (useWindowEvents && keyFromMouseEvent(event) === key) setPressed(true)
    }
    const onMouseUp = (event: MouseEvent) => {
      if (useWindowEvents && keyFromMouseEvent(event) === key) setPressed(false)
    }
    // The key-up never arrives once the window lost the focus.
    const onBlur = () => {
      if (useWindowEvents) setPressed(false)
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    window.addEventListener("mousedown", onMouseDown)
    window.addEventListener("mouseup", onMouseUp)
    window.addEventListener("blur", onBlur)

    const bridge = desktopBridge()
    const stopBridge = bridge?.onPushToTalk(setPressed)
    let isCurrent = true
    void bridge?.setPushToTalkKey(key).then((status) => {
      if (isCurrent && status === "active") useWindowEvents = false
    })

    return () => {
      isCurrent = false
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("mousedown", onMouseDown)
      window.removeEventListener("mouseup", onMouseUp)
      window.removeEventListener("blur", onBlur)
      stopBridge?.()
      void bridge?.setPushToTalkKey(null)
      clearTimeout(releaseTimer)
      session.setPushToTalkPressed(false)
    }
  }, [session, key, releaseDelayMs])
}
