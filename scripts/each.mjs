#!/usr/bin/env node
/**
 * Runs one command in every package, in a fixed order, and stops at the first
 * failure:
 *
 *   node scripts/each.mjs npm test
 *   node scripts/each.mjs --only olx,allegro npm run typecheck
 *
 * Packages stay independent on purpose (own package.json, own lockfile, own
 * node_modules): each one is published to npm and listed on medusajs.com on
 * its own, and a change in one never moves the dependency tree of another.
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const packagesDir = path.join(root, "packages")

let args = process.argv.slice(2)
let only = null
if (args[0] === "--only") {
  only = new Set(args[1].split(",").map((s) => s.trim()).filter(Boolean))
  args = args.slice(2)
}
if (args.length === 0) {
  console.error("usage: node scripts/each.mjs [--only olx,allegro] <command...>")
  process.exit(1)
}

const packages = fs
  .readdirSync(packagesDir)
  .filter((d) => fs.existsSync(path.join(packagesDir, d, "package.json")))
  .filter((d) => !only || only.has(d.replace(/^medusa-plugin-/, "")) || only.has(d))
  .sort()

for (const dir of packages) {
  const cwd = path.join(packagesDir, dir)
  console.log(`\n=== ${dir}: ${args.join(" ")}`)
  const r = spawnSync(args[0], args.slice(1), { cwd, stdio: "inherit", shell: process.platform === "win32" })
  if (r.status !== 0) {
    console.error(`\n${dir}: "${args.join(" ")}" failed with code ${r.status}`)
    process.exit(r.status ?? 1)
  }
}
console.log(`\nOK: ${packages.length} packages`)
