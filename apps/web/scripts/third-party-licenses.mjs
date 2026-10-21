// Collects the licenses of everything the apps ship (the production dependencies of apps/web and
// apps/desktop, transitively) into public/third-party-licenses.json, which Settings → About shows.
// With --check it only verifies that every license is compatible with the AGPL-3.0 and fails
// otherwise (CI). No dependency of its own: it reads node_modules directly.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..")
const rootDir = join(webDir, "..", "..")
const entryDirs = [webDir, join(rootDir, "apps", "desktop")]
const outputFile = join(webDir, "public", "third-party-licenses.json")
const checkOnly = process.argv.includes("--check")

// SPDX identifiers compatible with distributing the apps under the AGPL-3.0-or-later.
const COMPATIBLE = new Set([
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC-BY-4.0",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "Python-2.0",
  "Unlicense",
  "Unicode-3.0",
  "Zlib",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
])

/** True when an SPDX expression like "(MIT OR Apache-2.0)" allows a compatible license. */
function isCompatible(expression) {
  const normalized = expression.replace(/[()]/g, " ").trim()
  if (!normalized) return false
  return normalized
    .split(/\s+OR\s+/)
    .some((alternative) => alternative.split(/\s+AND\s+/).every((id) => COMPATIBLE.has(id.trim().replace(/\+$/, "-or-later"))))
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"))
}

/** Node's lookup: node_modules of the directory, then of every parent. */
function resolvePackageDir(name, fromDir) {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name)
    if (existsSync(join(candidate, "package.json"))) return candidate
    if (dir === dirname(dir)) return null
  }
}

function licenseOf(manifest) {
  const { license, licenses } = manifest
  if (typeof license === "string") return license
  if (license && typeof license.type === "string") return license.type
  if (Array.isArray(licenses)) return licenses.map((entry) => entry.type ?? entry).join(" OR ")
  return ""
}

function repositoryOf(manifest) {
  const repository = typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url
  if (!repository) return manifest.homepage || undefined
  return repository
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^github:/, "https://github.com/")
    .replace(/^([\w-]+\/[\w.-]+)$/, "https://github.com/$1")
    .replace(/\.git$/, "")
}

function licenseText(dir) {
  const file = readdirSync(dir).find((entry) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(entry))
  return file ? readFileSync(join(dir, file), "utf8").trim() : undefined
}

const packages = new Map()

function visit(name, fromDir) {
  const dir = resolvePackageDir(name, fromDir)
  if (!dir) return
  const manifest = readJson(join(dir, "package.json"))
  const key = `${manifest.name}@${manifest.version}`
  if (packages.has(key)) return
  // Our own workspaces: their dependencies count, they themselves are this project.
  const isWorkspace = manifest.name?.startsWith("@nexspeak/")
  if (!isWorkspace) {
    packages.set(key, {
      name: manifest.name,
      version: manifest.version,
      license: licenseOf(manifest),
      repository: repositoryOf(manifest),
      text: checkOnly ? undefined : licenseText(dir),
    })
  } else {
    packages.set(key, null)
  }
  // Optional dependencies are platform binaries of build tools (sharp, swc), not shipped code.
  for (const dependency of Object.keys(manifest.dependencies ?? {})) visit(dependency, dir)
}

for (const entryDir of entryDirs) {
  const manifest = readJson(join(entryDir, "package.json"))
  for (const dependency of Object.keys(manifest.dependencies ?? {})) visit(dependency, entryDir)
}

// Vendored data has no npm package, but must ship its attribution with the app.
packages.set("unicode-emoji-cldr", {
  name: "Unicode emoji and CLDR annotations",
  version: "Emoji 17.0 / CLDR 48",
  license: "Unicode-3.0",
  repository: "https://unicode.org/Public/17.0.0/emoji/emoji-test.txt",
  text: checkOnly ? undefined : readFileSync(join(webDir, "public/licenses/unicode.txt"), "utf8").trim(),
})

const list = [...packages.values()].filter(Boolean).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
const incompatible = list.filter((entry) => !isCompatible(entry.license))

if (incompatible.length > 0) {
  console.error("Dependencies with a license that is unknown or incompatible with the AGPL-3.0:")
  for (const entry of incompatible) console.error(`  ${entry.name}@${entry.version}: ${entry.license || "(none)"}`)
  console.error("Add the license to COMPATIBLE in apps/web/scripts/third-party-licenses.mjs only if it is compatible.")
  process.exit(1)
}

if (checkOnly) {
  console.log(`${list.length} third-party packages, all licenses compatible.`)
} else {
  writeFileSync(outputFile, JSON.stringify(list))
}
