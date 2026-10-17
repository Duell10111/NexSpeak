// Renders the tray icons and the taskbar badge in assets/ from SVG. Placeholder until the real app icon
// exists (issue #8). Run: node scripts/render-tray-icons.mjs
import { chromium } from "@playwright/test"
import { join } from "node:path"

const assets = join(import.meta.dirname, "..", "assets")

/** A speech bubble with three voice bars cut out; 32×32 units. */
const shape = (fill, cutout) => `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <defs>
      <mask id="bars">
        <rect width="32" height="32" fill="white" />
        <g fill="${cutout ? "black" : "white"}">
          <rect x="9.5" y="11" width="3" height="7" rx="1.5" />
          <rect x="14.5" y="8.5" width="3" height="12" rx="1.5" />
          <rect x="19.5" y="11" width="3" height="7" rx="1.5" />
        </g>
      </mask>
    </defs>
    <path mask="url(#bars)" fill="${fill}"
      d="M9 3h14a6 6 0 0 1 6 6v11a6 6 0 0 1-6 6H14l-6 4.5V26H9a6 6 0 0 1-6-6V9a6 6 0 0 1 6-6z" />
    ${cutout ? "" : `<g fill="white">
      <rect x="9.5" y="11" width="3" height="7" rx="1.5" />
      <rect x="14.5" y="8.5" width="3" height="12" rx="1.5" />
      <rect x="19.5" y="11" width="3" height="7" rx="1.5" />
    </g>`}
  </svg>`

const badge = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="7" fill="#f23f43" stroke="white" stroke-width="1.5" />
  </svg>`

const icons = [
  // macOS menu bar: black + alpha only, the system tints it ("Template" suffix).
  { name: "trayTemplate.png", size: 16, svg: shape("black", true) },
  { name: "trayTemplate@2x.png", size: 32, svg: shape("black", true) },
  // Windows and Linux: coloured, readable on light and dark task bars.
  { name: "tray.png", size: 16, svg: shape("#23a55a", false) },
  { name: "tray@2x.png", size: 32, svg: shape("#23a55a", false) },
  // Windows taskbar overlay for unread mentions: a red dot, like Discord.
  { name: "badge.png", size: 16, svg: badge },
  { name: "badge@2x.png", size: 32, svg: badge },
]

const browser = await chromium.launch()
const page = await browser.newPage()
for (const { name, size, svg } of icons) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`)
  await page.locator("svg").screenshot({ path: join(assets, name), omitBackground: true })
}
await browser.close()
console.log(`Rendered ${icons.length} icons to ${assets}`)
