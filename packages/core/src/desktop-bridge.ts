/**
 * What the desktop app (apps/desktop/src/preload.ts) exposes to the web app as `window.nexspeak`.
 * Absent in the browser; every desktop feature must check for it.
 */

export interface DisplaySource {
  id: string
  name: string
  kind: 'screen' | 'window'
  /** PNG data URL, small preview */
  thumbnail: string
}

export interface DesktopBridge {
  platform: 'darwin' | 'win32' | 'linux'
  /**
   * Called when the page asks for screen capture (getDisplayMedia) and the OS has no picker of
   * its own. Resolve with a source id, or null to cancel. Returns an unsubscribe function.
   */
  onChooseDisplaySource(handler: (sources: DisplaySource[]) => Promise<string | null>): () => void
}
