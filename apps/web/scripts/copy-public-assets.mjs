// Copies files the browser loads from stable URLs, regardless of the bundler, into public/:
// LiveKit's end-to-end encryption worker (LIVEKIT_E2EE_WORKER_URL) and the audio worklets with
// RNNoise (packages/core/src/audio-processing.ts).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire, stripTypeScriptTypes } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const webDir = join(dirname(fileURLToPath(import.meta.url)), "..")
const publicDir = join(webDir, "public")
const audioDir = join(publicDir, "audio-processing")

mkdirSync(audioDir, { recursive: true })
copyFileSync(
  join(dirname(require.resolve("livekit-client")), "livekit-client.e2ee.worker.mjs"),
  join(publicDir, "livekit-e2ee-worker.mjs"),
)

const noiseSuppressor = join(dirname(require.resolve("@sapphi-red/web-noise-suppressor")))
copyFileSync(join(noiseSuppressor, "rnnoise", "workletProcessor.js"), join(audioDir, "rnnoise-worklet.js"))
for (const wasm of ["rnnoise.wasm", "rnnoise_simd.wasm"]) {
  copyFileSync(join(noiseSuppressor, wasm), join(audioDir, wasm))
}

// The voice gate is a self-contained TypeScript file; worklets can't go through the bundler.
const voiceGate = join(webDir, "..", "..", "packages", "core", "src", "voice-gate-worklet.ts")
process.removeAllListeners("warning") // "stripTypeScriptTypes is an experimental feature"
const stripped = stripTypeScriptTypes(readFileSync(voiceGate, "utf8"), { mode: "strip" })
writeFileSync(join(audioDir, "voice-gate-worklet.js"), stripped)
