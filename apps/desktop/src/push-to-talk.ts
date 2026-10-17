// Global push-to-talk: a system-wide keyboard/mouse hook (uiohook) that also sees keys while a game
// has the focus. It runs only while the web app has set a key, i.e. during a call with
// push-to-talk; the hook receives every input event (including mouse moves), so it must not run
// longer than needed.
import { ipcMain, systemPreferences, type IpcMainInvokeEvent, type WebContents } from "electron"
import { uIOhook, UiohookKey, type UiohookKeyboardEvent, type UiohookMouseEvent } from "uiohook-napi"
import type { PushToTalkStatus } from "@nexspeak/core/desktop-bridge" with { "resolution-mode": "import" }

// Same names as in preload.ts.
const IPC_PTT_SET_KEY = "nexspeak:ptt-set-key"
const IPC_PTT_STATUS = "nexspeak:ptt-status"
const IPC_PTT_REQUEST_PERMISSION = "nexspeak:ptt-request-permission"
const IPC_PTT_PRESSED = "nexspeak:ptt-pressed"

type Binding = { kind: "key"; keycode: number } | { kind: "mouse"; button: number }

/** KeyboardEvent.code names that differ from uiohook's key names. */
const RENAMED_CODES: Record<string, keyof typeof UiohookKey> = {
  ControlLeft: "Ctrl",
  ControlRight: "CtrlRight",
  AltLeft: "Alt",
  ShiftLeft: "Shift",
  MetaLeft: "Meta",
}

/** Translates the web app's key name (see apps/web/src/lib/push-to-talk.ts) for the hook. */
export function bindingFor(key: string): Binding | null {
  const mouse = /^Mouse([345])$/.exec(key)
  if (mouse) return { kind: "mouse", button: Number(mouse[1]) }
  const name = RENAMED_CODES[key] ?? key.replace(/^Key(?=[A-Z]$)|^Digit(?=\d$)/, "")
  const keycode = (UiohookKey as Record<string, number>)[name]
  return typeof keycode === "number" ? { kind: "key", keycode } : null
}

export function pushToTalkStatus(): PushToTalkStatus {
  // Wayland has no global input hooks; uiohook would only see keys in X11 windows.
  if (process.platform === "linux" && process.env.XDG_SESSION_TYPE === "wayland") return "unsupported"
  if (process.platform === "darwin" && !systemPreferences.isTrustedAccessibilityClient(false)) {
    return "permission-required"
  }
  return "active"
}

export function setupPushToTalk(webContents: () => WebContents | undefined): void {
  let binding: Binding | null = null
  let isHookRunning = false
  let isPressed = false

  const setPressed = (pressed: boolean) => {
    if (pressed === isPressed) return // the OS repeats key-down while a key is held
    isPressed = pressed
    webContents()?.send(IPC_PTT_PRESSED, pressed)
  }

  uIOhook.on("keydown", (event: UiohookKeyboardEvent) => {
    if (binding?.kind === "key" && event.keycode === binding.keycode) setPressed(true)
  })
  uIOhook.on("keyup", (event: UiohookKeyboardEvent) => {
    if (binding?.kind === "key" && event.keycode === binding.keycode) setPressed(false)
  })
  uIOhook.on("mousedown", (event: UiohookMouseEvent) => {
    if (binding?.kind === "mouse" && event.button === binding.button) setPressed(true)
  })
  uIOhook.on("mouseup", (event: UiohookMouseEvent) => {
    if (binding?.kind === "mouse" && event.button === binding.button) setPressed(false)
  })

  const update = (): PushToTalkStatus => {
    const status = pushToTalkStatus()
    const shouldRun = binding !== null && status === "active"
    if (shouldRun && !isHookRunning) {
      uIOhook.start()
      isHookRunning = true
    } else if (!shouldRun && isHookRunning) {
      uIOhook.stop()
      isHookRunning = false
      setPressed(false)
    }
    return status
  }

  const fromAppWindow = (event: IpcMainInvokeEvent) => event.sender === webContents()

  ipcMain.handle(IPC_PTT_SET_KEY, (event, key: unknown) => {
    if (!fromAppWindow(event)) return pushToTalkStatus()
    binding = typeof key === "string" ? bindingFor(key) : null
    return update()
  })
  ipcMain.handle(IPC_PTT_STATUS, () => pushToTalkStatus())
  ipcMain.handle(IPC_PTT_REQUEST_PERMISSION, () => {
    // Shows the system prompt that leads to Privacy & Security → Accessibility.
    if (process.platform === "darwin") systemPreferences.isTrustedAccessibilityClient(true)
    return update()
  })
}

/** The hook must not outlive the app (it would keep the process alive on some platforms). */
export function stopPushToTalk(): void {
  uIOhook.removeAllListeners()
  try {
    uIOhook.stop()
  } catch {
    // Was not running.
  }
}
