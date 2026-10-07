#!/usr/bin/env node
/**
 * Copies the plugins into a Medusa APP as plain app code:
 *
 *   node scripts/vendor-into-app.mjs ../koda-plus-demo/medusa-backend
 *   node scripts/vendor-into-app.mjs ../koda-plus-demo/medusa-backend olx allegro
 *   node scripts/vendor-into-app.mjs --check ../koda-plus-demo/medusa-backend   is the app current?
 *
 * Why: the Koda demo backend (medusa.koda.plus) deploys from its own folder on
 * Railway, and any change to its package.json busts the Docker `npm ci` cache
 * (a 90 s build becomes ~26 min). Plugins and apps share the same `src/`
 * conventions, so the code runs unchanged; the app registers each module in
 * medusa-config.ts. Once the packages are on npm the app can switch to
 * `plugins: [...]` instead.
 *
 * WHAT GETS COPIED, by convention (namespace `ns` per plugin, from the
 * `koda` block of each package.json):
 *   directories  modules/<mod>, providers/<ns>, workflows/<ns>, api/admin/<ns>,
 *                api/store/<ns>, api/hooks/<ns>, api/<ns>, admin/routes/<ns>
 *   files        jobs/<ns>-*, subscribers/<ns>-*, policies/<ns>-*,
 *                admin/widgets/<ns>-*, admin/lib/<ns>-*
 *   renamed      admin/i18n/en.ts -> admin/i18n/<ns>-en.ts (pl likewise),
 *                api/middlewares.ts -> api/<ns>-middlewares.ts
 * and `admin/i18n/index.ts` of the app is GENERATED from every vendored
 * namespace, because one app has one admin i18n entry point.
 *
 * Every copied file gets a banner with the package version and the commit.
 * Edit the plugin, not the copy: before copying, the files this script
 * vendored earlier for a plugin are removed, so a renamed or deleted plugin
 * file never lingers in the app. `--check` changes nothing and fails when a
 * copy is missing, stale or left over.
 *
 * THE APP'S SETTINGS, in `koda-vendor.json` next to its package.json:
 *   { "host": true }               also writes the host side of the kit
 *                                  (admin/lib/koda-contract.ts,
 *                                  koda-registry.tsx, koda-host.tsx): the app
 *                                  shows every plugin card as a tab of one
 *                                  card (claimZones, useHostedTabs).
 *   { "widgetsDir": "admin/extensions" }
 *                                  the old way of hosting: widgets copied out
 *                                  of admin/widgets so Medusa does not mount
 *                                  them. Not needed with "host": the cards
 *                                  step aside by themselves in claimed zones.
 *   { "widgetsDirFor": { "olx": "admin/extensions" } }
 *                                  the same per plugin, for plugins whose
 *                                  cards are not hostable yet: the app mounts
 *                                  them itself (as tabs of its own card).
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { listPackages, root } from "./lib/packages.mjs"

const argv = process.argv.slice(2)
const check = argv.includes("--check")
const positional = argv.filter((a) => !a.startsWith("--"))
const target = positional[0]
const wanted = new Set(positional.slice(1))
if (!target) {
  console.error("usage: node scripts/vendor-into-app.mjs [--check] <path-to-medusa-app> [olx allegro ...]")
  process.exit(1)
}
const appSrc = path.resolve(process.cwd(), target, "src")
if (!fs.existsSync(appSrc)) {
  console.error(`no src/ in ${target}`)
  process.exit(1)
}

/* The app's own settings (see above). */
const appSettingsFile = path.resolve(process.cwd(), target, "koda-vendor.json")
const appSettings = fs.existsSync(appSettingsFile) ? JSON.parse(fs.readFileSync(appSettingsFile, "utf8")) : {}
function adminDir(value, name) {
  const dir = String(value).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
  if (!/^admin\/[a-z0-9-]+$/.test(dir)) {
    console.error(`koda-vendor.json: ${name} must be a folder right under admin/, got "${dir}"`)
    process.exit(1)
  }
  return dir
}
const widgetsDir = adminDir(appSettings.widgetsDir ?? "admin/widgets", "widgetsDir")
const widgetsDirFor = Object.fromEntries(Object.entries(appSettings.widgetsDirFor ?? {}).map(([ns, dir]) => [ns, adminDir(dir, `widgetsDirFor.${ns}`)]))
const hostWanted = appSettings.host === true

const sha = (spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).stdout ?? "").trim() || "unknown"
const KIT_VERSION = fs.readFileSync(path.join(root, "kit/VERSION"), "utf8").trim()

const banner = (p) =>
  `// VENDORED from Koda-Plus/medusa-integrations (packages/${p.dir}@${p.version}, ${sha}). Do not edit here:\n` +
  `// change the plugin and run \`npm run vendor\` in medusa-integrations.\n`
/* --check compares contents, not the commit in the banner. */
const withoutBanner = (text) => text.replace(/^\/\/ VENDORED from [^\n]*\n\/\/ change the plugin[^\n]*\n/, "").replace(/^\/\/ GENERATED from kit\/[^\n]*\n/, "")

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
  if (head.startsWith(`// VENDORED from Koda-Plus/medusa-integrations (packages/${p.dir}@`)) return true
  return (LEGACY_BANNERS[p.ns] ?? []).some((b) => head.startsWith(b))
}

/** [source relative to plugin src, destination relative to app src] for one plugin, and the files left out. */
function planFor(p) {
  const src = path.join(p.path, "src")
  const pairs = []
  const dirs = [`modules/${p.moduleDir}`, `providers/${p.ns}`, `workflows/${p.ns}`, `api/admin/${p.ns}`, `api/store/${p.ns}`, `api/hooks/${p.ns}`, `api/${p.ns}`, `admin/routes/${p.ns}`]
  for (const d of dirs) {
    for (const file of walk(path.join(src, d))) {
      const rel = path.relative(src, file).split(path.sep).join("/")
      pairs.push([rel, rel])
    }
  }
  for (const d of ["jobs", "subscribers", "policies", "admin/widgets", "admin/lib"]) {
    const dir = path.join(src, d)
    if (!fs.existsSync(dir)) continue
    const into = d === "admin/widgets" ? (widgetsDirFor[p.ns] ?? widgetsDir) : d
    for (const f of fs.readdirSync(dir)) if (f.startsWith(`${p.ns}-`)) pairs.push([`${d}/${f}`, `${into}/${f}`])
  }
  for (const lang of ["en", "pl"]) {
    if (fs.existsSync(path.join(src, `admin/i18n/${lang}.ts`))) pairs.push([`admin/i18n/${lang}.ts`, `admin/i18n/${p.ns}-${lang}.ts`])
  }
  if (fs.existsSync(path.join(src, "api/middlewares.ts"))) pairs.push(["api/middlewares.ts", `api/${p.ns}-middlewares.ts`])
  const skipped = pairs.filter(([from]) => !/\.(ts|tsx)$/.test(from)).map(([from]) => from)
  return { src, dirs, pairs: pairs.filter(([from]) => /\.(ts|tsx)$/.test(from)), skipped }
}

/** The content a copy should have. */
function contentOf(p, src, from, to) {
  let text = fs.readFileSync(path.join(src, from), "utf8")
  if (to.endsWith(`${p.ns}-pl.ts`)) text = text.replace(/from "\.\/en"/g, `from "./${p.ns}-en"`)
  return banner(p) + text
}

/** The host side of the kit, for an app with "host": true. */
function hostFiles() {
  const gen = (from) => `// GENERATED from kit/${from} (kit ${KIT_VERSION}) by medusa-integrations scripts/vendor-into-app.mjs. Do not edit here.\n`
  const read = (f) => fs.readFileSync(path.join(root, "kit", f), "utf8")
  return [
    ["admin/lib/koda-contract.ts", gen("contract.ts") + read("contract.ts")],
    ["admin/lib/koda-registry.tsx", gen("admin/kit.tsx") + read("admin/kit.tsx").replace(/from "\.\.\/\.\.\/modules\/__NS__\/lib\/kit-contract"/g, 'from "./koda-contract"')],
    ["admin/lib/koda-host.tsx", gen("host/host.tsx") + read("host/host.tsx")],
  ]
}

const packages = listPackages().filter((p) => wanted.size === 0 || wanted.has(p.ns) || wanted.has(p.dir))
const notes = []
const drift = []

for (const p of packages) {
  const { src, dirs, pairs, skipped } = planFor(p)
  if (!fs.existsSync(src)) {
    console.log(`[vendor] ${p.dir}: not in this repository yet, skipped`)
    continue
  }
  if (skipped.length) notes.push(`${p.dir}: not copied (only .ts and .tsx are): ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? "..." : ""}`)
  const expected = new Map(pairs.map(([from, to]) => [path.join(appSrc, to), contentOf(p, src, from, to)]))

  if (check) {
    for (const [dst, content] of expected) {
      if (!fs.existsSync(dst)) drift.push(`missing ${path.relative(appSrc, dst)}`)
      else if (withoutBanner(fs.readFileSync(dst, "utf8")) !== withoutBanner(content)) drift.push(`stale ${path.relative(appSrc, dst)}`)
    }
    for (const file of walk(appSrc)) if (isVendoredBy(file, p) && !expected.has(file)) drift.push(`left over ${path.relative(appSrc, file)}`)
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
  for (const [dst, content] of expected) {
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.writeFileSync(dst, content)
  }
  /* Empty folders left by removed plugin files, only inside the plugin's own folders. */
  for (const d of dirs) removeEmptyDirs(path.join(appSrc, d))
  console.log(`[vendor] ${p.dir}@${p.version}: ${pairs.length} files copied, ${removed} old copies removed`)

  if (pairs.some(([, to]) => to === `api/${p.ns}-middlewares.ts`)) {
    const appMw = path.join(appSrc, "api/middlewares.ts")
    const text = fs.existsSync(appMw) ? fs.readFileSync(appMw, "utf8") : ""
    if (!text.includes(`./${p.ns}-middlewares`)) {
      notes.push(`src/api/middlewares.ts: import ${p.ns}Middlewares from "./${p.ns}-middlewares" and spread ...(${p.ns}Middlewares.routes ?? []) into routes.`)
    }
  }
  const config = path.resolve(process.cwd(), target, "medusa-config.ts")
  if (fs.existsSync(config) && !fs.readFileSync(config, "utf8").includes(`./src/modules/${p.moduleDir}"`)) {
    notes.push(`medusa-config.ts: modules: [{ resolve: "./src/modules/${p.moduleDir}", options: { ... } }] (${p.title})`)
  }
}

function removeEmptyDirs(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return
  for (const entry of fs.readdirSync(dir)) removeEmptyDirs(path.join(dir, entry))
  if (dir !== appSrc && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
}

/* The host side of the kit. */
if (hostWanted && wanted.size === 0) {
  for (const [to, content] of hostFiles()) {
    const dst = path.join(appSrc, to)
    if (check) {
      if (!fs.existsSync(dst)) drift.push(`missing ${to}`)
      else if (withoutBanner(fs.readFileSync(dst, "utf8")) !== withoutBanner(content)) drift.push(`stale ${to}`)
      continue
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.writeFileSync(dst, content)
  }
  if (!check) console.log(`[vendor] host side of kit ${KIT_VERSION}: admin/lib/koda-contract.ts, koda-registry.tsx, koda-host.tsx`)
  if (widgetsDir !== "admin/widgets") notes.push(`koda-vendor.json: with "host": true the widgets can go back to admin/widgets (drop widgetsDir); hosted zones keep them out of Medusa's own spots.`)
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
    " * Admin translations, one namespace per integration or app module, so they never collide",
    " * with the dashboard or each other. Components read them with",
    ' * `useTranslation("<namespace>")`.',
    " */",
    "export default {",
    `  en: { ${namespaces.map((ns) => `${JSON.stringify(ns)}: ${camel(ns)}En`).join(", ")} },`,
    `  pl: { ${namespaces.map((ns) => `${JSON.stringify(ns)}: ${camel(ns)}Pl`).join(", ")} },`,
    "}",
    "",
  ]
  const indexFile = path.join(i18nDir, "index.ts")
  if (check) {
    if (!fs.existsSync(indexFile) || fs.readFileSync(indexFile, "utf8") !== lines.join("\n")) drift.push("stale admin/i18n/index.ts")
  } else {
    fs.writeFileSync(indexFile, lines.join("\n"))
    console.log(`[vendor] admin/i18n/index.ts: ${namespaces.join(", ")}`)
  }
}

if (check) {
  if (drift.length) {
    console.error(`[vendor --check] the app is not current (${drift.length}):\n- ${drift.slice(0, 40).join("\n- ")}\nRun npm run vendor.`)
    process.exit(1)
  }
  console.log(`[vendor --check] ${packages.length} plugins current in ${target}`)
  process.exit(0)
}

if (notes.length > 0) {
  console.log("\nStill to do in the app:")
  for (const n of notes) console.log(`- ${n}`)
  console.log("Then: npx medusa db:migrate")
}
