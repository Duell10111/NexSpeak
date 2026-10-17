// Fail fast when the app is started with a Node.js version other than the LTS line in .nvmrc.
import { readFileSync } from "node:fs"

const required = readFileSync(new URL("../../../.nvmrc", import.meta.url), "utf8").trim()
const current = process.versions.node.split(".")[0]

if (current !== required) {
  console.error(
    `\nNexSpeak requires Node.js ${required} (LTS), but ${process.version} is active.\n` +
      `Run "nvm use" (or "nvm install") in the project directory and try again.\n`,
  )
  process.exit(1)
}
