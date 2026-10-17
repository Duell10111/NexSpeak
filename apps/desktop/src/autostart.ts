// "Start at login": macOS and Windows register a login item, Linux writes an XDG autostart entry.
// The state lives in the OS (login items, registry, ~/.config/autostart), so a user who removes
// the entry there also sees it off in the app. Autostarted runs open in the tray only.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { app, ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron"
import { LINUX_NAME, PRODUCT_NAME } from "./channel"

// Same names as in preload.ts.
const IPC_AUTOSTART_GET = "nexspeak:autostart-get"
const IPC_AUTOSTART_SET = "nexspeak:autostart-set"

/** Added to the login command (Windows, Linux), so the app knows it was autostarted. */
export const HIDDEN_ARG = "--hidden"

/** An unpackaged dev run would register the bare Electron binary. */
const isSupported = () => app.isPackaged

function linuxEntryPath() {
  const configDir = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(configDir, "autostart", `${LINUX_NAME}.desktop`)
}

/** The AppImage runs from a temporary mount; the login entry has to start the image file itself. */
function linuxExecutable() {
  return process.env.APPIMAGE ?? process.execPath
}

/** Desktop entry Exec values need quotes around paths with spaces and escaped specials. */
function quoteExec(path: string) {
  return `"${path.replace(/[\\"`$]/g, (char) => `\\${char}`)}"`
}

async function isEnabled(): Promise<boolean> {
  if (process.platform === "linux") {
    return readFile(linuxEntryPath(), "utf8").then(
      (entry) => !/^Hidden\s*=\s*true/m.test(entry),
      () => false,
    )
  }
  return app.getLoginItemSettings({ args: [HIDDEN_ARG] }).openAtLogin
}

async function setEnabled(enabled: boolean): Promise<void> {
  if (process.platform === "linux") {
    const path = linuxEntryPath()
    if (!enabled) return rm(path, { force: true })
    await mkdir(join(path, ".."), { recursive: true })
    await writeFile(
      path,
      [
        "[Desktop Entry]",
        "Type=Application",
        `Name=${PRODUCT_NAME}`,
        `Exec=${quoteExec(linuxExecutable())} ${HIDDEN_ARG}`,
        `Icon=${LINUX_NAME}`,
        "Terminal=false",
        "X-GNOME-Autostart-enabled=true",
        "",
      ].join("\n"),
    )
    return
  }
  // macOS ignores args (a login item cannot pass any) and reports wasOpenedAtLogin instead.
  app.setLoginItemSettings({ openAtLogin: enabled, args: [HIDDEN_ARG] })
}

/** Whether this run was started by the login item, so the window stays in the tray. */
export function wasOpenedAtLogin(): boolean {
  if (process.argv.includes(HIDDEN_ARG)) return true
  return process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAtLogin
}

export function setupAutostart(webContents: () => WebContents | undefined): void {
  const fromAppWindow = (event: IpcMainInvokeEvent) => event.sender === webContents()
  ipcMain.handle(IPC_AUTOSTART_GET, async (event) => {
    if (!fromAppWindow(event) || !isSupported()) return null
    return isEnabled()
  })
  ipcMain.handle(IPC_AUTOSTART_SET, async (event, enabled: unknown) => {
    if (!fromAppWindow(event) || !isSupported() || typeof enabled !== "boolean") return null
    await setEnabled(enabled)
    return isEnabled()
  })
}
