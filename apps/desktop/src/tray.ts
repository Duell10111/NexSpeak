// Tray icon: the app keeps running there when the window is closed (like Discord), e.g. to stay
// in a call. Texts and voice state come from the web app; nothing here polls.
import { join } from "node:path"
import { app, ipcMain, Menu, nativeImage, Tray, type IpcMainEvent, type MenuItemConstructorOptions, type WebContents } from "electron"
import type { TrayCommand, TrayLabels, VoiceState } from "@nexspeak/core/desktop-bridge" with { "resolution-mode": "import" }
import { setAppMenu } from "./app-menu"
import { PRODUCT_NAME } from "./channel"

// Same names as in preload.ts.
const IPC_TRAY_LABELS = "nexspeak:tray-labels"
const IPC_VOICE_STATE = "nexspeak:voice-state"
const IPC_TRAY_COMMAND = "nexspeak:tray-command"

/** Until the web app sends its texts, right after its first render. */
const DEFAULT_LABELS: TrayLabels = {
  show: "Open NexSpeak",
  mute: "Mute",
  deafen: "Deafen",
  leaveCall: "Leave call",
  restartToUpdate: "Restart to update",
  checkForUpdates: "Check for updates…",
  updateUpToDate: "NexSpeak is up to date.",
  updateFound: "Update to version {version} found. It installs the next time NexSpeak restarts.",
  updateFailed: "Could not check for updates.",
  quit: "Quit NexSpeak",
}

function isTrayLabels(value: unknown): value is TrayLabels {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(DEFAULT_LABELS).every((key) => typeof (value as Record<string, unknown>)[key] === "string")
  )
}

function isVoiceState(value: unknown): value is VoiceState | null {
  if (value === null) return true
  const state = value as Record<string, unknown>
  return (
    typeof value === "object" &&
    typeof state.muted === "boolean" &&
    typeof state.deafened === "boolean" &&
    typeof state.inCall === "boolean"
  )
}

// Kept referenced, otherwise the tray icon disappears with garbage collection.
let tray: Tray | undefined
/** Set once an update is downloaded (updater.ts); offered in the menu outside calls. */
let installUpdate: (() => void) | null = null
let refreshMenu: (() => void) | undefined
let labels = DEFAULT_LABELS

/** The texts the web app sent last (also used by the app menu and update notifications). */
export function trayLabels(): TrayLabels {
  return labels
}

export function setTrayUpdate(install: (() => void) | null): void {
  installUpdate = install
  refreshMenu?.()
}

export function createTray({
  webContents,
  showWindow,
  checkForUpdates,
  onVoiceState,
}: {
  /** The app window's contents, if it exists. */
  webContents: () => WebContents | undefined
  showWindow: () => void
  checkForUpdates: () => void
  /** Every voice state the web app sends (null when logged out). */
  onVoiceState?: (state: VoiceState | null) => void
}): Tray {
  if (tray) return tray
  // macOS tints a black "Template" image for light and dark menu bars; @2x is picked automatically.
  const iconFile = process.platform === "darwin" ? "trayTemplate.png" : "tray.png"
  tray = new Tray(nativeImage.createFromPath(join(__dirname, "..", "assets", iconFile)))
  tray.setToolTip(PRODUCT_NAME)

  let voice: VoiceState | null = null

  const send = (command: TrayCommand) => webContents()?.send(IPC_TRAY_COMMAND, command)
  const fromAppWindow = (event: IpcMainEvent) => event.sender === webContents()

  const updateMenu = () => {
    if (!tray) return
    const items: MenuItemConstructorOptions[] = [{ label: labels.show, click: showWindow }, { type: "separator" }]
    if (voice) {
      items.push(
        { label: labels.mute, type: "checkbox", checked: voice.muted, click: () => send("toggle-mute") },
        { label: labels.deafen, type: "checkbox", checked: voice.deafened, click: () => send("toggle-deafen") },
      )
      if (voice.inCall) items.push({ label: labels.leaveCall, click: () => send("leave-call") })
      items.push({ type: "separator" })
    }
    if (installUpdate && !voice?.inCall) items.push({ label: labels.restartToUpdate, click: installUpdate })
    else items.push({ label: labels.checkForUpdates, click: checkForUpdates })
    items.push({ label: labels.quit, click: () => app.quit() })
    tray.setContextMenu(Menu.buildFromTemplate(items))
  }

  ipcMain.on(IPC_TRAY_LABELS, (event, next: unknown) => {
    if (!fromAppWindow(event) || !isTrayLabels(next)) return
    labels = next
    updateMenu()
    setAppMenu(labels, checkForUpdates)
  })
  ipcMain.on(IPC_VOICE_STATE, (event, next: unknown) => {
    if (!fromAppWindow(event) || !isVoiceState(next)) return
    voice = next
    updateMenu()
    onVoiceState?.(voice)
  })

  // Windows: a click opens the app, the menu is on right click. macOS and Linux always show the menu.
  if (process.platform === "win32") tray.on("click", showWindow)

  refreshMenu = updateMenu
  updateMenu()
  setAppMenu(labels, checkForUpdates)
  return tray
}
