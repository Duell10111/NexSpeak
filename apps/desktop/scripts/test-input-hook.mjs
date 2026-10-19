import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const cwd = fileURLToPath(new URL("../native-test", import.meta.url))
for (const args of [
  [require.resolve("node-gyp/bin/node-gyp.js"), "rebuild"],
  ["--test", "dispatch.test.mjs"],
]) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
