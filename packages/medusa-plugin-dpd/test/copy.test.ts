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
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import en from "../src/admin/i18n/en.ts"
import { LABEL_PAGES, MODES, SHIPMENT_STAGES, SHIPMENT_STATES, TRACKING_MODES } from "../src/modules/dpd/lib/constants.ts"
import { SHIPMENT_GROUPS } from "../src/modules/dpd/lib/contract.ts"
import { WRITERS } from "../src/modules/dpd/lib/writers.ts"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const FORBIDDEN = new RegExp(`[${String.fromCharCode(0x2013, 0x2014, 0xb7)}]`)

/** A relative import of pl.ts as an absolute file URL, so the copy in a temp folder still finds the kit and the texts. */
function absoluteImport(spec: string): string {
  const base = join(root, "src/admin/i18n", spec)
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), base]) if (existsSync(candidate)) return pathToFileURL(candidate).href
  return spec
}

/**
 * The Polish dictionary without the typesetting (the kit is a .tsx file,
 * which `node --test` cannot load): the same object, read from a copy of
 * the file with the import and the typeset call taken out.
 */
async function loadPl(): Promise<unknown> {
  const text = readFileSync(join(root, "src/admin/i18n/pl.ts"), "utf8")
    .replace(/from "(\.\.?\/[^"]+)"/g, (_m: string, spec: string) => (spec === "./en" ? `from "${spec}"` : `from "${absoluteImport(spec)}"`))
    .replace(/^import \{ typeset \} from .*$/m, "")
    .replace(/export default typeset\(pl\)\s*$/, "export default pl\n")
  const dir = mkdtempSync(join(tmpdir(), "dpd-pl-"))
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

/** The README and the changelog, where they exist (the README comes with a later stage). */
const docs = () => [join(root, "README.md"), join(root, "CHANGELOG.md")].filter((f) => existsSync(f))

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

/** The members of a one line string union type, read from the source (the sender problem codes are a type, not a value). */
function unionMembers(file: string, name: string): string[] {
  const text = readFileSync(join(root, file), "utf8")
  const start = text.indexOf(`export type ${name} =`)
  assert.ok(start >= 0, name)
  const line = text.slice(start).split("\n")[0]
  return [...line.matchAll(/"([a-z_]+)"/g)].map((m) => m[1])
}

/** The members of a string union type spread over several lines (`export type X =` then `| "a"` per line), read from the source. */
function multilineUnion(file: string, name: string): string[] {
  const text = readFileSync(join(root, file), "utf8")
  const start = text.indexOf(`export type ${name} =`)
  assert.ok(start >= 0, name)
  const body = text.slice(start).split(/\n\s*\n/)[0]
  return [...body.matchAll(/"([a-z_]+)"/g)].map((m) => m[1])
}

/** The row problem codes the plugin records: every checkout check of option-data.ts and every sample problem of demo.ts. */
function problemCodes(): string[] {
  const checkout = multilineUnion("src/modules/dpd/lib/option-data.ts", "CheckoutErrorCode")
  const demo = [...readFileSync(join(root, "src/modules/dpd/lib/demo.ts"), "utf8").matchAll(/problems: \[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/code: "([a-z_]+)"/g)].map((x) => x[1]))
  return [...new Set([...checkout, ...demo])]
}

/** A file written by scripts/kit.mjs: its words come from the plugin through props, never through t(). */
const generated = (f: string) => readFileSync(f, "utf8").startsWith("// GENERATED")

test("no en dash, em dash or middle dot in the sources, the tests, the README, the changelog or the docs", () => {
  const checked = [...files(join(root, "src")), ...files(join(root, "test")), ...files(join(root, "docs")), ...docs(), join(root, "package.json")]
  const offenders = checked.filter((f) => FORBIDDEN.test(readFileSync(f, "utf8"))).map((f) => relative(root, f))
  assert.deepEqual(offenders, [])
})

test("the Polish dictionary is typed by the English one and typeset", () => {
  const text = readFileSync(join(root, "src/admin/i18n/pl.ts"), "utf8")
  assert.match(text, /const pl: typeof en = \{/)
  assert.match(text.trimEnd(), /export default typeset\(pl\)$/)
  assert.match(text, /from "\.\.\/lib\/dpd-guide"/)
  /* Polish with its letters, never stripped to ASCII. */
  for (const word of ["Przesyłki", "Ustawienia", "wdrożenia", "Doręczona", "Zwroty", "pobraniem", "Nadawca"]) assert.ok(text.includes(word), word)
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
  /* A Polish text equal to the English one would be an untranslated string. */
  const same = [...e.entries()].filter(([k, v]) => v.length > 25 && p.get(k) === v).map(([k]) => k)
  assert.deepEqual(same, [])
})

/** The quoted members of the first `field: "a" | "b"` of a file (the unit, the source, the history kinds are inline unions). */
function fieldUnion(file: string, field: string): string[] {
  const text = readFileSync(join(root, file), "utf8")
  const m = text.match(new RegExp(`\\b${field}: ("[A-Za-z_]+"(?: \\| (?:"[A-Za-z_]+"|string))+)`))
  assert.ok(m, `${file}: ${field}`)
  return [...m[1].matchAll(/"([A-Za-z_]+)"/g)].map((x) => x[1])
}

/** The members of a `const NAME = [...] as const` of an admin file (.tsx, which `node --test` cannot import). */
function constList(file: string, name: string): string[] {
  const text = readFileSync(join(root, file), "utf8")
  const m = text.match(new RegExp(`const ${name} = \\[([^\\]]*)\\] as const`))
  assert.ok(m, `${file}: ${name}`)
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
}

/** Dotted literals of the admin that are not keys of the dictionary: the widget zone and the id hosts know the card by. */
const NOT_KEYS = new Set(["order.details", "order.details.side.after", "dpd.order"])

test("every string the admin asks for exists in both dictionaries: every key literal and every dynamic key", async () => {
  const dicts = [["en", leaves(en as unknown as Tree)], ["pl", leaves((await loadPl()) as Tree)]] as const
  const has = (d: Map<string, string>, key: string) => d.has(key) || d.has(`${key}_one`)
  const admin = files(join(root, "src/admin"), [], /\.(ts|tsx)$/).filter((f) => !f.includes(join("admin", "i18n")) && !generated(f))
  const missing: string[] = []
  const shapes = new Map<string, string>()
  for (const f of admin) {
    const text = readFileSync(f, "utf8")
    const where = relative(root, f)
    /* A one word key is only ever a t() argument: t("title"), t("loading"). */
    for (const m of text.matchAll(/\bt\(\s*(["'`])([a-z]\w*)\1/g)) for (const [lang, d] of dicts) if (!has(d, m[2])) missing.push(`${lang} ${where}: ${m[2]}`)
    /* Every quoted literal shaped like a key, wherever it stands: t("..."), the p("...") of the guide, both sides of a ternary, a variable. */
    for (const m of text.matchAll(/(["'`])([a-z]+(?:\.\w+)+)\1/g)) {
      if (NOT_KEYS.has(m[2])) continue
      for (const [lang, d] of dicts) if (!has(d, m[2])) missing.push(`${lang} ${where}: ${m[2]}`)
    }
    /* A key built from a value, like `state.${s.state}` or `guide.faq.${k}.q`: its shape must be enumerated below. */
    for (const m of text.matchAll(/`([a-z]+(?:\.\w+)*)\.\$\{[^}`]+\}((?:\.\w+)*)`/g)) shapes.set(`${m[1]}.*${m[2]}`, where)
  }
  assert.deepEqual(missing, [])

  const faq = constList("src/admin/lib/dpd-guide-view.tsx", "FAQ_KEYS")
  /* The problem codes the plugin records on a row; the panel would otherwise show the bare code. */
  const problems = problemCodes()
  const modeKeys = [...(readFileSync(join(root, "src/admin/lib/dpd-ui.tsx"), "utf8").match(/function modeOf[^{]*\{ key: ([^;]+);/)?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1])
  const DYNAMIC: Record<string, readonly string[]> = {
    "state.*": SHIPMENT_STATES,
    "stage.*": SHIPMENT_STAGES,
    "shipments.filter.*": ["all", ...SHIPMENT_GROUPS],
    "writers.names.*": WRITERS,
    "writers.descriptions.*": WRITERS,
    "mode.*": [...new Set([...MODES, ...modeKeys])],
    "kind.*": unionMembers("src/modules/dpd/lib/constants.ts", "OptionKind"),
    "problem.*": problems,
    "sender.problem.*": unionMembers("src/modules/dpd/lib/sender.ts", "SenderProblemCode"),
    "sender.fields.*": ["company", "name", "fullName", "phone", "email", "street", "city", "postalCode", "countryCode"],
    "account.labelPages.*": LABEL_PAGES,
    "account.tracking.*": TRACKING_MODES,
    "account.units.*": fieldUnion("src/modules/dpd/lib/contract.ts", "weightUnit"),
    "account.source.*": fieldUnion("src/modules/dpd/lib/contract.ts", "labelPage"),
    "history.kinds.*": fieldUnion("src/modules/dpd/lib/contract.ts", "kind"),
    "guide.intro.needs.*": constList("src/admin/lib/dpd-guide-view.tsx", "NEEDS"),
    "guide.faq.*.q": faq,
    "guide.faq.*.a": faq,
  }
  assert.deepEqual([...shapes.keys()].filter((k) => !(k in DYNAMIC)).map((k) => `${shapes.get(k)}: ${k}`), [], "a dynamic key without its enumeration here")
  assert.ok(modeKeys.includes("notConfigured") && problems.length > 0 && faq.length > 0, "the enumerations read from the sources")
  for (const code of ["country_unsupported", "cod_country_unsupported", "cod_currency_unsupported", "address_incomplete", "pudo_missing", "pudo_invalid", "contact_missing", "cod_pickup_abroad", "weight_missing"]) assert.ok(problems.includes(code), `problem code read from the sources: ${code}`)
  const absent: string[] = []
  for (const [shape, names] of Object.entries(DYNAMIC)) {
    for (const n of names) for (const [lang, d] of dicts) if (!has(d, shape.replace("*", n))) absent.push(`${lang}: ${shape.replace("*", n)}`)
  }
  assert.deepEqual(absent, [])
})

test("both dictionaries carry the shared community block of the Koda Plus integrations, from the kit", () => {
  const kit = readFileSync(join(root, "src/admin/lib/dpd-kit-community.ts"), "utf8")
  for (const key of ["addStore:", "prompt:", "discord:", "greeting:", "failed:"]) assert.ok(kit.includes(key), `kit community: ${key}`)
  for (const lang of ["en", "pl"]) {
    const text = readFileSync(join(root, `src/admin/i18n/${lang}.ts`), "utf8")
    assert.ok(text.includes(`community: community${lang === "en" ? "En" : "Pl"},`), `${lang}: community from the kit`)
    assert.ok(text.includes(`integration: integration${lang === "en" ? "En" : "Pl"},`), `${lang}: integration texts`)
  }
})

test("the page kit is generated from kit/ and never edited here", () => {
  for (const name of ["dpd-guide.tsx", "dpd-blocks.tsx", "dpd-kit.tsx", "dpd-kit-community.ts"]) {
    assert.ok(generated(join(root, "src/admin/lib", name)), `${name} must come from npm run kit:sync`)
  }
  /* Inside the monorepo the kit itself says whether every copy is current. */
  const script = join(root, "../../scripts/kit.mjs")
  if (existsSync(script)) {
    const run = spawnSync(process.execPath, [script, "check", "--only", "dpd"], { encoding: "utf8" })
    assert.equal(run.status, 0, run.stderr || run.stdout)
  }
})

test("every file outside the namespace folders carries the namespace prefix, as the copy script expects", () => {
  for (const dir of ["jobs", "subscribers", "admin/widgets", "admin/lib"]) {
    const full = join(root, "src", dir)
    if (!existsSync(full)) continue
    for (const name of readdirSync(full)) assert.ok(name.startsWith("dpd-"), `${dir}/${name}`)
  }
  for (const dir of ["modules", "providers", "workflows", "admin/routes", "api/admin", "api/store", "api/hooks"]) {
    const full = join(root, "src", dir)
    if (!existsSync(full)) continue
    const names = readdirSync(full).filter((n) => statSync(join(full, n)).isDirectory())
    assert.deepEqual(names, ["dpd"], dir)
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
  for (const d of ["modules/dpd", "providers/dpd", "workflows/dpd", "api/admin/dpd", "api/store/dpd", "api/hooks/dpd", "admin/routes/dpd"]) {
    for (const f of files(join(src, d), [], /\.(ts|tsx)$/)) copied.add(resolve(f))
  }
  for (const d of ["jobs", "subscribers", "admin/widgets", "admin/lib"]) {
    if (!existsSync(join(src, d))) continue
    for (const f of readdirSync(join(src, d))) if (f.startsWith("dpd-")) copied.add(resolve(join(src, d, f)))
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

test("own tables and a migration name unique across the packages", () => {
  const mine = readdirSync(join(root, "src/modules/dpd/migrations"))
  assert.deepEqual(mine, ["Migration20261102120000_dpd.ts"])
  const migration = readFileSync(join(root, "src/modules/dpd/migrations", mine[0]), "utf8")
  const ours = ["dpd_dispatch", "dpd_document", "dpd_event", "dpd_setting", "dpd_shipment"]
  assert.deepEqual([...migration.matchAll(/create table if not exists "([a-z_]+)"/g)].map((m) => m[1]).sort(), ours)
  const models = files(join(root, "src/modules/dpd/models"), [], /\.ts$/)
  assert.deepEqual(models.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/\.define\("([a-z_]+)"/g)].map((m) => m[1])).sort(), ours)
  /* The class name is the file name: Medusa records migrations by it in one table shared by every package. */
  assert.match(migration, /export class Migration20261102120000_dpd extends Migration/)
  const siblings = join(root, "..")
  for (const dir of existsSync(siblings) ? readdirSync(siblings) : []) {
    if (dir === "medusa-plugin-dpd") continue
    const modules = join(siblings, dir, "src/modules")
    if (!existsSync(modules)) continue
    for (const m of readdirSync(modules)) {
      const migrations = join(modules, m, "migrations")
      if (!existsSync(migrations)) continue
      for (const f of readdirSync(migrations)) assert.ok(!mine.includes(f), `${dir}/${m}/${f} has the same name`)
    }
  }
})

test("no personal data in the public repository: e-mails are examples, no DPD credentials", () => {
  const checked = [...files(join(root, "src")), ...files(join(root, "test")), ...files(join(root, "docs")), ...docs()]
  const offenders: string[] = []
  for (const f of checked) {
    const text = readFileSync(f, "utf8")
    for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[a-z]{2,})/g)) {
      if (!/^(example\.(com|org|net)|koda\.plus)$/.test(m[1])) offenders.push(`${relative(root, f)}: ${m[0]}`)
    }
    /* A login or a password written next to its option name, outside the placeholders of the guide. */
    for (const m of text.matchAll(/\b(DPD_LOGIN|DPD_PASSWORD|DPD_MASTER_FID)=([^\s.][^\s]*)/g)) offenders.push(`${relative(root, f)}: ${m[1]}=${m[2].slice(0, 3)}...`)
  }
  assert.deepEqual(offenders, [])
})

test("the README has no tables and every section, once it exists", { skip: !existsSync(join(root, "README.md")) && "the README comes with a later stage" }, () => {
  const readme = readFileSync(join(root, "README.md"), "utf8")
  assert.ok(!readme.split("\n").some((l) => l.trimStart().startsWith("|")), "medusajs.com flattens tables")
  assert.ok(readme.startsWith("# DPD by Koda Plus\n"))
  for (const h of ["## What it does", "## Requirements", "## Installation", "## Configuration", "## Security and data", "## License", "## Changelog"]) {
    assert.ok(readme.includes(`\n${h}\n`), h)
  }
})

test("package.json: the version, the keywords of the Medusa catalog, the files", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string; version: string; keywords: string[]; files: string[]; koda: { ns: string } }
  assert.equal(pkg.name, "@koda-plus/medusa-plugin-dpd")
  assert.equal(pkg.koda.ns, "dpd")
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
  for (const k of ["medusa-v2", "medusa-plugin-integration", "medusa-plugin-shipping", "dpd", "dpd-pickup", "cash-on-delivery", "poland"]) assert.ok(pkg.keywords.includes(k), k)
  assert.ok(!pkg.keywords.includes("medusa-plugin-fulfillment"))
  assert.deepEqual(pkg.files, [".medusa/server", "README.md", "CHANGELOG.md", "LICENSE"])
  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8")
  /* The version has its CHANGELOG heading: "(unreleased)" until the release stamps the date. */
  const version = pkg.version.replace(/\./g, "\\.")
  assert.ok(new RegExp(`## ${version} \\((unreleased|\\d{4}-\\d{2}-\\d{2})\\)`).test(changelog), `CHANGELOG has no heading for ${pkg.version}`)
})
