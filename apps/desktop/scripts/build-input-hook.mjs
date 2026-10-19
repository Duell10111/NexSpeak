// Patch the pinned uiohook-napi source and compile our filtered binary.
//
//   build-input-hook.mjs --patch-only   postinstall: patch only, no C toolchain needed. Upstream's
//                                       unfiltered prebuilds stay so unit tests can load the module.
//   build-input-hook.mjs [arch...]      desktop dev/start/dist: compile for each arch (default: host)
//                                       unless already built, and remove upstream's prebuilds.
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const hookDir = dirname(require.resolve("uiohook-napi/package.json"))
const prebuilds = join(hookDir, "prebuilds")
// Marks our binaries; electron-builder.cjs refuses to package without it.
const MARKER = "nexspeak-filtered"
const patch = fileURLToPath(new URL("../patches/uiohook-napi+1.5.5.patch", import.meta.url))
if (JSON.parse(readFileSync(join(hookDir, "package.json"), "utf8")).version !== "1.5.5") {
  throw new Error("Review the input hook patch before updating uiohook-napi.")
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: hookDir, stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`)
}

const applied = spawnSync("git", ["apply", "--reverse", "--check", patch], { cwd: hookDir, stdio: "ignore" })
if (applied.status !== 0) run("git", ["apply", patch])

const args = process.argv.slice(2)
if (!args.includes("--patch-only")) {
  for (const arch of args.length ? args : [process.arch]) {
    if (!["x64", "arm64"].includes(arch)) throw new Error(`Unsupported input hook architecture: ${arch}`)
    const target = join(prebuilds, `${process.platform}-${arch}`)
    if (existsSync(join(target, MARKER))) continue
    // Drop every unfiltered upstream prebuild, keep binaries we built earlier.
    for (const dir of existsSync(prebuilds) ? readdirSync(prebuilds) : []) {
      if (!existsSync(join(prebuilds, dir, MARKER))) rmSync(join(prebuilds, dir), { recursive: true })
    }
    run(process.execPath, [require.resolve("node-gyp/bin/node-gyp.js"), "rebuild", `--arch=${arch}`])
    mkdirSync(target, { recursive: true })
    copyFileSync(join(hookDir, "build", "Release", "uiohook_napi.node"), join(target, "uiohook-napi.node"))
    writeFileSync(join(target, MARKER), "")
    // node-gyp-build prefers build/Release over prebuilds, which is wrong after a cross-arch build.
    rmSync(join(hookDir, "build"), { recursive: true, force: true })
  }
}
