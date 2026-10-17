// Runs sandboxed before the web app and exposes `window.nexspeak` (see DesktopBridge in
// packages/core/src/desktop-bridge.ts). A sandboxed preload can only require "electron", so this
// file has no other runtime imports.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"
import type { DesktopBridge, DisplaySource } from "@nexspeak/core/desktop-bridge" with { "resolution-mode": "import" }

// Same names as in main.ts.
const IPC_CHOOSE_DISPLAY_SOURCE = "nexspeak:choose-display-source"
const IPC_DISPLAY_SOURCE_CHOSEN = "nexspeak:display-source-chosen"

const bridge: DesktopBridge = {
  platform: process.platform as DesktopBridge["platform"],
  onChooseDisplaySource(handler) {
    const listener = async (_event: IpcRendererEvent, requestId: number, sources: DisplaySource[]) => {
      const sourceId = await handler(sources).catch(() => null)
      ipcRenderer.send(IPC_DISPLAY_SOURCE_CHOSEN, requestId, sourceId)
    }
    ipcRenderer.on(IPC_CHOOSE_DISPLAY_SOURCE, listener)
    return () => {
      ipcRenderer.off(IPC_CHOOSE_DISPLAY_SOURCE, listener)
    }
  },
}

contextBridge.exposeInMainWorld("nexspeak", bridge)
