import type { DesktopBridge } from "@nexspeak/core/desktop-bridge"

declare global {
  interface Window {
    /** Set by the desktop app's preload script (apps/desktop/src/preload.ts). */
    nexspeak?: DesktopBridge
  }
}

/** The desktop app's bridge, or undefined in the browser. */
export function desktopBridge(): DesktopBridge | undefined {
  return typeof window === "undefined" ? undefined : window.nexspeak
}
