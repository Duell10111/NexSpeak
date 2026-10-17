// Serves the static export (out/) with the production security headers, without dependencies.
// For local checks and the end-to-end tests; in production any static host does this job
// (see docs/hosting.md).
import { createReadStream } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, join, normalize, sep } from "node:path"
import { fileURLToPath } from "node:url"

const appDir = join(fileURLToPath(import.meta.url), "..", "..")
const root = join(appDir, "out")
const port = Number(process.env.PORT) || 3000
const securityHeaders = JSON.parse(await readFile(join(appDir, "security-headers.json"), "utf8"))

const TYPES = {
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
  // Required for streaming compilation of the Matrix Rust crypto.
  ".wasm": "application/wasm",
}

async function isFile(path) {
  return (await stat(path).catch(() => null))?.isFile() ?? false
}

/** `/login` → login.html, `/` → index.html; never leaves out/. */
async function resolve(urlPath) {
  const path = normalize(join(root, decodeURIComponent(urlPath)))
  if (path !== root && !path.startsWith(root + sep)) return null
  for (const candidate of [path, `${path}.html`, join(path, "index.html")]) {
    if (await isFile(candidate)) return candidate
  }
  return null
}

createServer(async (req, res) => {
  const urlPath = new URL(req.url ?? "/", "http://localhost").pathname
  const file = await resolve(urlPath).catch(() => null)
  const status = file ? 200 : 404
  const body = file ?? join(root, "404.html")
  res.writeHead(status, {
    ...securityHeaders,
    "Content-Type": TYPES[extname(body)] ?? "application/octet-stream",
    // Hashed build assets never change; everything else is revalidated.
    "Cache-Control": urlPath.startsWith("/_next/static/") ? "public, max-age=31536000, immutable" : "no-cache",
  })
  if (req.method === "HEAD") return res.end()
  createReadStream(body).on("error", () => res.end()).pipe(res)
}).listen(port, () => console.log(`NexSpeak (static export) on http://localhost:${port}`))
