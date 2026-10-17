// Auto-update from GitHub Releases (electron-updater, `publish` in electron-builder.yml).
// Checks once shortly after the start and then only when the window gets the focus again after a
// few hours: no timer while the app sits in the tray. Nothing downloads or installs during a call;
// the download waits until the call ends, the install until the user restarts or quits.
// macOS only accepts updates with a Developer ID signature; ad-hoc signed builds fail there.
import { app, ipcMain, type IpcMainEvent, type WebContents } from "electron"
import { autoUpdater } from "electron-updater"

// Same names as in preload.ts.
const IPC_UPDATE_READY = "nexspeak:update-ready"
const IPC_UPDATE_GET = "nexspeak:update-get"
const IPC_UPDATE_INSTALL = "nexspeak:update-install"

const FIRST_CHECK_DELAY_MS = 30_000
const RECHECK_AFTER_MS = 6 * 60 * 60 * 1000

let inCall = false
let lastCheck = 0
let availableVersion: string | null = null
let readyVersion: string | null = null
let downloading = false

function check() {
  lastCheck = Date.now()
  // Failures arrive as "error" events as well.
  autoUpdater.checkForUpdates().catch(() => {})
}

function download() {
  if (!availableVersion || availableVersion === readyVersion || downloading || inCall) return
  downloading = true
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
  prepareQuit,
  onReady,
}: {
  webContents: () => WebContents | undefined
  /** Lets the window close for real (it otherwise only hides into the tray). */
  prepareQuit: () => void
  /** An update is downloaded; `install` restarts into it (ignored during a call). */
  onReady: (install: () => void) => void
}): void {
  const install = () => {
    if (!readyVersion || inCall) return
    prepareQuit()
    // Silent on Windows (one-click NSIS), and start the new version afterwards.
    autoUpdater.quitAndInstall(true, true)
  }
  const fromAppWindow = (event: IpcMainEvent) => event.sender === webContents()
  ipcMain.handle(IPC_UPDATE_GET, (event) => (event.sender === webContents() ? readyVersion : null))
  ipcMain.on(IPC_UPDATE_INSTALL, (event) => {
    if (fromAppWindow(event)) install()
  })

  // A dev run has no app-update.yml; Linux updates only work for the AppImage and the deb.
  if (!app.isPackaged) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on("update-available", (info) => {
    availableVersion = info.version
    download()
  })
  autoUpdater.on("update-downloaded", (info) => {
    readyVersion = info.version
    webContents()?.send(IPC_UPDATE_READY, readyVersion)
    onReady(install)
  })
  autoUpdater.on("error", (error) => console.warn("Auto-update failed", error))

  setTimeout(check, FIRST_CHECK_DELAY_MS)
  app.on("browser-window-focus", () => {
    if (!readyVersion && Date.now() - lastCheck > RECHECK_AFTER_MS) check()
  })
}
