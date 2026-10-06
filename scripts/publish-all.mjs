#!/usr/bin/env node
/**
 * Publishes the five packages to npm, one after another, and skips any whose
 * current version is already there, so a run stopped halfway (a 2FA prompt,
 * a lost connection) can simply be started again.
 *
 *   npm run release
 *
 * Needs `npm login` with an account in the npm organization `koda-plus`.
 * `npm publish` runs each package's prepublishOnly (tests, then
 * `medusa plugin:build`), so nothing untested or unbuilt goes out. When the
 * account uses 2FA, npm asks for it in the terminal or in the browser.
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const PACKAGES = ["medusa-plugin-olx", "medusa-plugin-allegro", "medusa-plugin-baselinker", "medusa-plugin-subiekt-nexo", "medusa-plugin-fakturownia"]

const npm = (args, cwd, quiet = false) => spawnSync("npm", args, { cwd, shell: true, stdio: quiet ? "pipe" : "inherit", encoding: "utf8" })

const who = npm(["whoami"], root, true)
if (who.status !== 0) {
  console.error("Not logged in to npm. Run `npm login` first (an account in the koda-plus organization).")
  process.exit(1)
}
console.log(`npm user: ${who.stdout.trim()}`)

const done = []
for (const dir of PACKAGES) {
  const cwd = path.join(root, "packages", dir)
  const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"))
  const id = `${pkg.name}@${pkg.version}`
  if (npm(["view", id, "version"], cwd, true).stdout?.trim() === pkg.version) {
    console.log(`\n= ${id} is already on npm, skipped`)
    continue
  }
  console.log(`\n= publishing ${id}`)
  const run = npm(["publish", "--access", "public"], cwd)
  if (run.status !== 0) {
    console.error(`\n${id} was not published (exit ${run.status}). Fix the cause and run npm run release again: published ones are skipped.`)
    process.exit(run.status ?? 1)
  }
  done.push(id)
}
console.log(`\nPublished: ${done.length ? done.join(", ") : "nothing new"}`)
