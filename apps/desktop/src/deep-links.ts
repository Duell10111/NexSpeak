// nexspeak:// links (nexspeak-nightly:// in nightly builds) from the OS: macOS delivers them as "open-url" (also on a cold start, before
// "ready"), Windows and Linux start a second instance with the link in its arguments. Links wait
// here until the web app listens, then go to it unparsed; parsing lives in packages/core.
import { app, ipcMain, type WebContents } from "electron"
import { DEEP_LINK_SCHEME as SCHEME } from "./channel"

// Same names as in preload.ts.
const IPC_DEEP_LINK = "nexspeak:deep-link"
const IPC_DEEP_LINKS_READY = "nexspeak:deep-links-ready"

const MAX_LINK_LENGTH = 4096

const pending: string[] = []
let deliverTo: WebContents | null = null
let onLink: (() => void) | null = null

export function findDeepLink(argv: readonly string[]): string | undefined {
  return argv.find((argument) => argument.startsWith(`${SCHEME}://`) && argument.length <= MAX_LINK_LENGTH)
}

function receive(url: string | undefined) {
  if (!url || !url.startsWith(`${SCHEME}://`) || url.length > MAX_LINK_LENGTH) return
  pending.push(url)
  flush()
  onLink?.()
}

function flush() {
  if (!deliverTo || deliverTo.isDestroyed()) return
  for (const url of pending.splice(0)) deliverTo.send(IPC_DEEP_LINK, url)
}

/** Must run before "ready": macOS sends the link that launched the app right away. */
export function registerDeepLinks(): void {
  // Packaged builds register the scheme with the OS (Info.plist, registry, .desktop file); an
  // unpackaged dev run would register the bare Electron binary instead.
  if (app.isPackaged) app.setAsDefaultProtocolClient(SCHEME)

  app.on("open-url", (event, url) => {
    event.preventDefault()
    receive(url)
  })
  app.on("second-instance", (_event, argv) => receive(findDeepLink(argv)))
  receive(findDeepLink(process.argv))
}

export function setupDeepLinks({
  webContents,
  showWindow,
}: {
  webContents: () => WebContents | undefined
  showWindow: () => void
}): void {
  onLink = showWindow
  ipcMain.on(IPC_DEEP_LINKS_READY, (event, ready: unknown) => {
    if (event.sender !== webContents()) return
    deliverTo = ready === true ? event.sender : null
    flush()
  })
  // A reload drops the web app's listener; keep links until it subscribes again.
  app.on("web-contents-created", (_event, contents) => {
    contents.on("did-start-navigation", (details) => {
      if (details.isMainFrame && !details.isSameDocument && contents === deliverTo) deliverTo = null
    })
  })
}
