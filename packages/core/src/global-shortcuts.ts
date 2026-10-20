/** Global call shortcuts use Electron accelerators, plus the physical code for PTT conflicts. */
export const CALL_SHORTCUT_ACTIONS = ["toggle-mute", "toggle-deafen", "leave-call", "stop-screen-share"] as const
export type CallShortcutAction = (typeof CALL_SHORTCUT_ACTIONS)[number]
export interface CallShortcutBinding {
  code: string
  accelerator: string
}
export type CallShortcutBindings = Record<CallShortcutAction, CallShortcutBinding | null>
export type CallShortcutStatus = "inactive" | "active" | "unavailable" | "conflict"
export type CallShortcutStatuses = Record<CallShortcutAction, CallShortcutStatus>

export function emptyCallShortcutBindings(): CallShortcutBindings {
  return { "toggle-mute": null, "toggle-deafen": null, "leave-call": null, "stop-screen-share": null }
}

const MODIFIERS = ["Control", "Alt", "Shift", "Super"]
// No punctuation: Electron maps it to US key positions, which differ from the printed key on other layouts.
// Keep in sync with apps/desktop/src/global-shortcuts.ts (a parity test there checks it).
const KEY = /^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|num[0-9]|Space|Tab|Enter|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right)$/
const FUNCTION_KEY = /^F\d+$/

/** Physical modifier keys as reported by `KeyboardEvent.code`. */
export function isModifierCode(code: string): boolean {
  return /^(Control|Alt|Shift|Meta)(Left|Right)$/.test(code)
}

/**
 * A small, canonical subset of accelerators: no aliases that could bypass duplicate detection.
 * Except for function keys, a binding needs Control, Alt or Super: a global key is taken from every
 * other app during a call, so a plain letter (or Shift+letter) would break typing everywhere.
 */
export function isCallShortcutBinding(value: unknown): value is CallShortcutBinding {
  if (!value || typeof value !== "object") return false
  const { code, accelerator } = value as CallShortcutBinding
  if (typeof code !== "string" || !/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(code) || typeof accelerator !== "string") return false
  const parts = accelerator.split("+")
  const key = parts.pop()!
  return KEY.test(key)
    && parts.every((part, index) => MODIFIERS.includes(part) && (index === 0 || MODIFIERS.indexOf(parts[index - 1]) < MODIFIERS.indexOf(part)))
    && (FUNCTION_KEY.test(key) || parts.some((part) => part !== "Shift"))
}

export function parseCallShortcutBindings(value: unknown): CallShortcutBindings {
  const bindings = emptyCallShortcutBindings()
  if (!value || typeof value !== "object") return bindings
  for (const action of CALL_SHORTCUT_ACTIONS) {
    const binding = (value as Record<string, unknown>)[action]
    if (isCallShortcutBinding(binding)) bindings[action] = { code: binding.code, accelerator: binding.accelerator }
  }
  return bindings
}

/** PTT reacts to its physical key even with modifiers, so all overlapping combinations conflict. */
export function conflictsWithPushToTalk(binding: CallShortcutBinding, pttKey: string | null): boolean {
  if (!pttKey) return false
  if (binding.code === pttKey) return true
  if (!isModifierCode(pttKey)) return false
  const modifier = pttKey.replace(/(Left|Right)$/, "")
  return Boolean(binding.accelerator.split("+").slice(0, -1).includes(modifier === "Meta" ? "Super" : modifier))
}

export function callShortcutConflict(bindings: CallShortcutBindings, action: CallShortcutAction, binding: CallShortcutBinding, pttKey: string | null): boolean {
  return conflictsWithPushToTalk(binding, pttKey) || CALL_SHORTCUT_ACTIONS.some((other) => other !== action && bindings[other]?.accelerator === binding.accelerator)
}
