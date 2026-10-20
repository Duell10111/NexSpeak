import { isCallShortcutBinding, isModifierCode, type CallShortcutBinding } from "@nexspeak/core/global-shortcuts"

const NAMED_CODES: Record<string, string> = {
  ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
}

/**
 * Builds the accelerator from the physical key (`code`), because `key` is already changed by
 * Shift, Option or the layout (Option+M gives "µ", Shift+1 gives "!"). Only letters follow the
 * printed key outside macOS: Electron registers letters by layout on Windows and Linux, but by
 * US key position on macOS. The code is kept for PTT conflicts.
 */
export function shortcutFromKeyboardEvent(event: Pick<KeyboardEvent, "code" | "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "getModifierState">, platform: string): CallShortcutBinding | null {
  if (isModifierCode(event.code) || event.getModifierState("AltGraph")) return null
  const letter = /^Key([A-Z])$/.exec(event.code)?.[1]
  const key = letter
    ? platform !== "darwin" && /^[a-z]$/i.test(event.key) ? event.key.toUpperCase() : letter
    : /^Digit(\d)$/.exec(event.code)?.[1]
      ?? (/^Numpad\d$/.test(event.code) ? `num${event.code.slice(6)}` : undefined)
      ?? NAMED_CODES[event.code]
      ?? event.code
  const modifiers = [event.ctrlKey && "Control", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Super"].filter(Boolean)
  const binding = { code: event.code, accelerator: [...modifiers, key].join("+") }
  return isCallShortcutBinding(binding) ? binding : null
}

/** Letters are labelled as printed on the user's layout (`layout` from `navigator.keyboard`). */
export function shortcutLabel(binding: CallShortcutBinding, platform: string, layout?: ReadonlyMap<string, string>): string {
  const parts = binding.accelerator.split("+")
  const key = parts.pop()!
  const printed = /^Key[A-Z]$/.test(binding.code) ? layout?.get(binding.code)?.toUpperCase() : undefined
  const keyLabel = printed ?? (key.startsWith("num") ? `Num ${key.slice(3)}` : key)
  return [...parts.map((part) => part === "Super" ? platform === "darwin" ? "Cmd" : "Super" : part === "Control" ? "Ctrl" : part), keyLabel].join(" + ")
}
