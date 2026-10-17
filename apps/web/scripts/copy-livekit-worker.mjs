// Copies LiveKit's end-to-end encryption worker into public/, so the browser can load it
// from a stable URL regardless of the bundler (see LIVEKIT_E2EE_WORKER_URL).
import { copyFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const source = join(dirname(require.resolve("livekit-client")), "livekit-client.e2ee.worker.mjs")
const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public")

mkdirSync(publicDir, { recursive: true })
copyFileSync(source, join(publicDir, "livekit-e2ee-worker.mjs"))
