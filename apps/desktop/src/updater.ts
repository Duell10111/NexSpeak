// Auto-update from GitHub Releases (electron-updater, `publish` in electron-builder.cjs; nightly builds
// update from the NexSpeak-nightly repository).
// Checks once shortly after the start and then only when the window gets the focus again after a
// few hours: no timer while the app sits in the tray. Nothing downloads or installs during a call;
// the download waits until the call ends, the install until the user restarts or quits.
// "Check for updates" (Settings → About, tray and app menu) checks right away and resets the interval.
// macOS only accepts updates with a Developer ID signature; ad-hoc signed builds fail there.
import { app, ipcMain, Notification, type IpcMainEvent, type WebContents } from "electron"
import { autoUpdater } from "electron-updater"
import type { TrayLabels, UpdateError, UpdateStatus } from "@nexspeak/core/desktop-bridge" with { "resolution-mode": "import" }
import { PRODUCT_NAME } from "./channel"

// Same names as in preload.ts.
const IPC_UPDATE_STATUS = "nexspeak:update-status"
const IPC_UPDATE_STATUS_GET = "nexspeak:update-status-get"
const IPC_UPDATE_CHECK = "nexspeak:update-check"
const IPC_UPDATE_INSTALL = "nexspeak:update-install"
const IPC_SHOW_UPDATES = "nexspeak:show-updates"
const IPC_SHOW_UPDATES_READY = "nexspeak:show-updates-ready"

const FIRST_CHECK_DELAY_MS = 30_000
const RECHECK_AFTER_MS = 6 * 60 * 60 * 1000
const MAX_ERROR_MESSAGE_LENGTH = 200

let inCall = false
let lastCheck = 0
let availableVersion: string | null = null
let readyVersion: string | null = null
let downloading = false
let status: UpdateStatus = { state: "idle" }
let sendStatus: ((status: UpdateStatus) => void) | undefined
/** A menu check while the web app cannot show the About tab: its result becomes a notification. */
let notifyResult = false
let notificationLabels: (() => TrayLabels) | undefined

function setStatus(next: UpdateStatus) {
  status = next
  sendStatus?.(next)
  if (notifyResult && next.state !== "checking" && next.state !== "idle") {
    notifyResult = false
    notify(next)
  }
}

function notify(result: UpdateStatus) {
  const labels = notificationLabels?.()
  if (!labels || !Notification.isSupported()) return
  const body =
    result.state === "up-to-date"
      ? labels.updateUpToDate
      : result.state === "error"
        ? labels.updateFailed
        : "version" in result
          ? labels.updateFound.replace("{version}", result.version)
          : null
  if (body) new Notification({ title: PRODUCT_NAME, body }).show()
}

/** Short reason for the UI; electron-updater only has messages (with whole HTTP responses). */
function classifyError(error: unknown): { error: UpdateError; message?: string } {
  const message = error instanceof Error ? error.message : String(error)
  if (/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_TIMED_OUT|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN/.test(message)) {
    return { error: "offline" }
  }
  if (process.platform === "darwin" && /code ?sign|signature/i.test(message)) return { error: "unsigned" }
  return { error: "failed", message: message.split("\n")[0].slice(0, MAX_ERROR_MESSAGE_LENGTH) }
}

function check() {
  // No new check while an update downloads or waits for the restart.
  if (downloading || readyVersion) return
  lastCheck = Date.now()
  // A dev run has no app-update.yml; Linux updates only work for the AppImage and the deb.
  if (!app.isPackaged) return setStatus({ state: "error", error: "unsupported" })
  setStatus({ state: "checking" })
  autoUpdater
    .checkForUpdates()
    // null: the updater is not active for this installation (e.g. a Linux package without updates).
    .then((result) => {
      if (!result) setStatus({ state: "error", error: "unsupported" })
    })
    // Failures arrive as "error" events as well.
    .catch(() => {})
}

function download() {
  if (!availableVersion || availableVersion === readyVersion || downloading) return
  if (inCall) return setStatus({ state: "waiting-for-call", version: availableVersion })
  downloading = true
  setStatus({ state: "downloading", version: availableVersion, percent: 0 })
  autoUpdater
    .downloadUpdate()
    .catch(() => {})
    .finally(() => {
      downloading = false
    })
}

/** From the voice state: downloads are held back while the user is in a call. */
export function setUpdaterInCall(next: boolean): void {
  if (inCall === next) return
  inCall = next
  if (!inCall) download()
}

export function setupUpdater({
  webContents,
  showWindow,
  labels,
  prepareQuit,
  onReady,
}: {
  webContents: () => WebContents | undefined
  showWindow: () => void
  /** Current menu texts (tray.ts), for the notifications. */
  labels: () => TrayLabels
  /** Lets the window close for real (it otherwise only hides into the tray). */
  prepareQuit: () => void
  /** An update is downloaded; `install` restarts into it (ignored during a call). */
  onReady: (install: () => void) => void
}): {
  /** "Check for updates…" in the tray and app menu. */
  checkFromMenu: () => void
} {
  notificationLabels = labels
  sendStatus = (next) => webContents()?.send(IPC_UPDATE_STATUS, next)
  /** The web app's "show updates" listener (Settings → About), while it has one. */
  let showUpdatesIn: WebContents | null = null

  const install = () => {
    if (!readyVersion || inCall) return
    prepareQuit()
    // Silent on Windows (one-click NSIS), and start the new version afterwards.
    autoUpdater.quitAndInstall(true, true)
  }
  const fromAppWindow = (event: IpcMainEvent) => event.sender === webContents()
  ipcMain.handle(IPC_UPDATE_STATUS_GET, (event) => (event.sender === webContents() ? status : null))
  ipcMain.on(IPC_UPDATE_CHECK, (event) => {
    if (fromAppWindow(event)) check()
  })
  ipcMain.on(IPC_UPDATE_INSTALL, (event) => {
    if (fromAppWindow(event)) install()
  })
  ipcMain.on(IPC_SHOW_UPDATES_READY, (event, ready: unknown) => {
    if (!fromAppWindow(event)) return
    if (ready === true) showUpdatesIn = event.sender
    else if (showUpdatesIn === event.sender) showUpdatesIn = null
  })
  // A reload drops the web app's listener without unsubscribing.
  app.on("web-contents-created", (_event, contents) => {
    contents.on("did-start-navigation", (details) => {
      if (details.isMainFrame && !details.isSameDocument && contents === showUpdatesIn) showUpdatesIn = null
    })
  })

  const checkFromMenu = () => {
    if (showUpdatesIn && !showUpdatesIn.isDestroyed()) {
      showWindow()
      showUpdatesIn.send(IPC_SHOW_UPDATES)
    } else {
      notifyResult = true
      // Already known: nothing new to check.
      if (readyVersion || downloading) return setStatus(status)
    }
    check()
  }

  if (app.isPackaged) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on("update-available", (info) => {
      availableVersion = info.version
      download()
    })
    autoUpdater.on("update-not-available", () => setStatus({ state: "up-to-date" }))
    // electron-updater sends progress at most about once per second.
    autoUpdater.on("download-progress", (progress) => {
      if (availableVersion) setStatus({ state: "downloading", version: availableVersion, percent: Math.floor(progress.percent) })
    })
    autoUpdater.on("update-downloaded", (info) => {
      readyVersion = info.version
      setStatus({ state: "ready", version: info.version })
      onReady(install)
    })
    autoUpdater.on("error", (error) => {
      console.warn("Auto-update failed", error)
      setStatus({ state: "error", ...classifyError(error) })
    })

    setTimeout(check, FIRST_CHECK_DELAY_MS)
    app.on("browser-window-focus", () => {
      if (Date.now() - lastCheck > RECHECK_AFTER_MS) check()
    })
  }

  return { checkFromMenu }
}
