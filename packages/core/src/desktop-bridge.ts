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

/** Tray menu texts; the main process has no translations, the web app sends them. */
export interface TrayLabels {
  show: string
  mute: string
  deafen: string
  leaveCall: string
  quit: string
}

/** Own voice state while logged in (mute/deafen also apply before joining, like Discord). */
export interface VoiceState {
  muted: boolean
  deafened: boolean
  inCall: boolean
}

export type TrayCommand = 'toggle-mute' | 'toggle-deafen' | 'leave-call'

export interface DesktopBridge {
  platform: 'darwin' | 'win32' | 'linux'
  /**
   * Called when the page asks for screen capture (getDisplayMedia) and the OS has no picker of
   * its own. Resolve with a source id, or null to cancel. Returns an unsubscribe function.
   */
  onChooseDisplaySource(handler: (sources: DisplaySource[]) => Promise<string | null>): () => void
  setTrayLabels(labels: TrayLabels): void
  /** null when logged out: the tray then only offers to show the window and to quit. */
  setVoiceState(state: VoiceState | null): void
  /** Tray menu actions for the web app. Returns an unsubscribe function. */
  onTrayCommand(handler: (command: TrayCommand) => void): () => void
}
