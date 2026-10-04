#!/usr/bin/env node
/**
 * Copies the plugin source into a Medusa APP as plain app code:
 *
 *   node scripts/vendor-into-app.mjs ../koda-plus-demo/medusa-backend
 *
 * Why: an app that deploys from its own folder (the Koda demo on Railway) can
 * run the plugin without a package.json change, which would bust the Docker
 * install cache. Plugin and app share the same `src/` conventions, so the code
 * runs unchanged; the app only registers the module in medusa-config.ts:
 *
 *   modules: [{ resolve: "./src/modules/subiekt", options: { demo: true } }]
 *
 * Translations: an app has ONE `src/admin/i18n/index.ts`. The plugin strings go
 * to `admin/i18n/subiekt-en.ts` and `subiekt-pl.ts`; add them to the app index
 * under the `subiekt` namespace (the script prints the two lines).
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
  console.error("usage: node scripts/vendor-into-app.mjs <path-to-medusa-app>")
  process.exit(1)
}
const appSrc = path.resolve(process.cwd(), target, "src")
if (!fs.existsSync(appSrc)) {
  console.error(`no src/ in ${target}`)
  process.exit(1)
}

/** [source relative to plugin src, destination relative to app src]. Directories are copied recursively. */
const MAP = [
  ["modules/subiekt", "modules/subiekt"],
  ["workflows/subiekt", "workflows/subiekt"],
  ["api/admin/subiekt", "api/admin/subiekt"],
  ["api/hooks/subiekt", "api/hooks/subiekt"],
  ["subscribers/subiekt-order-placed.ts", "subscribers/subiekt-order-placed.ts"],
  ["subscribers/subiekt-payment-captured.ts", "subscribers/subiekt-payment-captured.ts"],
  ["subscribers/subiekt-order-canceled.ts", "subscribers/subiekt-order-canceled.ts"],
  ["subscribers/subiekt-fulfillment-created.ts", "subscribers/subiekt-fulfillment-created.ts"],
  ["jobs/subiekt-process-tasks.ts", "jobs/subiekt-process-tasks.ts"],
  ["jobs/subiekt-pull-events.ts", "jobs/subiekt-pull-events.ts"],
  ["jobs/subiekt-sync-stock.ts", "jobs/subiekt-sync-stock.ts"],
  ["admin/routes/subiekt", "admin/routes/subiekt"],
  ["admin/widgets/subiekt-order-widget.tsx", "admin/widgets/subiekt-order-widget.tsx"],
  ["admin/lib/subiekt-api.ts", "admin/lib/subiekt-api.ts"],
  ["admin/lib/subiekt-ui.tsx", "admin/lib/subiekt-ui.tsx"],
  ["admin/i18n/en.ts", "admin/i18n/subiekt-en.ts"],
  ["admin/i18n/pl.ts", "admin/i18n/subiekt-pl.ts"],
]

const BANNER =
  "// VENDORED from medusa-plugin-subiekt-nexo (Subiekt nexo by Koda Plus). Do not edit here:\n" +
  "// change the plugin and run `node scripts/vendor-into-app.mjs <app>` in the plugin repository.\n"

let copied = 0
function copy(src, dst) {
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(src)) copy(path.join(src, entry), path.join(dst, entry))
    return
  }
  if (!/\.(ts|tsx)$/.test(src)) return
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  let text = fs.readFileSync(src, "utf8")
  // The Polish strings are typed by the English ones, which get a new name in the app.
  if (dst.endsWith("subiekt-pl.ts")) text = text.replace('from "./en"', 'from "./subiekt-en"')
  fs.writeFileSync(dst, BANNER + text)
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

const middlewares = path.join(appSrc, "api", "middlewares.ts")
const hasRawBody = fs.existsSync(middlewares) && fs.readFileSync(middlewares, "utf8").includes("/hooks/subiekt")

console.log(`Copied ${copied} files into ${appSrc}.`)
console.log("")
console.log("Still to do in the app:")
console.log('1. medusa-config.ts: modules: [{ resolve: "./src/modules/subiekt", options: { demo: true } }]')
console.log("2. src/admin/i18n/index.ts: import subiektEn from \"./subiekt-en\"; import subiektPl from \"./subiekt-pl\";")
console.log("   and add `subiekt: subiektEn` to `en`, `subiekt: subiektPl` to `pl`.")
if (!hasRawBody) {
  console.log("3. src/api/middlewares.ts: add the raw body route for the bridge webhook:")
  console.log('   { matcher: "/hooks/subiekt", method: ["POST"], bodyParser: { preserveRawBody: true } }')
}
console.log("Then: npx medusa db:migrate")
