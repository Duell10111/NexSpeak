// Electron main process: one window showing the static web build (apps/web/out) under app://nexspeak.
// Everything the user sees is web code; this file only adds what a browser tab cannot do.
import { readFileSync } from "node:fs"
import { stat } from "node:fs/promises"
import { extname, join, normalize, sep } from "node:path"
import { pathToFileURL } from "node:url"
import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  net,
  protocol,
  session,
  shell,
  webContents,
  type Session,
} from "electron"
import type { DisplaySource } from "@nexspeak/core/desktop-bridge" with { "resolution-mode": "import" }
import { setupAutostart, wasOpenedAtLogin } from "./autostart"
import { setBadgeCount } from "./badge"
import { registerDeepLinks, setupDeepLinks } from "./deep-links"
import { originOf } from "./origin"
import { setupPushToTalk, stopPushToTalk } from "./push-to-talk"
import { createTray, setTrayUpdate } from "./tray"
import { setupUpdater, setUpdaterInCall } from "./updater"

// Same names as in preload.ts (a sandboxed preload cannot import other files).
const IPC_CHOOSE_DISPLAY_SOURCE = "nexspeak:choose-display-source"
const IPC_DISPLAY_SOURCE_CHOSEN = "nexspeak:display-source-chosen"
const IPC_SHOW_WINDOW = "nexspeak:show-window"
const IPC_BADGE_COUNT = "nexspeak:badge-count"

const APP_ORIGIN = "app://nexspeak"
/** `npm run dev:desktop` points this at the Next.js dev server instead of the static build. */
const devUrl = process.env.NEXSPEAK_DEV_URL
const appOrigin = devUrl ? new URL(devUrl).origin : APP_ORIGIN


const webDir = app.isPackaged ? join(process.resourcesPath, "web") : join(__dirname, "..", "..", "web")
const webRoot = join(webDir, "out")

// Hardware video encoding (see AGENTS.md). Chromium enables it on macOS and Windows by default;
// on Linux VA-API encoding has to be switched on. Never disable hardware acceleration.
if (process.platform === "linux") {
  app.commandLine.appendSwitch("enable-features", "AcceleratedVideoEncoder,VaapiVideoEncoder,VaapiVideoDecodeLinuxGL")
}

// Windows only shows notifications for apps with an AppUserModelID (same as appId in
// electron-builder.yml).
if (process.platform === "win32") app.setAppUserModelId("io.github.duell10111.nexspeak")

// A standard, secure scheme gives the app a real origin (localStorage, IndexedDB), a secure context
// (microphone, camera, screen capture) and fetch/streaming for the crypto WASM.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
  },
])

let mainWindow: BrowserWindow | undefined
/** Closing the window only hides it; set once the app really quits (tray menu, Cmd+Q, updates). */
let isQuitting = false
/** Autostarted at login: the first window stays hidden in the tray until the user opens it. */
let startHidden = false

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", showWindow)
  registerDeepLinks()
  app.whenReady().then(start)
}

app.on("before-quit", () => {
  isQuitting = true
})

app.on("will-quit", stopPushToTalk)

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

// macOS: clicking the dock icon brings the hidden window back.
app.on("activate", showWindow)

function start() {
  const securityHeaders: Record<string, string> = JSON.parse(
    readFileSync(join(webDir, "security-headers.json"), "utf8"),
  )
  serveWebBuild(securityHeaders)
  restrictPermissions(session.defaultSession)
  handleDisplayMedia(session.defaultSession)
  const appContents = () => mainWindow?.webContents
  setupDeepLinks({ webContents: appContents, showWindow })
  startHidden = wasOpenedAtLogin()
  mainWindow = createWindow()
  createTray({ webContents: appContents, showWindow, onVoiceState: (state) => setUpdaterInCall(state?.inCall ?? false) })
  setupPushToTalk(appContents)
  setupAutostart(appContents)
  setupUpdater({
    webContents: appContents,
    prepareQuit: () => {
      isQuitting = true
    },
    onReady: setTrayUpdate,
  })
  const fromAppWindow = (event: Electron.IpcMainEvent) => event.sender === mainWindow?.webContents
  ipcMain.on(IPC_SHOW_WINDOW, (event) => {
    if (fromAppWindow(event)) showWindow()
  })
  ipcMain.on(IPC_BADGE_COUNT, (event, count: unknown) => {
    if (!fromAppWindow(event) || typeof count !== "number" || !Number.isInteger(count) || count < 0) return
    setBadgeCount(mainWindow, count)
  })
}

function showWindow() {
  if (!app.isReady()) return
  startHidden = false
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
}

async function isFile(path: string) {
  return (await stat(path).catch(() => null))?.isFile() ?? false
}

/** `/login` → login.html, `/` → index.html (like apps/web/scripts/serve.mjs); never leaves the build. */
async function resolveWebFile(pathname: string): Promise<string | null> {
  const path = normalize(join(webRoot, decodeURIComponent(pathname)))
  if (path !== webRoot && !path.startsWith(webRoot + sep)) return null
  for (const candidate of [path, `${path}.html`, join(path, "index.html")]) {
    if (await isFile(candidate)) return candidate
  }
  return null
}

function serveWebBuild(securityHeaders: Record<string, string>) {
  protocol.handle("app", async (request) => {
    const url = new URL(request.url)
    const file = url.host === "nexspeak" ? await resolveWebFile(url.pathname).catch(() => null) : null
    const body = file ?? join(webRoot, "404.html")
    const response = await net.fetch(pathToFileURL(body).toString())
    return new Response(response.body, {
      status: file ? 200 : 404,
      headers: { ...securityHeaders, "Content-Type": MIME_TYPES[extname(body)] ?? "application/octet-stream" },
    })
  })
}

const ALLOWED_PERMISSIONS = new Set([
  "media",
  "display-capture",
  "notifications",
  "fullscreen",
  "clipboard-sanitized-write",
  "speaker-selection",
])

/** Only our own pages get microphone, camera, screen capture and notifications; nothing else. */
function restrictPermissions(target: Session) {
  const isOwnOrigin = (url: string) => originOf(url) === appOrigin
  target.setPermissionRequestHandler((contents, permission, callback) => {
    callback(isOwnOrigin(contents.getURL()) && ALLOWED_PERMISSIONS.has(permission))
  })
  target.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    return isOwnOrigin(requestingOrigin) && ALLOWED_PERMISSIONS.has(permission)
  })
}

/**
 * Screen capture: macOS 15+ shows its own picker (ScreenCaptureKit), Wayland shows the portal's.
 * Elsewhere the web app shows ours (DesktopSourcePicker) and answers over IPC.
 */
function handleDisplayMedia(target: Session) {
  let nextRequestId = 0
  target.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 320, height: 180 },
        })
        const ownWindowIds = new Set(BrowserWindow.getAllWindows().map((window) => window.getMediaSourceId()))
        const choices = sources.filter((source) => !ownWindowIds.has(source.id))
        const requester = request.frame ? webContents.fromFrame(request.frame) : undefined
        const window = (requester && BrowserWindow.fromWebContents(requester)) ?? BrowserWindow.getAllWindows()[0]
        if (!window || choices.length === 0) return callback({})

        // The Wayland portal has already asked the user and returns exactly the chosen source.
        let chosenId: string | null = choices.length === 1 ? choices[0].id : null
        if (!chosenId) {
          const requestId = ++nextRequestId
          const payload: DisplaySource[] = choices.map((source) => ({
            id: source.id,
            name: source.name,
            kind: source.id.startsWith("screen:") ? "screen" : "window",
            thumbnail: source.thumbnail.toDataURL(),
          }))
          chosenId = await new Promise<string | null>((resolve) => {
            const onChosen = (event: Electron.IpcMainEvent, id: number, sourceId: string | null) => {
              if (id !== requestId || event.sender !== window.webContents) return
              ipcMain.off(IPC_DISPLAY_SOURCE_CHOSEN, onChosen)
              window.webContents.off("destroyed", cancel)
              resolve(sourceId)
            }
            const cancel = () => {
              ipcMain.off(IPC_DISPLAY_SOURCE_CHOSEN, onChosen)
              resolve(null)
            }
            ipcMain.on(IPC_DISPLAY_SOURCE_CHOSEN, onChosen)
            window.webContents.once("destroyed", cancel)
            window.webContents.send(IPC_CHOOSE_DISPLAY_SOURCE, requestId, payload)
          })
        }

        const source = choices.find((candidate) => candidate.id === chosenId)
        if (!source) return callback({})
        // System audio only exists as loopback on Windows.
        callback({ video: source, ...(request.audioRequested && process.platform === "win32" && { audio: "loopback" }) })
      } catch (error) {
        console.error("Screen capture request failed", error)
        callback({})
      }
    },
    { useSystemPicker: true },
  )
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    show: false,
    // Matches --background in the web app, so there is no white flash before the first paint.
    backgroundColor: "#313338",
    title: "NexSpeak",
    // Windows takes the icon from the .exe and macOS from the app bundle.
    ...(process.platform === "linux" && { icon: join(__dirname, "..", "assets", "icon.png") }),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Chromium throttles timers in hidden windows; keep that so a window in the background costs nothing.
      backgroundThrottling: true,
      // The spell checker downloads dictionaries from Google; off until it is a setting.
      spellcheck: false,
    },
  })

  window.once("ready-to-show", () => {
    if (!startHidden) window.show()
  })
  // Like Discord: closing keeps the app (and a running call) alive in the tray.
  window.on("close", (event) => {
    if (isQuitting) return
    event.preventDefault()
    window.hide()
  })

  // Links to other sites open in the default browser; the app window never leaves the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: "deny" }
  })
  window.webContents.on("will-navigate", (event, url) => {
    if (originOf(url) === appOrigin) return
    event.preventDefault()
    openExternal(url)
  })

  void window.loadURL(devUrl ?? `${APP_ORIGIN}/`)
  return window
}

function openExternal(url: string) {
  const { protocol: scheme } = new URL(url)
  if (scheme === "https:" || scheme === "http:" || scheme === "mailto:") void shell.openExternal(url)
}
