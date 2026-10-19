// Keep the pinned upstream source and its license; replace all unfiltered prebuilds with our own.
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const hookDir = dirname(require.resolve("uiohook-napi/package.json"))
const patch = fileURLToPath(new URL("../patches/uiohook-napi+1.5.5.patch", import.meta.url))
const arch = process.argv[2] ?? process.arch
if (!["x64", "arm64"].includes(arch)) throw new Error(`Unsupported input hook architecture: ${arch}`)
if (JSON.parse(readFileSync(join(hookDir, "package.json"), "utf8")).version !== "1.5.5") {
  throw new Error("Review the input hook patch before updating uiohook-napi.")
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: hookDir, stdio: "inherit", ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`)
}

// A second build (e.g. macOS x64 after arm64) must keep the already patched source.
const applied = spawnSync("git", ["apply", "--reverse", "--check", patch], { cwd: hookDir, stdio: "ignore" })
if (applied.status !== 0) {
  run("git", ["apply", "--check", patch])
  run("git", ["apply", patch])
  rmSync(join(hookDir, "prebuilds"), { recursive: true, force: true })
}

run(process.execPath, [require.resolve("node-gyp/bin/node-gyp.js"), "rebuild", `--arch=${arch}`])
const prebuild = join(hookDir, "prebuilds", `${process.platform}-${arch}`)
mkdirSync(prebuild, { recursive: true })
copyFileSync(join(hookDir, "build", "Release", "uiohook_napi.node"), join(prebuild, "uiohook-napi.node"))
// node-gyp-build prefers build/Release over prebuilds, which is wrong after a cross-arch build.
rmSync(join(hookDir, "build"), { recursive: true, force: true })
