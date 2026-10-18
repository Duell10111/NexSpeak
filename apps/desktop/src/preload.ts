// Runs sandboxed before the web app and exposes `window.nexspeak` (see DesktopBridge in
// packages/core/src/desktop-bridge.ts). A sandboxed preload can only require "electron", so this
// file has no other runtime imports.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"
import type { DesktopBridge, DisplaySource, TrayCommand, UpdateStatus } from "@nexspeak/core/desktop-bridge" with { "resolution-mode": "import" }

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
const IPC_UPDATE_STATUS = "nexspeak:update-status"
const IPC_UPDATE_STATUS_GET = "nexspeak:update-status-get"
const IPC_UPDATE_CHECK = "nexspeak:update-check"
const IPC_UPDATE_INSTALL = "nexspeak:update-install"
const IPC_SHOW_UPDATES = "nexspeak:show-updates"
const IPC_SHOW_UPDATES_READY = "nexspeak:show-updates-ready"

// Passed by main.ts as additional arguments (see src/channel.ts).
const DEEP_LINK_SCHEME_ARG = "--nexspeak-deep-link-scheme="
const APP_VERSION_ARG = "--nexspeak-app-version="
const CHANNEL_ARG = "--nexspeak-channel="

function argument(prefix: string): string | undefined {
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length)
}

const bridge: DesktopBridge = {
  platform: process.platform as DesktopBridge["platform"],
  appVersion: argument(APP_VERSION_ARG) ?? "",
  channel: argument(CHANNEL_ARG) === "nightly" ? "nightly" : "stable",
  deepLinkScheme: argument(DEEP_LINK_SCHEME_ARG) ?? "nexspeak",
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
  onUpdateStatus(handler) {
    const listener = (_event: IpcRendererEvent, status: UpdateStatus) => handler(status)
    ipcRenderer.on(IPC_UPDATE_STATUS, listener)
    // The status from before the page subscribed (e.g. an update downloaded before a reload).
    void ipcRenderer.invoke(IPC_UPDATE_STATUS_GET).then((status: UpdateStatus | null) => {
      if (status) handler(status)
    })
    return () => {
      ipcRenderer.off(IPC_UPDATE_STATUS, listener)
    }
  },
  checkForUpdates() {
    ipcRenderer.send(IPC_UPDATE_CHECK)
  },
  onShowUpdates(handler) {
    const listener = () => handler()
    ipcRenderer.on(IPC_SHOW_UPDATES, listener)
    ipcRenderer.send(IPC_SHOW_UPDATES_READY, true)
    return () => {
      ipcRenderer.send(IPC_SHOW_UPDATES_READY, false)
      ipcRenderer.off(IPC_SHOW_UPDATES, listener)
    }
  },
  installUpdate() {
    ipcRenderer.send(IPC_UPDATE_INSTALL)
  },
}

contextBridge.exposeInMainWorld("nexspeak", bridge)
