// Release channel of this build. Nightly builds (NEXSPEAK_CHANNEL=nightly in electron-builder.cjs)
// mark the packaged package.json and install next to the stable app, so everything the OS keys by
// app identity differs. Keep the values in sync with electron-builder.cjs.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { app } from "electron"

function readChannel(): unknown {
  try {
    return JSON.parse(readFileSync(join(app.getAppPath(), "package.json"), "utf8")).nexspeakChannel
  } catch {
    return undefined
  }
}

const nightly = readChannel() === "nightly"

export const CHANNEL = nightly ? "nightly" : "stable"
/** appId in electron-builder.cjs; Windows needs it as AppUserModelID for notifications. */
export const APP_ID = nightly ? "io.github.duell10111.nexspeak.nightly" : "io.github.duell10111.nexspeak"
export const PRODUCT_NAME = nightly ? "NexSpeak Nightly" : "NexSpeak"
/** Scheme of the OS deep links (without ":"); the web app gets it over the bridge for the SSO return. */
export const DEEP_LINK_SCHEME = nightly ? "nexspeak-nightly" : "nexspeak"
/** Linux autostart entry and icon name. */
export const LINUX_NAME = nightly ? "nexspeak-nightly" : "nexspeak"
