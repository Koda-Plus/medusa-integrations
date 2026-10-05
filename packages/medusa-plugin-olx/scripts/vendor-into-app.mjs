#!/usr/bin/env node
/**
 * Copies the plugin source into a Medusa APP as plain app code:
 *
 *   node packages/medusa-plugin-olx/scripts/vendor-into-app.mjs medusa-backend
 *
 * Why: the Koda demo backend deploys from its own folder on Railway, and any
 * change to its package.json busts the Docker `npm ci` cache (a 90 s build
 * becomes ~26 min). Plugin and app share the same `src/` conventions, so the
 * code runs unchanged; the app only registers the module in medusa-config.ts.
 * Once the package is on npm the app can switch to `plugins: [...]` instead.
 *
 * Every copied file gets a banner. Edit the plugin, not the copy.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginSrc = path.resolve(here, "..", "src")
const target = process.argv[2]
if (!target) {
  console.error("usage: node vendor-into-app.mjs <path-to-medusa-app>")
  process.exit(1)
}
const appSrc = path.resolve(process.cwd(), target, "src")
if (!fs.existsSync(appSrc)) {
  console.error(`no src/ in ${target}`)
  process.exit(1)
}

/** [source relative to plugin src, destination relative to app src]. Directories are copied recursively. */
const MAP = [
  ["modules/olx", "modules/olx"],
  ["workflows/olx", "workflows/olx"],
  ["api/admin/olx", "api/admin/olx"],
  ["api/store/olx", "api/store/olx"],
  ["api/olx", "api/olx"],
  ["jobs/olx-sync-adverts.ts", "jobs/olx-sync-adverts.ts"],
  ["admin/routes/olx", "admin/routes/olx"],
  ["admin/widgets/olx-product-adverts.tsx", "admin/widgets/olx-product-adverts.tsx"],
  ["admin/lib/olx-api.ts", "admin/lib/olx-api.ts"],
  ["admin/lib/olx-ui.tsx", "admin/lib/olx-ui.tsx"],
  ["admin/lib/olx-icon.tsx", "admin/lib/olx-icon.tsx"],
  ["admin/i18n", "admin/i18n"],
]

const BANNER =
  "// VENDORED from packages/medusa-plugin-olx (OLX by Koda Plus). Do not edit here:\n" +
  "// change the plugin and run `node packages/medusa-plugin-olx/scripts/vendor-into-app.mjs medusa-backend`.\n"

let copied = 0
function copy(src, dst) {
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(src)) copy(path.join(src, entry), path.join(dst, entry))
    return
  }
  if (!/\.(ts|tsx)$/.test(src)) return
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.writeFileSync(dst, BANNER + fs.readFileSync(src, "utf8"))
  copied += 1
}

for (const [from, to] of MAP) {
  const src = path.join(pluginSrc, from)
  if (!fs.existsSync(src)) {
    console.error(`missing in plugin: ${from}`)
    process.exit(1)
  }
  copy(src, path.join(appSrc, to))
}
console.log(`[vendor] ${copied} files copied into ${path.relative(process.cwd(), appSrc)}`)
