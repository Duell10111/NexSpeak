/**
 * Push-to-talk keys are stored as KeyboardEvent.code (the physical key, independent of the
 * keyboard layout) or as "Mouse3" (middle button), "Mouse4"/"Mouse5" (side buttons). The desktop
 * app maps the same names to its global hook (apps/desktop/src/push-to-talk.ts).
 */

/** MouseEvent.button → key name; left and right click are never push-to-talk keys. */
const MOUSE_BUTTONS: Record<number, string> = { 1: "Mouse3", 3: "Mouse4", 4: "Mouse5" }

export function keyFromKeyboardEvent(event: Pick<KeyboardEvent, "code">): string | null {
  return event.code || null
}

export function keyFromMouseEvent(event: Pick<MouseEvent, "button">): string | null {
  return MOUSE_BUTTONS[event.button] ?? null
}

/** Mouse button number for labels ("Mouse 4"), or null for keyboard keys. */
export function mouseButtonNumber(key: string): number | null {
  const match = /^Mouse(\d)$/.exec(key)
  return match ? Number(match[1]) : null
}

/**
 * A readable key name. `layout` is the browser's keyboard layout map (navigator.keyboard), so a
 * German keyboard shows "Z" for the key that US layouts call "Y".
 */
export function keyboardKeyLabel(code: string, layout?: ReadonlyMap<string, string>): string {
  const fromLayout = layout?.get(code)
  if (fromLayout && fromLayout.trim()) return fromLayout.toUpperCase()
  return code
    .replace(/^Key|^Digit/, "")
    .replace(/^Numpad/, "Num ")
    .replace(/^(Control|Shift|Alt|Meta)(Left|Right)$/, "$1 $2")
}

/** Typing in a text field must not trigger the browser-side push-to-talk. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT"
}
