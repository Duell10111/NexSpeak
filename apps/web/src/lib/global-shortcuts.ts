import { isCallShortcutBinding, type CallShortcutBinding } from "@nexspeak/core/global-shortcuts"

const NAMED_KEYS: Record<string, string> = {
  " ": "Space", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  "+": "Plus", "-": "Minus",
}

/** Use the printed key for Electron, while retaining the physical code for PTT conflicts. */
export function shortcutFromKeyboardEvent(event: Pick<KeyboardEvent, "code" | "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "getModifierState">): CallShortcutBinding | null {
  if (/^(Control|Alt|Shift|Meta)(Left|Right)$/.test(event.code) || event.getModifierState("AltGraph")) return null
  const key = NAMED_KEYS[event.key] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key)
  const modifiers = [event.ctrlKey && "Control", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Super"].filter(Boolean)
  const binding = { code: event.code, accelerator: [...modifiers, key].join("+") }
  return isCallShortcutBinding(binding) ? binding : null
}

export function shortcutLabel(binding: CallShortcutBinding, platform: string): string {
  return binding.accelerator.split("+").map((key) => key === "Super" ? platform === "darwin" ? "Cmd" : "Super" : key === "Control" ? "Ctrl" : key).join(" + ")
}
