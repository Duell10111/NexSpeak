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

/**
 * Texts of the tray menu, the macOS app menu and the update notifications; the main process has no
 * translations, the web app sends them. "{version}" is replaced in the main process.
 */
export interface TrayLabels {
  show: string
  mute: string
  deafen: string
  leaveCall: string
  /** Shown once a downloaded update waits, outside calls. */
  restartToUpdate: string
  checkForUpdates: string
  /** Notifications after "Check for updates…" from a menu while no About tab can open (logged out). */
  updateUpToDate: string
  updateFound: string
  updateFailed: string
  quit: string
}

/** Own voice state while logged in (mute/deafen also apply before joining, like Discord). */
export interface VoiceState {
  muted: boolean
  deafened: boolean
  inCall: boolean
}

export type TrayCommand = 'toggle-mute' | 'toggle-deafen' | 'leave-call'

/**
 * Whether the global push-to-talk key works while other apps (games) have the focus:
 * 'permission-required' on macOS until the accessibility permission is granted,
 * 'unsupported' where no global hook exists (Wayland).
 */
export type PushToTalkStatus = 'active' | 'permission-required' | 'unsupported'

/**
 * Why an update check or download failed: 'offline' (no network), 'unsigned' (macOS only accepts
 * updates for builds with a Developer ID signature), 'unsupported' (dev run, or a Linux package
 * without auto-update), 'failed' (anything else, `message` has the first line).
 */
export type UpdateError = 'offline' | 'unsigned' | 'unsupported' | 'failed'

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up-to-date' }
  /** Found during a call; downloads only start after it. */
  | { state: 'waiting-for-call'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; error: UpdateError; message?: string }

export interface DesktopBridge {
  platform: 'darwin' | 'win32' | 'linux'
  /** System audio capture is available on Windows and macOS 13+. */
  supportsSystemAudio: boolean
  /** Version of the desktop app (may differ from the web build's). */
  appVersion: string
  channel: 'stable' | 'nightly'
  /** Scheme of the app's deep links without ":": "nexspeak", or "nexspeak-nightly" in nightly builds. */
  deepLinkScheme: string
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
  /**
   * Listens for the push-to-talk key system-wide (a KeyboardEvent.code such as "KeyV", or
   * "Mouse3"–"Mouse5"); null stops listening. Only set while in a call: the hook sees every input.
   */
  setPushToTalkKey(key: string | null): Promise<PushToTalkStatus>
  getPushToTalkStatus(): Promise<PushToTalkStatus>
  /** macOS: asks for the accessibility permission that the global key needs. */
  requestPushToTalkPermission(): Promise<PushToTalkStatus>
  /** Key pressed (true) or released (false). Returns an unsubscribe function. */
  onPushToTalk(handler: (pressed: boolean) => void): () => void
  /** Brings the window back from the tray, e.g. after a click on a notification. */
  showWindow(): void
  /** Dock badge (macOS), taskbar overlay (Windows), launcher count (Linux); 0 clears it. */
  setBadgeCount(count: number): void
  /**
   * Deep links (deepLinkScheme) opened from the OS (browser, other apps), including links that
   * started the app. Parse them with parseMatrixLink. Returns an unsubscribe function.
   */
  onDeepLink(handler: (url: string) => void): () => void
  /** Whether the app starts (into the tray) at login; null where it is not possible (dev run). */
  getAutostart(): Promise<boolean | null>
  /** Resolves with the new state, or null where autostart is not possible. */
  setAutostart(enabled: boolean): Promise<boolean | null>
  /**
   * Update check and download progress; also called right away with the current status.
   * Returns an unsubscribe function.
   */
  onUpdateStatus(handler: (status: UpdateStatus) => void): () => void
  /** Checks right away (resets the automatic interval); the result arrives via onUpdateStatus. */
  checkForUpdates(): void
  /**
   * "Check for updates…" in the tray or app menu: the handler shows the update status (Settings →
   * About). Without a handler the main process shows a notification instead. Returns an
   * unsubscribe function.
   */
  onShowUpdates(handler: () => void): () => void
  /** Restarts into the downloaded update; ignored during a call. */
  installUpdate(): void
}
