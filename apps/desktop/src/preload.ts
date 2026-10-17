// Runs sandboxed before the web app and exposes `window.nexspeak` (see DesktopBridge in
// packages/core/src/desktop-bridge.ts). A sandboxed preload can only require "electron", so this
// file has no other runtime imports.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"
import type { DesktopBridge, DisplaySource, TrayCommand } from "@nexspeak/core/desktop-bridge" with { "resolution-mode": "import" }

// Same names as in main.ts.
const IPC_CHOOSE_DISPLAY_SOURCE = "nexspeak:choose-display-source"
const IPC_DISPLAY_SOURCE_CHOSEN = "nexspeak:display-source-chosen"
const IPC_TRAY_LABELS = "nexspeak:tray-labels"
const IPC_VOICE_STATE = "nexspeak:voice-state"
const IPC_TRAY_COMMAND = "nexspeak:tray-command"
const IPC_PTT_SET_KEY = "nexspeak:ptt-set-key"
const IPC_PTT_STATUS = "nexspeak:ptt-status"
const IPC_PTT_REQUEST_PERMISSION = "nexspeak:ptt-request-permission"
const IPC_PTT_PRESSED = "nexspeak:ptt-pressed"
const IPC_SHOW_WINDOW = "nexspeak:show-window"
const IPC_BADGE_COUNT = "nexspeak:badge-count"
const IPC_DEEP_LINK = "nexspeak:deep-link"
const IPC_DEEP_LINKS_READY = "nexspeak:deep-links-ready"
const IPC_AUTOSTART_GET = "nexspeak:autostart-get"
const IPC_AUTOSTART_SET = "nexspeak:autostart-set"
const IPC_UPDATE_READY = "nexspeak:update-ready"
const IPC_UPDATE_GET = "nexspeak:update-get"
const IPC_UPDATE_INSTALL = "nexspeak:update-install"

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
  setTrayLabels(labels) {
    ipcRenderer.send(IPC_TRAY_LABELS, labels)
  },
  setVoiceState(state) {
    ipcRenderer.send(IPC_VOICE_STATE, state)
  },
  onTrayCommand(handler) {
    const listener = (_event: IpcRendererEvent, command: TrayCommand) => handler(command)
    ipcRenderer.on(IPC_TRAY_COMMAND, listener)
    return () => {
      ipcRenderer.off(IPC_TRAY_COMMAND, listener)
    }
  },
  setPushToTalkKey(key) {
    return ipcRenderer.invoke(IPC_PTT_SET_KEY, key)
  },
  getPushToTalkStatus() {
    return ipcRenderer.invoke(IPC_PTT_STATUS)
  },
  requestPushToTalkPermission() {
    return ipcRenderer.invoke(IPC_PTT_REQUEST_PERMISSION)
  },
  onPushToTalk(handler) {
    const listener = (_event: IpcRendererEvent, pressed: boolean) => handler(pressed)
    ipcRenderer.on(IPC_PTT_PRESSED, listener)
    return () => {
      ipcRenderer.off(IPC_PTT_PRESSED, listener)
    }
  },
  showWindow() {
    ipcRenderer.send(IPC_SHOW_WINDOW)
  },
  setBadgeCount(count) {
    ipcRenderer.send(IPC_BADGE_COUNT, count)
  },
  onDeepLink(handler) {
    const listener = (_event: IpcRendererEvent, url: string) => handler(url)
    ipcRenderer.on(IPC_DEEP_LINK, listener)
    // Links that arrived before (e.g. the one that started the app) are delivered now.
    ipcRenderer.send(IPC_DEEP_LINKS_READY, true)
    return () => {
      ipcRenderer.send(IPC_DEEP_LINKS_READY, false)
      ipcRenderer.off(IPC_DEEP_LINK, listener)
    }
  },
  getAutostart() {
    return ipcRenderer.invoke(IPC_AUTOSTART_GET)
  },
  setAutostart(enabled) {
    return ipcRenderer.invoke(IPC_AUTOSTART_SET, enabled)
  },
  onUpdateReady(handler) {
    const listener = (_event: IpcRendererEvent, version: string) => handler(version)
    ipcRenderer.on(IPC_UPDATE_READY, listener)
    // An update downloaded before the page subscribed (e.g. before a reload).
    void ipcRenderer.invoke(IPC_UPDATE_GET).then((version: string | null) => {
      if (version) handler(version)
    })
    return () => {
      ipcRenderer.off(IPC_UPDATE_READY, listener)
    }
  },
  installUpdate() {
    ipcRenderer.send(IPC_UPDATE_INSTALL)
  },
}

contextBridge.exposeInMainWorld("nexspeak", bridge)
