// Renders every app icon from the SVGs below: the desktop app icon (build/), the tray icons and
// the taskbar badge (assets/) and the favicon, Apple touch icon and manifest icons of the web app.
// Run from apps/desktop: node scripts/render-icons.mjs (needs macOS for iconutil).
//
// The mark: a speech bubble whose sides are square brackets (an open, federated chat protocol),
// with four gamepad face buttons inside; the lit one doubles as a speaking indicator. Colours are
// the app's own accent, deliberately far from other brands' colours.
import { chromium } from "@playwright/test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"

const desktop = join(import.meta.dirname, "..")
const root = join(desktop, "..", "..")
const web = join(desktop, "..", "web")
const dirs = {
  build: join(desktop, "build"),
  linux: join(desktop, "build", "icons"),
  assets: join(desktop, "assets"),
  app: join(web, "src", "app"),
  public: join(web, "public"),
}

const defs = `
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2b2d31" />
      <stop offset="1" stop-color="#18191c" />
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#34d399" />
      <stop offset="1" stop-color="#059669" />
    </linearGradient>
  </defs>`

/** The mark on a 1024 grid, centred on (512, 530). */
const mark = `
  <g fill="none" stroke="url(#accent)" stroke-width="84" stroke-linecap="round" stroke-linejoin="round">
    <path d="M400 250H250V810L370 710H400" />
    <path d="M624 250H774V710H624" />
  </g>
  <g fill="#fff">
    <circle cx="512" cy="372" r="54" fill="#34d399" />
    <circle cx="404" cy="480" r="54" />
    <circle cx="620" cy="480" r="54" />
    <circle cx="512" cy="588" r="54" />
  </g>`

const svg = (body, viewBox = "0 0 1024 1024") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${defs}${body}</svg>`

/** Windows, Linux and the web: the tile fills the canvas. */
const fullTile = svg(`<rect width="1024" height="1024" rx="230" fill="url(#tile)" />${mark}`)

/** macOS: the tile sits on Apple's 824 grid with room for its shadow. */
const macTile = svg(`
  <filter id="shadow" x="-10%" y="-10%" width="120%" height="125%">
    <feDropShadow dx="0" dy="12" stdDeviation="14" flood-opacity="0.35" />
  </filter>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#tile)" filter="url(#shadow)" />
  <g transform="translate(100 100) scale(0.8047)">${mark}</g>`)

/** Android/PWA maskable icon: full-bleed background, mark inside the 80 % safe circle. */
const maskable = svg(`<rect width="1024" height="1024" fill="#1e1f22" />
  <g transform="translate(512 512) scale(0.68) translate(-512 -530)">${mark}</g>`)

/** Too fine below 24 px, so small sizes use a pixel-snapped mark on a 16 grid. */
const smallMark = (fill, buttons = fill, lit = buttons) => `
  <path fill="${fill}" d="M1 1h5v2H3v8h3v2H4.5L1 15.5z" />
  <path fill="${fill}" d="M10 1h5v12h-5v-2h3V3h-3z" />
  <g fill="${buttons}">
    <rect x="7" y="3.5" width="2" height="2" rx="1" fill="${lit}" />
    <rect x="4.5" y="6" width="2" height="2" rx="1" />
    <rect x="9.5" y="6" width="2" height="2" rx="1" />
    <rect x="7" y="8.5" width="2" height="2" rx="1" />
  </g>`
const smallTile = svg(
  `<rect x="-2" y="-2" width="20" height="20" rx="4.5" fill="url(#tile)" />
   <g transform="translate(2.6 2.4) scale(0.68)">${smallMark("#34d399", "#fff", "#34d399")}</g>`,
  "-2 -2 20 20",
)

const badge = svg(`<circle cx="8" cy="8" r="7" fill="#f23f43" stroke="white" stroke-width="1.5" />`, "0 0 16 16")

const browser = await chromium.launch()
const page = await browser.newPage()
async function render(source, size) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${source}`,
  )
  return page.locator("svg").screenshot({ omitBackground: true })
}
const write = (path, data) => {
  writeFileSync(path, data)
  console.log(`  ${relative(root, path)}`)
}

/** ICO with embedded PNGs (supported since Windows Vista). */
function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, png }, i) => {
    const entry = 6 + i * 16
    header.writeUInt8(size >= 256 ? 0 : size, entry)
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...images.map((image) => image.png)])
}
const icoImages = async (sizes) =>
  Promise.all(sizes.map(async (size) => ({ size, png: await render(size < 24 ? smallTile : fullTile, size) })))

for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true })

// Desktop app icon: electron-builder picks up build/icon.icns, build/icon.ico and build/icons/.
const iconset = join(mkdtempSync(join(tmpdir(), "nexspeak-")), "icon.iconset")
mkdirSync(iconset)
for (const size of [16, 32, 128, 256, 512]) {
  writeFileSync(join(iconset, `icon_${size}x${size}.png`), await render(macTile, size))
  writeFileSync(join(iconset, `icon_${size}x${size}@2x.png`), await render(macTile, size * 2))
}
execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(dirs.build, "icon.icns")])
rmSync(join(iconset, ".."), { recursive: true })
console.log(`  ${relative(root, join(dirs.build, "icon.icns"))}`)
write(join(dirs.build, "icon.ico"), ico(await icoImages([16, 24, 32, 48, 64, 128, 256])))
for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
  write(join(dirs.linux, `${size}x${size}.png`), await render(size < 24 ? smallTile : fullTile, size))
}

// Linux window icon (Windows takes it from the .exe, macOS from the app bundle).
write(join(dirs.assets, "icon.png"), await render(fullTile, 256))

// Tray and badge.
const tray = (fill) => svg(smallMark(fill), "0 0 16 16")
for (const [name, source] of [
  // macOS menu bar: black + alpha only, the system tints it ("Template" suffix).
  ["trayTemplate", tray("black")],
  // Windows and Linux: coloured, readable on light and dark task bars.
  ["tray", tray("#10b981")],
  // Windows taskbar overlay for unread mentions: a red dot.
  ["badge", badge],
]) {
  write(join(dirs.assets, `${name}.png`), await render(source, 16))
  write(join(dirs.assets, `${name}@2x.png`), await render(source, 32))
}

// Web app: Next.js picks up favicon.ico, icon.svg and apple-icon.png in src/app; the manifest
// (src/app/manifest.ts) points to the PNGs in public/.
write(join(dirs.app, "favicon.ico"), ico(await icoImages([16, 32, 48])))
write(join(dirs.app, "icon.svg"), fullTile.replace(/\n\s*/g, " ").trim() + "\n")
write(join(dirs.app, "apple-icon.png"), await render(maskable, 180))
write(join(dirs.public, "icon-192.png"), await render(fullTile, 192))
write(join(dirs.public, "icon-512.png"), await render(fullTile, 512))
write(join(dirs.public, "icon-maskable-512.png"), await render(maskable, 512))

await browser.close()
