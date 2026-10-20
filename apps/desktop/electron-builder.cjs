// Packaging for macOS, Windows and Linux. Run from the repo root: npm run dist:desktop
//
// NEXSPEAK_CHANNEL=nightly packages "NexSpeak Nightly" (.github/workflows/nightly.yml), which installs
// next to the stable app: its own app id, name, data folder, executable and deep-link scheme, and
// updates from the NexSpeak-nightly repository. NEXSPEAK_VERSION sets its version. Keep the values
// in sync with src/channel.ts.
const fs = process.getBuiltinModule("node:fs")
const path = process.getBuiltinModule("node:path")

const nightly = process.env.NEXSPEAK_CHANNEL === "nightly"
const productName = nightly ? "NexSpeak Nightly" : "NexSpeak"
// Linux executable, icon and deb package name; the defaults would come from the package name
// "@nexspeak/desktop", which is no valid file or package name. LINUX_NAME in src/channel.ts.
const linuxName = nightly ? "nexspeak-nightly" : "nexspeak"

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: nightly ? "io.github.duell10111.nexspeak.nightly" : "io.github.duell10111.nexspeak",
  productName,
  copyright: "Copyright © 2026 Konstantin Späth",
  // Written into the packaged package.json: Electron names the app and its data folder after
  // productName, electron-updater its cache after name, and src/channel.ts reads the channel.
  ...(nightly && {
    extraMetadata: {
      name: "nexspeak-nightly",
      productName,
      version: process.env.NEXSPEAK_VERSION,
      nexspeakChannel: "nightly",
    },
  }),
  directories: {
    output: "release",
  },
  files: ["dist/**", "assets/**", "package.json"],
  extraResources: [
    // The static web build and its security headers; see webDir in src/main.ts.
    { from: "../web/out", to: "web/out" },
    { from: "../web/security-headers.json", to: "web/security-headers.json" },
  ],
  asar: true,
  // `npm run build:input-hook -- <arch...>` replaces upstream's unfiltered prebuilds with our
  // patched N-API binary (dist runs it for the host arch, the Desktop workflow for every packaged
  // arch). N-API works in Electron unchanged; do not let electron-builder replace the binaries.
  npmRebuild: false,
  beforePack: ({ electronPlatformName, arch }) => {
    const archName = ["ia32", "x64", "armv7l", "arm64", "universal"][arch]
    const marker = path.join(
      path.dirname(require.resolve("uiohook-napi/package.json")),
      "prebuilds", `${electronPlatformName}-${archName}`, "nexspeak-filtered",
    )
    if (!fs.existsSync(marker)) {
      throw new Error(`No filtered input hook for ${electronPlatformName}-${archName}: npm run build:input-hook -- ${archName}`)
    }
  },
  // Deep links (Info.plist on macOS, .desktop file on Linux; Windows registers at runtime).
  protocols: [{ name: productName, schemes: [nightly ? "nexspeak-nightly" : "nexspeak"] }],
  publish: {
    provider: "github",
    owner: "Duell10111",
    repo: nightly ? "NexSpeak-nightly" : "NexSpeak",
  },
  mac: {
    category: "public.app-category.social-networking",
    target: ["dmg", "zip"],
    hardenedRuntime: true,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    extendInfo: {
      NSMicrophoneUsageDescription: `${productName} needs the microphone for voice channels.`,
      NSCameraUsageDescription: `${productName} needs the camera for video in voice channels.`,
      NSAudioCaptureUsageDescription: `${productName} needs system audio access to share sound with your screen.`,
    },
  },
  win: {
    target: ["nsis"],
  },
  nsis: {
    oneClick: true,
    perMachine: false,
  },
  linux: {
    category: "Network;Chat;InstantMessaging",
    target: ["AppImage", "deb"],
    executableName: linuxName,
    maintainer: "Konstantin Späth",
  },
  deb: {
    packageName: linuxName,
    artifactName: `${linuxName}_\${version}_\${arch}.\${ext}`,
  },
}
