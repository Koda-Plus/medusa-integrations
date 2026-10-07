/**
 * The house rules of the copy and of the monorepo: no dash used as
 * punctuation and no middle dot anywhere, the Polish dictionary typed by the
 * English one, typeset, with the same keys and placeholders, every string the
 * admin asks for present, the page kit identical to the one of the other Koda
 * Plus integrations, the namespace on every file the copy script picks, the
 * own tables and migration name, the README and package.json of the catalog,
 * and no personal data in the public repository.
 */
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import en from "../src/admin/i18n/en.ts"
import { KNOWN_STATUSES } from "../src/modules/inpost/lib/statuses.ts"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const FORBIDDEN = new RegExp(`[${String.fromCharCode(0x2013, 0x2014, 0xb7)}]`)

/**
 * The Polish dictionary without the typesetting (the kit is a .tsx file,
 * which `node --test` cannot load): the same object, read from a copy of
 * the file with the import and the typeset call taken out.
 */
/** A relative import of pl.ts as an absolute file URL, so the copy in a temp folder still finds the kit and the texts. */
function absoluteImport(spec: string): string {
  const base = join(root, "src/admin/i18n", spec)
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), base]) if (existsSync(candidate)) return pathToFileURL(candidate).href
  return spec
}

async function loadPl(): Promise<unknown> {
  const text = readFileSync(join(root, "src/admin/i18n/pl.ts"), "utf8")
    .replace(/from "(\.\.?\/[^"]+)"/g, (_m: string, spec: string) => (spec === "./en" ? `from "${spec}"` : `from "${absoluteImport(spec)}"`))
    .replace(/^import \{ typeset \} from .*$/m, "")
    .replace(/export default typeset\(pl\)\s*$/, "export default pl\n")
  const dir = mkdtempSync(join(tmpdir(), "inpost-pl-"))
  const file = join(dir, "pl.ts")
  writeFileSync(file, text)
  try {
    return ((await import(pathToFileURL(file).href)) as { default: unknown }).default
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function files(dir: string, out: string[] = [], pattern = /\.(ts|tsx|mjs|md|json)$/): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) files(full, out, pattern)
    else if (pattern.test(name)) out.push(full)
  }
  return out
}

type Tree = { [key: string]: string | Tree }

function leaves(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>()
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === "string") out.set(key, v)
    else for (const [kk, vv] of leaves(v, key)) out.set(kk, vv)
  }
  return out
}

/** The members of a string union type, read from the source (the plan codes are types, not values). */
function unionMembers(file: string, name: string): string[] {
  const text = readFileSync(join(root, file), "utf8")
  const start = text.indexOf(`export type ${name} =`)
  assert.ok(start >= 0, name)
  const [first, ...rest] = text.slice(start).split("\n")
  const lines = [first]
  for (const line of rest) {
    if (!/^\s*\|/.test(line)) break
    lines.push(line)
  }
  return [...lines.join("\n").matchAll(/"([a-z_]+)"/g)].map((m) => m[1])
}

test("no en dash, em dash or middle dot in the sources, the tests, the README, the changelog or the docs", () => {
  const checked = [...files(join(root, "src")), ...files(join(root, "test")), ...files(join(root, "docs")), join(root, "README.md"), join(root, "CHANGELOG.md"), join(root, "package.json")]
  const offenders = checked.filter((f) => FORBIDDEN.test(readFileSync(f, "utf8"))).map((f) => relative(root, f))
  assert.deepEqual(offenders, [])
})

test("the Polish dictionary is typed by the English one and typeset", () => {
  const text = readFileSync(join(root, "src/admin/i18n/pl.ts"), "utf8")
  assert.match(text, /const pl: typeof en = \{/)
  assert.match(text.trimEnd(), /export default typeset\(pl\)$/)
  assert.match(text, /from "\.\.\/lib\/inpost-guide"/)
  /* Polish with its letters, never stripped to ASCII, and the brand as InPost writes it. */
  for (const word of ["Przesyłki", "Ustawienia", "wdrożenia", "Doręczona", "Zwrócona", "Paczkomacie", "pobraniem"]) assert.ok(text.includes(word), word)
  assert.ok(!/(?<![.\w])paczkoma/.test(text), "Paczkomat is a brand: capital P, except in the manager.paczkomaty.pl addresses")
})

test("both dictionaries have the same keys and the same placeholders, and Polish is translated", async () => {
  const e = leaves(en as unknown as Tree)
  const p = leaves((await loadPl()) as Tree)
  /* Polish has more plural forms (_few, _many) than English; the keys must match once those are set aside. */
  const plural = (k: string) => k.replace(/_(zero|one|two|few|many|other)$/, "_n")
  assert.deepEqual([...new Set([...p.keys()].map(plural))].sort(), [...new Set([...e.keys()].map(plural))].sort())
  const holes = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()
  const mismatched = [...e.entries()].filter(([k, v]) => p.has(k) && JSON.stringify(holes(v)) !== JSON.stringify(holes(p.get(k) ?? ""))).map(([k]) => k)
  assert.deepEqual(mismatched, [])
  /* A Polish text equal to the English one would be an untranslated string (host names repeat on purpose). */
  const same = [...e.entries()].filter(([k, v]) => v.length > 25 && p.get(k) === v && k !== "account.sandboxOn").map(([k]) => k)
  assert.deepEqual(same, [])
})

test("every string the admin asks for exists: static keys, statuses, plan problems and warnings, filters, writers", () => {
  const e = leaves(en as unknown as Tree)
  const admin = files(join(root, "src/admin"), [], /\.(ts|tsx)$/).filter((f) => !f.includes(`${join("admin", "i18n")}`) && !f.endsWith("inpost-guide.tsx"))
  const missing: string[] = []
  for (const f of admin) {
    for (const m of readFileSync(f, "utf8").matchAll(/\bt\(\s*(["'`])((?:(?!\1).)+)\1/g)) {
      const key = m[2]
      if (!key.includes("${") && !e.has(key)) missing.push(`${relative(root, f)}: ${key}`)
    }
  }
  assert.deepEqual(missing, [])
  const need = (prefix: string, names: readonly string[]) => names.filter((n) => !e.has(`${prefix}.${n}`)).map((n) => `${prefix}.${n}`)
  assert.deepEqual(need("status", KNOWN_STATUSES), [])
  assert.deepEqual(need("problem", unionMembers("src/modules/inpost/lib/plan.ts", "PlanProblemCode")), [])
  assert.deepEqual(need("warning", unionMembers("src/modules/inpost/lib/plan.ts", "PlanWarningCode")), [])
  assert.deepEqual(need("state", unionMembers("src/modules/inpost/lib/contract.ts", "ParcelState")), [])
  assert.deepEqual(need("parcels.filter", ["all", "to_create", "waiting", "in_transit", "in_locker", "delivered", "problems", "canceled", "skipped"]), [])
  assert.deepEqual(need("writers.names", ["shipment", "fulfillmentStatus"]), [])
  assert.deepEqual(need("writers.descriptions", ["shipment", "fulfillmentStatus"]), [])
  assert.deepEqual(need("sendingMethod", ["parcel_locker", "pok", "pop", "courier_pok", "branch", "dispatch_order", "any_point"]), [])
  /* Every action the server records reads in the admin language (a failed read after a webhook keeps ShipX's own words). */
  const actions = new Set<string>()
  for (const f of files(join(root, "src/workflows"), [], /\.ts$/)) for (const m of readFileSync(f, "utf8").matchAll(/action: "([a-z_]+)"/g)) actions.add(m[1])
  const lines = [...e.keys()].filter((k) => k.startsWith("history.actions.")).map((k) => k.slice("history.actions.".length))
  assert.deepEqual([...actions].filter((a) => a !== "webhook_read" && !lines.some((k) => k === a || k.startsWith(`${a}_`))), [])
})

test("both dictionaries carry the shared community block of the Koda Plus integrations, from the kit", () => {
  const kit = readFileSync(join(root, "src/admin/lib/inpost-kit-community.ts"), "utf8")
  for (const key of ["addStore:", "prompt:", "discord:", "greeting:", "failed:"]) assert.ok(kit.includes(key), `kit community: ${key}`)
  for (const lang of ["en", "pl"]) {
    const text = readFileSync(join(root, `src/admin/i18n/${lang}.ts`), "utf8")
    assert.ok(text.includes(`community: community${lang === "en" ? "En" : "Pl"},`), `${lang}: community from the kit`)
    for (const key of ["soonMore:", "badgeSoonOne:"]) assert.ok(text.includes(key), `${lang}: ${key}`)
  }
})

test("the page kit is generated from kit/ and never edited here", () => {
  const text = readFileSync(join(root, "src/admin/lib/inpost-guide.tsx"), "utf8")
  assert.ok(text.startsWith("// GENERATED from kit/admin/guide.tsx"), "inpost-guide.tsx must come from npm run kit:sync")
  /* Inside the monorepo the kit itself says whether every copy is current. */
  const script = join(root, "../../scripts/kit.mjs")
  if (existsSync(script)) {
    const run = spawnSync(process.execPath, [script, "check", "--only", "inpost"], { encoding: "utf8" })
    assert.equal(run.status, 0, run.stderr || run.stdout)
  }
})

test("every file outside the namespace folders carries the namespace prefix, as the copy script expects", () => {
  for (const dir of ["jobs", "subscribers", "admin/widgets", "admin/lib"]) {
    for (const name of readdirSync(join(root, "src", dir))) assert.ok(name.startsWith("inpost-"), `${dir}/${name}`)
  }
  for (const dir of ["modules", "providers", "workflows", "admin/routes", "api/admin", "api/store", "api/hooks"]) {
    const names = readdirSync(join(root, "src", dir)).filter((n) => statSync(join(root, "src", dir, n)).isDirectory())
    assert.deepEqual(names, ["inpost"], dir)
  }
  /* API routes import the plugin's own folders only: the copy script does not carry src/workflows/index.ts. */
  for (const f of files(join(root, "src/api"))) {
    const text = readFileSync(f, "utf8")
    assert.ok(!/from "(\.\.\/)+workflows"/.test(text), relative(root, f))
  }
})

test("a vendored copy is complete: every relative import of a copied file lands on a copied file", () => {
  const src = join(root, "src")
  const copied = new Set<string>()
  for (const d of ["modules/inpost", "providers/inpost", "workflows/inpost", "api/admin/inpost", "api/store/inpost", "api/hooks/inpost", "admin/routes/inpost"]) {
    for (const f of files(join(src, d), [], /\.(ts|tsx)$/)) copied.add(resolve(f))
  }
  for (const d of ["jobs", "subscribers", "admin/widgets", "admin/lib"]) {
    for (const f of readdirSync(join(src, d))) if (f.startsWith("inpost-")) copied.add(resolve(join(src, d, f)))
  }
  for (const lang of ["en", "pl"]) copied.add(resolve(join(src, `admin/i18n/${lang}.ts`)))
  const broken: string[] = []
  for (const file of copied) {
    for (const m of readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*"(\.{1,2}\/[^"]+)"/g)) {
      const base = resolve(dirname(file), m[1])
      const target = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((c) => existsSync(c) && statSync(c).isFile())
      if (!target || !copied.has(target)) broken.push(`${relative(root, file)} -> ${m[1]}`)
    }
  }
  assert.deepEqual(broken, [])
})

test("own tables and a migration name unique across the packages; never the tables of another InPost plugin", () => {
  const mine = readdirSync(join(root, "src/modules/inpost/migrations"))
  assert.deepEqual(mine, ["Migration20261007120000.ts"])
  const migration = readFileSync(join(root, "src/modules/inpost/migrations", mine[0]), "utf8")
  const ours = ["inpost_parcel", "inpost_parcel_event", "inpost_setting"]
  assert.deepEqual([...migration.matchAll(/create table if not exists "([a-z_]+)"/g)].map((m) => m[1]).sort(), ours)
  const models = files(join(root, "src/modules/inpost/models"), [], /\.ts$/)
  assert.deepEqual(models.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/\.define\("([a-z_]+)"/g)].map((m) => m[1])).sort(), ours)
  /* inpost_shipment may appear as a metadata key another system writes, never as a table. */
  for (const f of files(join(root, "src"), [], /\.(ts|tsx)$/)) {
    assert.ok(!/(from|into|update|table( if (not )?exists)?)\s+"?inpost_(shipment|return)/i.test(readFileSync(f, "utf8")), `${relative(root, f)} touches a table of another plugin`)
  }
  const siblings = join(root, "..")
  for (const dir of existsSync(siblings) ? readdirSync(siblings) : []) {
    if (dir === "medusa-plugin-inpost") continue
    const modules = join(siblings, dir, "src/modules")
    if (!existsSync(modules)) continue
    for (const m of readdirSync(modules)) {
      const migrations = join(modules, m, "migrations")
      if (!existsSync(migrations)) continue
      for (const f of readdirSync(migrations)) assert.ok(!mine.includes(f), `${dir}/${m}/${f} has the same name`)
    }
  }
})

test("no personal data in the public repository: e-mails are examples, no API tokens", () => {
  const checked = [...files(join(root, "src")), ...files(join(root, "test")), ...files(join(root, "docs")), join(root, "README.md"), join(root, "CHANGELOG.md")]
  const offenders: string[] = []
  for (const f of checked) {
    const text = readFileSync(f, "utf8")
    for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[a-z]{2,})/g)) {
      if (!/^(example\.(com|org|net)|koda\.plus)$/.test(m[1])) offenders.push(`${relative(root, f)}: ${m[0]}`)
    }
    /* A ShipX token is a JWT: three base64url parts, the first one starting with eyJ. */
    for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
      if (!f.endsWith("helpers.ts")) offenders.push(`${relative(root, f)}: ${m[0].slice(0, 12)}...`)
    }
  }
  assert.deepEqual(offenders, [])
})

test("the README has no tables, the hero image, the live demo and every section", () => {
  const readme = readFileSync(join(root, "README.md"), "utf8")
  assert.ok(!readme.split("\n").some((l) => l.trimStart().startsWith("|")), "medusajs.com flattens tables")
  assert.ok(readme.startsWith("# InPost by Koda Plus\n"))
  assert.ok(readme.includes("![InPost page in the Medusa admin](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-inpost/docs/admin-inpost.png)"))
  assert.ok(readme.includes("https://medusa.koda.plus/app/inpost?demo=en"))
  for (const h of ["## What it does", "## Features", "## Requirements", "## Installation", "## Configuration", "## Storefront", "## Store API", "## Webhook", "## Events", "## Setup in brief", "## Security and data", "## What this plugin does not do (yet)", "## Development", "## Commercial support", "## License", "## Changelog"]) {
    assert.ok(readme.includes(`\n${h}\n`), h)
  }
  for (const word of ["machine_id", "machine_name", "machine_address", "inpost.shipment.created", "inpost.shipment.status_changed", "inpost.shipment.delivered", "skipMetadataKeys", "Geowidget"]) assert.ok(readme.includes(word), word)
})

test("package.json: the version, the keywords of the Medusa catalog, the files", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string; version: string; keywords: string[]; files: string[] }
  assert.equal(pkg.name, "@koda-plus/medusa-plugin-inpost")
  assert.equal(pkg.version, "0.1.0")
  for (const k of ["medusa-v2", "medusa-plugin-integration", "medusa-plugin-shipping", "inpost", "paczkomat", "shipx", "cash-on-delivery", "poland"]) assert.ok(pkg.keywords.includes(k), k)
  assert.ok(!pkg.keywords.includes("medusa-plugin-fulfillment"))
  assert.deepEqual(pkg.files, [".medusa/server", "README.md", "CHANGELOG.md", "LICENSE"])
  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8")
  assert.ok(changelog.includes("## 0.1.0 (2026-10-07)"))
})
