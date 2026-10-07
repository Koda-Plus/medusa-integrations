#!/usr/bin/env node
/**
 * Runs one command in every package, in a fixed order:
 *
 *   node scripts/each.mjs npm test
 *   node scripts/each.mjs --only olx,allegro npm run typecheck
 *   node scripts/each.mjs --keep-going npm test      every package, then a summary
 *
 * Without --keep-going it stops at the first failure. Packages stay
 * independent on purpose (own package.json, own lockfile, own node_modules):
 * each one is published to npm and listed on medusajs.com on its own, and a
 * change in one never moves the dependency tree of another. The list of
 * packages comes from their package.json (`koda` block), see lib/packages.mjs.
 */
import { spawnSync } from "node:child_process"
import { listPackages, selectPackages } from "./lib/packages.mjs"

let args = process.argv.slice(2)
let only = null
let keepGoing = false
for (;;) {
  if (args[0] === "--only") {
    only = new Set(String(args[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean))
    args = args.slice(2)
  } else if (args[0] === "--keep-going") {
    keepGoing = true
    args = args.slice(1)
  } else break
}
if (args.length === 0) {
  console.error("usage: node scripts/each.mjs [--only olx,allegro] [--keep-going] <command...>")
  process.exit(1)
}

const packages = selectPackages(listPackages(), only)
const failed = []
for (const p of packages) {
  console.log(`\n=== ${p.dir}: ${args.join(" ")}`)
  /* One command string: npm is npm.cmd on Windows and needs a shell anyway. The arguments come from
     the person running the script, never from package files; quoting keeps spaces and quotes intact. */
  const command = args.map((a) => (/[\s"'$`\\;&|<>()]/.test(a) ? `"${a.replace(/(["$`\\])/g, "\\$1")}"` : a)).join(" ")
  const r = spawnSync(command, { cwd: p.path, stdio: "inherit", shell: true })
  if (r.status !== 0) {
    console.error(`\n${p.dir}: "${args.join(" ")}" failed with code ${r.status}`)
    if (!keepGoing) process.exit(r.status ?? 1)
    failed.push(p.dir)
  }
}
if (failed.length > 0) {
  console.error(`\nFAILED in ${failed.length} of ${packages.length} packages: ${failed.join(", ")}`)
  process.exit(1)
}
console.log(`\nOK: ${packages.length} packages`)
