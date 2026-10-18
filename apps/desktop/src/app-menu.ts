// macOS app menu: Electron's default menu plus "Check for updates…" under the app name. Windows and
// Linux hide the menu bar (autoHideMenuBar); the tray menu has the entry there.
import { Menu } from "electron"
import type { TrayLabels } from "@nexspeak/core/desktop-bridge" with { "resolution-mode": "import" }

export function setAppMenu(labels: TrayLabels, checkForUpdates: () => void): void {
  if (process.platform !== "darwin") return
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        role: "appMenu",
        submenu: [
          { role: "about" },
          { label: labels.checkForUpdates, click: checkForUpdates },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "fileMenu" },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  )
}
