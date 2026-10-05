#!/usr/bin/env node
/**
 * Copies the plugins into a Medusa APP as plain app code:
 *
 *   node scripts/vendor-into-app.mjs ../koda-plus-demo/medusa-backend
 *   node scripts/vendor-into-app.mjs ../koda-plus-demo/medusa-backend olx allegro
 *
 * Why: the Koda demo backend (medusa.koda.plus) deploys from its own folder on
 * Railway, and any change to its package.json busts the Docker `npm ci` cache
 * (a 90 s build becomes ~26 min). Plugins and apps share the same `src/`
 * conventions, so the code runs unchanged; the app registers each module in
 * medusa-config.ts. Once the packages are on npm the app can switch to
 * `plugins: [...]` instead.
 *
 * WHAT GETS COPIED, by convention (namespace `ns` per plugin, see PLUGINS):
 *   directories  modules/<ns>, workflows/<ns>, api/admin/<ns>, api/store/<ns>,
 *                api/hooks/<ns>, api/<ns>, admin/routes/<ns>
 *   files        jobs/<ns>-*, subscribers/<ns>-*, admin/widgets/<ns>-*,
 *                admin/lib/<ns>-*
 *   renamed      admin/i18n/en.ts -> admin/i18n/<ns>-en.ts (pl likewise),
 *                api/middlewares.ts -> api/<ns>-middlewares.ts
 * and `admin/i18n/index.ts` of the app is GENERATED from every vendored
 * namespace, because one app has one admin i18n entry point.
 *
 * Every copied file gets a banner. Edit the plugin, not the copy: before
 * copying, the files this script vendored earlier for a plugin are removed,
 * so a renamed or deleted plugin file never lingers in the app.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** Package directory and the namespace its files, tables and admin strings use. */
const PLUGINS = [
  { name: "OLX by Koda Plus", dir: "medusa-plugin-olx", ns: "olx" },
  { name: "Allegro by Koda Plus", dir: "medusa-plugin-allegro", ns: "allegro" },
  { name: "BaseLinker by Koda Plus", dir: "medusa-plugin-baselinker", ns: "baselinker" },
  { name: "Subiekt nexo by Koda Plus", dir: "medusa-plugin-subiekt-nexo", ns: "subiekt" },
]

const target = process.argv[2]
const wanted = new Set(process.argv.slice(3))
if (!target) {
  console.error("usage: node scripts/vendor-into-app.mjs <path-to-medusa-app> [olx allegro baselinker subiekt]")
  process.exit(1)
}
const appSrc = path.resolve(process.cwd(), target, "src")
if (!fs.existsSync(appSrc)) {
  console.error(`no src/ in ${target}`)
  process.exit(1)
}

const banner = (p) =>
  `// VENDORED from Koda-Plus/medusa-integrations (packages/${p.dir}). Do not edit here:\n` +
  `// change the plugin and run \`npm run vendor\` in medusa-integrations.\n`

/* Banners written by the older per-plugin scripts, so their copies get cleaned too. */
const LEGACY_BANNERS = {
  olx: ["// VENDORED from packages/medusa-plugin-olx"],
  subiekt: ["// VENDORED from medusa-plugin-subiekt-nexo"],
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

function isVendoredBy(file, p) {
  if (!/\.(ts|tsx)$/.test(file)) return false
  const head = fs.readFileSync(file, "utf8").slice(0, 300)
  if (head.startsWith(`// VENDORED from Koda-Plus/medusa-integrations (packages/${p.dir})`)) return true
  return (LEGACY_BANNERS[p.ns] ?? []).some((b) => head.startsWith(b))
}

function removeEmptyDirs(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return
  for (const entry of fs.readdirSync(dir)) removeEmptyDirs(path.join(dir, entry))
  if (dir !== appSrc && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
}

/** [source relative to plugin src, destination relative to app src] for one plugin. */
function planFor(p) {
  const src = path.join(root, "packages", p.dir, "src")
  const pairs = []
  const dirs = [
    `modules/${p.ns}`,
    `workflows/${p.ns}`,
    `api/admin/${p.ns}`,
    `api/store/${p.ns}`,
    `api/hooks/${p.ns}`,
    `api/${p.ns}`,
    `admin/routes/${p.ns}`,
  ]
  for (const d of dirs) {
    for (const file of walk(path.join(src, d))) {
      const rel = path.relative(src, file).split(path.sep).join("/")
      pairs.push([rel, rel])
    }
  }
  for (const d of ["jobs", "subscribers", "admin/widgets", "admin/lib"]) {
    const dir = path.join(src, d)
    if (!fs.existsSync(dir)) continue
    for (const f of fs.readdirSync(dir)) if (f.startsWith(`${p.ns}-`)) pairs.push([`${d}/${f}`, `${d}/${f}`])
  }
  for (const lang of ["en", "pl"]) {
    if (fs.existsSync(path.join(src, `admin/i18n/${lang}.ts`))) {
      pairs.push([`admin/i18n/${lang}.ts`, `admin/i18n/${p.ns}-${lang}.ts`])
    }
  }
  if (fs.existsSync(path.join(src, "api/middlewares.ts"))) pairs.push(["api/middlewares.ts", `api/${p.ns}-middlewares.ts`])
  return { src, pairs: pairs.filter(([from]) => /\.(ts|tsx)$/.test(from)) }
}

const selected = PLUGINS.filter((p) => wanted.size === 0 || wanted.has(p.ns) || wanted.has(p.dir))
const notes = []

for (const p of selected) {
  const { src, pairs } = planFor(p)
  if (!fs.existsSync(src)) {
    console.log(`[vendor] ${p.dir}: not in this repository yet, skipped`)
    continue
  }
  let removed = 0
  for (const file of walk(appSrc)) {
    if (isVendoredBy(file, p)) {
      fs.rmSync(file)
      removed += 1
    }
  }
  /* The old OLX script wrote the whole admin i18n of the app as OLX files. */
  if (p.ns === "olx") {
    for (const f of ["en.ts", "pl.ts", "index.ts"]) {
      const file = path.join(appSrc, "admin/i18n", f)
      if (fs.existsSync(file) && isVendoredBy(file, p)) fs.rmSync(file)
    }
  }
  for (const [from, to] of pairs) {
    let text = fs.readFileSync(path.join(src, from), "utf8")
    if (to.endsWith(`${p.ns}-pl.ts`)) text = text.replace(/from "\.\/en"/g, `from "./${p.ns}-en"`)
    const dst = path.join(appSrc, to)
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.writeFileSync(dst, banner(p) + text)
  }
  console.log(`[vendor] ${p.dir}: ${pairs.length} files copied, ${removed} old copies removed`)

  if (pairs.some(([, to]) => to === `api/${p.ns}-middlewares.ts`)) {
    const appMw = path.join(appSrc, "api/middlewares.ts")
    const text = fs.existsSync(appMw) ? fs.readFileSync(appMw, "utf8") : ""
    if (!text.includes(`./${p.ns}-middlewares`)) {
      notes.push(
        `src/api/middlewares.ts: import ${p.ns}Middlewares from "./${p.ns}-middlewares" and spread ` +
          `...(${p.ns}Middlewares.routes ?? []) into routes.`,
      )
    }
  }
  const config = path.resolve(process.cwd(), target, "medusa-config.ts")
  if (fs.existsSync(config) && !fs.readFileSync(config, "utf8").includes(`./src/modules/${p.ns}"`)) {
    notes.push(`medusa-config.ts: modules: [{ resolve: "./src/modules/${p.ns}", options: { ... } }] (${p.name})`)
  }
}

/* One admin i18n entry point for every vendored namespace. */
const i18nDir = path.join(appSrc, "admin/i18n")
if (fs.existsSync(i18nDir)) {
  const namespaces = fs
    .readdirSync(i18nDir)
    .map((f) => /^([a-z0-9]+)-en\.ts$/.exec(f)?.[1])
    .filter((ns) => ns && fs.existsSync(path.join(i18nDir, `${ns}-pl.ts`)))
    .sort()
  const camel = (ns) => ns.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
  const lines = [
    "// GENERATED by Koda-Plus/medusa-integrations scripts/vendor-into-app.mjs. Do not edit:",
    "// every <namespace>-en.ts / <namespace>-pl.ts pair in this folder is listed below.",
    ...namespaces.flatMap((ns) => [`import ${camel(ns)}En from "./${ns}-en"`, `import ${camel(ns)}Pl from "./${ns}-pl"`]),
    "",
    "/**",
    " * Admin translations, one namespace per integration so they never collide",
    " * with the dashboard or each other. Components read them with",
    ' * `useTranslation("<namespace>")`.',
    " */",
    "export default {",
    `  en: { ${namespaces.map((ns) => `${JSON.stringify(ns)}: ${camel(ns)}En`).join(", ")} },`,
    `  pl: { ${namespaces.map((ns) => `${JSON.stringify(ns)}: ${camel(ns)}Pl`).join(", ")} },`,
    "}",
    "",
  ]
  fs.writeFileSync(path.join(i18nDir, "index.ts"), lines.join("\n"))
  console.log(`[vendor] admin/i18n/index.ts: ${namespaces.join(", ")}`)
}

removeEmptyDirs(appSrc)

if (notes.length > 0) {
  console.log("\nStill to do in the app:")
  for (const n of notes) console.log(`- ${n}`)
  console.log("Then: npx medusa db:migrate")
}
