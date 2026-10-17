// Unread badge: dock count on macOS, launcher count on Linux (Unity API), red overlay dot on the
// Windows taskbar. The count comes from the web app whenever it changes.
import { join } from "node:path"
import { app, nativeImage, type BrowserWindow } from "electron"

let overlay: Electron.NativeImage | undefined

export function setBadgeCount(window: BrowserWindow | undefined, count: number): void {
  if (process.platform === "win32") {
    if (!window || window.isDestroyed()) return
    overlay ??= nativeImage.createFromPath(join(__dirname, "..", "assets", "badge.png"))
    window.setOverlayIcon(count > 0 ? overlay : null, count > 0 ? String(count) : "")
    return
  }
  app.setBadgeCount(count)
}
