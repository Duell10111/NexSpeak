import { globalShortcut, ipcMain, type WebContents } from "electron"
import type { CallShortcutAction, CallShortcutBinding, CallShortcutBindings, CallShortcutStatuses } from "@nexspeak/core/global-shortcuts" with { "resolution-mode": "import" }

// The shell only imports core types: its packaged CommonJS build cannot load core's TS sources.
// The rules below mirror packages/core/src/global-shortcuts.ts; global-shortcuts.test.ts checks parity.
const ACTIONS: CallShortcutAction[] = ["toggle-mute", "toggle-deafen", "leave-call", "stop-screen-share"]
const emptyBindings = (): CallShortcutBindings => ({ "toggle-mute": null, "toggle-deafen": null, "leave-call": null, "stop-screen-share": null })

const ACCELERATOR = /^(Control\+)?(Alt\+)?(Shift\+)?(Super\+)?(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|num[0-9]|Space|Tab|Enter|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right)$/
/** Function keys may stand alone; anything else needs Control, Alt or Super (not just Shift). */
const STANDALONE_OR_MODIFIED = /^(?:(?:Shift\+)?F\d+|.*\b(?:Control|Alt|Super)\+.+)$/
/** Holding a combination auto-repeats on Windows and X11; repeats arrive well within this window. */
export const REPEAT_WINDOW_MS = 750

/** Validate IPC separately from the UI, including canonical modifier order and supported keys. */
export function parseBindings(value: unknown): CallShortcutBindings {
  const result = emptyBindings()
  if (!value || typeof value !== "object") return result
  for (const action of ACTIONS) {
    const binding = (value as Record<string, unknown>)[action] as CallShortcutBinding | undefined
    if (!binding || typeof binding.code !== "string" || !/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(binding.code)) continue
    if (typeof binding.accelerator !== "string" || !ACCELERATOR.test(binding.accelerator) || !STANDALONE_OR_MODIFIED.test(binding.accelerator)) continue
    result[action] = { code: binding.code, accelerator: binding.accelerator }
  }
  return result
}

export function hasConflict(bindings: CallShortcutBindings, action: CallShortcutAction, binding: CallShortcutBinding, pttKey: string | null): boolean {
  if (binding.code === pttKey) return true
  const modifier = /^(Control|Alt|Shift|Meta)(Left|Right)$/.exec(pttKey ?? "")?.[1]
  if (modifier && binding.accelerator.split("+").slice(0, -1).includes(modifier === "Meta" ? "Super" : modifier)) return true
  return ACTIONS.some((other) => other !== action && bindings[other]?.accelerator === binding.accelerator)
}

/** Native accelerators only: no full input hook, polling, or registrations outside calls. */
export function setupGlobalShortcuts(webContents: () => WebContents | undefined) {
  let bindings = emptyBindings()
  let pushToTalkKey: string | null = null
  let inCall = false
  let suspended = false
  const registered = new Map<CallShortcutAction, string>()
  const lastPressed = new Map<CallShortcutAction, number>()
  let statuses: CallShortcutStatuses = { "toggle-mute": "inactive", "toggle-deafen": "inactive", "leave-call": "inactive", "stop-screen-share": "inactive" }
  const send = (channel: string, value: unknown) => {
    const contents = webContents()
    if (contents && !contents.isDestroyed()) contents.send(channel, value)
  }

  const unregister = () => {
    for (const accelerator of registered.values()) globalShortcut.unregister(accelerator)
    registered.clear()
  }

  const update = () => {
    const next: CallShortcutStatuses = { ...statuses }
    for (const action of ACTIONS) {
      const binding = bindings[action]
      const conflict = binding && hasConflict(bindings, action, binding, pushToTalkKey)
      const accelerator = inCall && !suspended && !conflict ? binding?.accelerator : undefined
      const previous = registered.get(action)
      if (previous && previous !== accelerator) {
        globalShortcut.unregister(previous)
        registered.delete(action)
      }
      if (accelerator && !registered.has(action)) {
        try {
          if (globalShortcut.register(accelerator, () => {
            if (!inCall || suspended || registered.get(action) !== accelerator) return
            // Electron reports no key release, so a press within the window of the previous one
            // (including ignored repeats) counts as the same held key: a toggle must not flap.
            const now = performance.now()
            const last = lastPressed.get(action)
            lastPressed.set(action, now)
            if (last === undefined || now - last >= REPEAT_WINDOW_MS) send("nexspeak:call-shortcut", action)
          })) registered.set(action, accelerator)
        } catch {
          // Unsupported/reserved keys fail without taking down the app.
        }
      }
      next[action] = conflict ? "conflict" : !accelerator ? "inactive" : registered.has(action) ? "active" : "unavailable"
    }
    statuses = next
    send("nexspeak:call-shortcut-status", statuses)
  }

  const fromAppWindow = (event: { sender: WebContents }) => event.sender === webContents()
  ipcMain.handle("nexspeak:call-shortcuts-set", (event, value: unknown, pttKey: unknown) => {
    if (!fromAppWindow(event)) return
    const next = parseBindings(value)
    const nextPttKey = typeof pttKey === "string" ? pttKey : null
    const unchanged = pushToTalkKey === nextPttKey && ACTIONS.every((action) => bindings[action]?.accelerator === next[action]?.accelerator && bindings[action]?.code === next[action]?.code)
    // Unregister the old set before registering the new one, including swapped bindings.
    if (!unchanged) unregister()
    bindings = next
    pushToTalkKey = nextPttKey
    update()
  })
  ipcMain.on("nexspeak:call-shortcuts-suspended", (event, value: unknown) => {
    if (!fromAppWindow(event) || typeof value !== "boolean") return
    if (suspended === value) return
    suspended = value
    update()
  })
  ipcMain.handle("nexspeak:call-shortcut-status-get", (event) => fromAppWindow(event) ? statuses : null)

  return {
    setInCall(value: boolean) {
      if (inCall === value) return
      inCall = value
      update()
    },
    /** Reload, renderer crash, logout or quit must release all OS keys. */
    reset() {
      unregister()
      bindings = emptyBindings()
      pushToTalkKey = null
      inCall = false
      suspended = false
      update()
    },
  }
}
