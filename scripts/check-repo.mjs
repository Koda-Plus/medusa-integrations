#!/usr/bin/env node
/**
 * The rules of the whole monorepo, checked in one place (npm run check runs
 * it; CI too):
 *
 *   node scripts/check-repo.mjs            errors fail, warnings are listed
 *   node scripts/check-repo.mjs --strict   warnings fail too (before a release)
 *   node scripts/check-repo.mjs --app ../koda-plus-demo/medusa-backend
 *                                          also the migration names of an app the plugins are vendored into
 *
 * Errors: a migration name used twice (Medusa records migrations by name in
 * one table, so the second never runs), a file outside its namespace folder
 * without the namespace prefix (the vendor script relies on it), an en dash,
 * em dash or middle dot anywhere in the copy, a table or a relative link in
 * a README (npm and medusajs.com render it outside the repo), catalog
 * keywords that do not match the package kind, a Discord invite code (it
 * expires; https://koda.plus/discord is ours), a secret-looking value, a
 * missing LICENSE or TRADEMARKS.md.
 * Warnings: e-mail domains outside RFC 2606 in examples and tests, numbers
 * that pass the NIP checksum outside the allowlist.
 */
import fs from "node:fs"
import path from "node:path"
import { listPackages, root } from "./lib/packages.mjs"

const argv = process.argv.slice(2)
const strict = argv.includes("--strict")
const appAt = argv.indexOf("--app")
const app = appAt >= 0 ? path.resolve(process.cwd(), argv[appAt + 1] ?? "") : null

const errors = []
const warnings = []
const err = (m) => errors.push(m)
const warn = (m) => warnings.push(m)
const rel = (f) => path.relative(root, f).split(path.sep).join("/")

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".medusa" || e.name.startsWith(".git")) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const packages = listPackages()
const DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014, 0xb7)}]`)
const TEXT = /\.(ts|tsx|mjs|js|json|md|yaml|yml)$/

/* 1. Migration names, unique across every package (and the app, if given). */
const migrations = new Map()
const addMigration = (file, owner) => {
  const name = path.basename(file).replace(/\.(ts|js)$/, "")
  if (!/^Migration/.test(name)) return
  const list = migrations.get(name) ?? []
  list.push(owner)
  migrations.set(name, list)
}
for (const p of packages) for (const f of walk(path.join(p.path, "src/modules"))) if (/\/migrations\/[^/]+\.ts$/.test(f.split(path.sep).join("/"))) addMigration(f, p.dir)
if (app) {
  for (const f of walk(path.join(app, "src/modules"))) {
    const unix = f.split(path.sep).join("/")
    if (!/\/migrations\/[^/]+\.ts$/.test(unix)) continue
    const head = fs.readFileSync(f, "utf8").slice(0, 200)
    if (head.startsWith("// VENDORED from Koda-Plus/medusa-integrations")) continue
    addMigration(f, `app:${path.relative(app, f)}`)
  }
}
for (const [name, owners] of migrations) if (owners.length > 1) err(`migration ${name} is used by ${owners.join(", ")}: Medusa would run only the first`)

for (const p of packages) {
  const files = walk(p.path).filter((f) => !rel(f).includes("/node_modules/"))

  /* 2. Namespace prefixes outside the namespace folders. */
  for (const d of ["jobs", "subscribers", "admin/widgets", "admin/lib"]) {
    const dir = path.join(p.path, "src", d)
    if (!fs.existsSync(dir)) continue
    for (const f of fs.readdirSync(dir)) if (!f.startsWith(`${p.ns}-`)) err(`${p.dir}/src/${d}/${f}: files here start with "${p.ns}-" (the vendor script copies by prefix)`)
  }
  for (const d of ["modules", "providers", "workflows", "admin/routes", "api/admin", "api/store", "api/hooks"]) {
    const dir = path.join(p.path, "src", d)
    if (!fs.existsSync(dir)) continue
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) if (f.isDirectory() && f.name !== p.ns && f.name !== p.moduleDir) err(`${p.dir}/src/${d}/${f.name}: folders here are named after the namespace (${p.ns})`)
  }

  /* 3. Copy: no en dash, em dash or middle dot. */
  for (const f of files) {
    if (!TEXT.test(f) || f.endsWith("package-lock.json")) continue
    const text = fs.readFileSync(f, "utf8")
    if (DASH.test(text)) err(`${rel(f)}: en dash, em dash or middle dot`)
    if (/discord\.gg\//i.test(text)) err(`${rel(f)}: a Discord invite code; link https://koda.plus/discord`)
  }

  /* 4. README: no tables, absolute links. */
  const readme = fs.readFileSync(path.join(p.path, "README.md"), "utf8")
  if (/^\s*\|.*\|\s*$/m.test(readme)) err(`${p.dir}/README.md: a table (medusajs.com flattens tables)`)
  const relative = [...readme.matchAll(/\]\((\.\/|\.\.\/|docs\/|LICENSE|CHANGELOG)[^)]*\)/g)].map((m) => m[0])
  if (relative.length) err(`${p.dir}/README.md: relative links ${relative.slice(0, 3).join(" ")} (use https://github.com/Koda-Plus/medusa-integrations/blob/main/packages/${p.dir}/...)`)

  /* 5. package.json for the Medusa catalog. */
  const kw = p.json.keywords ?? []
  if (!kw.includes("medusa-v2")) err(`${p.dir}: keywords need medusa-v2`)
  if (p.kind === "integration") {
    if (!kw.includes("medusa-plugin-integration")) err(`${p.dir}: an integration needs the keyword medusa-plugin-integration`)
    if (p.catalog && !kw.includes(`medusa-plugin-${p.catalog}`)) err(`${p.dir}: catalog keyword medusa-plugin-${p.catalog} missing`)
  } else if (kw.includes("medusa-plugin-integration")) {
    err(`${p.dir}: our own modules are not catalog integrations (medusajs.com lists only third-party services)`)
  }
  for (const field of ["name", "version", "description", "license", "repository", "homepage", "bugs", "files", "exports", "peerDependencies", "engines", "publishConfig"]) {
    if (p.json[field] === undefined) err(`${p.dir}/package.json: ${field} missing`)
  }
  if (Object.keys(p.json.dependencies ?? {}).length > 0) err(`${p.dir}: runtime dependencies (${Object.keys(p.json.dependencies).join(", ")}); everything is a peer`)
  if (!/npm run typecheck/.test(p.json.scripts?.prepublishOnly ?? "")) warn(`${p.dir}: prepublishOnly does not run the typecheck`)
  for (const f of ["LICENSE", "CHANGELOG.md", "README.md"]) if (!fs.existsSync(path.join(p.path, f))) err(`${p.dir}/${f} missing`)

  /* 6. Secrets (real-looking lengths; tests use shorter synthetic values). */
  const SECRET = [
    /\b(sk|rk)_live_[A-Za-z0-9]{24,}/,
    /\bwhsec_[A-Za-z0-9]{32,}/,
    /\bre_[A-Za-z0-9]{8}_[A-Za-z0-9]{20,}/,
    /\bgh[pousr]_[A-Za-z0-9]{36,}/,
    /\bnpm_[A-Za-z0-9]{36}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /xox[baprs]-[A-Za-z0-9-]{10,}/,
    /https:\/\/discord(app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{30,}/,
    /postgres(ql)?:\/\/[^:\s/]+:[^@\s]{6,}@(?!localhost|127\.0\.0\.1)[^\s/]+/,
  ]
  for (const f of files) {
    if (!TEXT.test(f) || f.endsWith("package-lock.json")) continue
    const text = fs.readFileSync(f, "utf8")
    for (const re of SECRET) if (re.test(text)) err(`${rel(f)}: looks like a secret (${re.source.slice(0, 30)})`)
  }

  /* 7. Example data: RFC 2606 domains, synthetic NIPs (warnings). */
  const NIP_OK = new Set(["1234563218", "0123456789", "1111111111"])
  const nipValid = (s) => {
    const w = [6, 5, 7, 2, 3, 4, 5, 6, 7]
    const d = s.split("").map(Number)
    const sum = w.reduce((a, x, i) => a + x * d[i], 0) % 11
    return sum !== 10 && sum === d[9]
  }
  for (const f of files) {
    if (!/\.(ts|tsx|md|json|yaml)$/.test(f) || f.endsWith("package-lock.json")) continue
    const r = rel(f)
    if (!/\/(test|contract|docs)\/|README\.md$|\/demo|example/i.test(r)) continue
    const text = fs.readFileSync(f, "utf8")
    for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) {
      const domain = m[1].toLowerCase()
      if (/(^|\.)example\.(com|org|net)$|\.example$|\.test$|\.invalid$|(^|\.)koda\.plus$|^users\.noreply\.github\.com$/.test(domain)) continue
      if (/\.(ts|tsx|js|mjs|json|md|png|svg)$/.test(domain)) continue
      warn(`${r}: example e-mail on a real domain (${domain}); use example.com or .test`)
      break
    }
    for (const m of text.matchAll(/(?<![\d-])(\d{10})(?![\d-])/g)) {
      if (!NIP_OK.has(m[1]) && nipValid(m[1]) && !/^0+$/.test(m[1])) {
        warn(`${r}: ${m[1].slice(0, 3)}******* passes the NIP checksum; use 1234563218 or a number outside the registry`)
        break
      }
    }
  }
}

/* 8. Repository files. */
for (const f of ["LICENSE", "TRADEMARKS.md", "README.md", "CLAUDE.md", ".nvmrc"]) if (!fs.existsSync(path.join(root, f))) err(`${f} missing in the repository root`)
for (const f of ["README.md", "CLAUDE.md", "TRADEMARKS.md"]) {
  const file = path.join(root, f)
  if (fs.existsSync(file) && DASH.test(fs.readFileSync(file, "utf8"))) err(`${f}: en dash, em dash or middle dot`)
}
for (const f of walk(path.join(root, "kit"))) if (TEXT.test(f) && DASH.test(fs.readFileSync(f, "utf8"))) err(`${rel(f)}: en dash, em dash or middle dot`)

for (const w of warnings) console.log(`warning: ${w}`)
for (const e of errors) console.error(`error: ${e}`)
const failed = errors.length > 0 || (strict && warnings.length > 0)
console.log(`\ncheck-repo: ${packages.length} packages, ${errors.length} error(s), ${warnings.length} warning(s)${strict ? " (strict)" : ""}`)
process.exit(failed ? 1 : 0)
