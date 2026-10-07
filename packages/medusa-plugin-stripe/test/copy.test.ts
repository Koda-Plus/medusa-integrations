/**
 * The house rules of the copy and of the monorepo: no dash used as
 * punctuation and no middle dot anywhere, the Polish dictionary typed by the
 * English one, typeset, with the same keys and placeholders, the page kit
 * identical to the one of the other Koda Plus integrations, the namespace on
 * every file the copy script picks by name, and no tables (so no migration).
 */
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import en from "../src/admin/i18n/en.ts"

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
  const dir = mkdtempSync(join(tmpdir(), "stripe-pl-"))
  const file = join(dir, "pl.ts")
  writeFileSync(file, text)
  try {
    return ((await import(pathToFileURL(file).href)) as { default: unknown }).default
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function files(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) files(full, out)
    else if (/\.(ts|tsx|mjs|md|json)$/.test(name)) out.push(full)
  }
  return out
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
  assert.match(text, /from "\.\.\/lib\/stripe-guide"/)
  /* Polish with its letters, never stripped to ASCII. */
  for (const word of ["Płatności", "Ustawienia", "wdrożenia", "Zwroty", "Spór"]) assert.ok(text.includes(word), word)
})

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

test("both dictionaries have the same keys and the same placeholders", async () => {
  const e = leaves(en as unknown as Tree)
  const p = leaves((await loadPl()) as Tree)
  /* Polish has more plural forms (_few, _many) than English; the keys must match once those are set aside. */
  const plural = (k: string) => k.replace(/_(zero|one|two|few|many|other)$/, "_n")
  assert.deepEqual([...new Set([...p.keys()].map(plural))].sort(), [...new Set([...e.keys()].map(plural))].sort())
  const holes = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()
  const mismatched = [...e.entries()].filter(([k, v]) => p.has(k) && JSON.stringify(holes(v)) !== JSON.stringify(holes(p.get(k) ?? ""))).map(([k]) => k)
  assert.deepEqual(mismatched, [])
  /* A Polish text that is the English one, untranslated, would show up here (Stripe's endpoint and resource names repeat on purpose). */
  const names = /^(checksTab\.reads|access\.resource)\./
  const same = [...e.entries()].filter(([k, v]) => v.length > 25 && p.get(k) === v && !names.test(k)).map(([k]) => k)
  assert.deepEqual(same, [])
})

test("both dictionaries carry the shared community block of the Koda Plus integrations, from the kit", () => {
  const kit = readFileSync(join(root, "src/admin/lib/stripe-kit-community.ts"), "utf8")
  for (const key of ["addStore:", "prompt:", "discord:", "greeting:", "failed:"]) assert.ok(kit.includes(key), `kit community: ${key}`)
  for (const lang of ["en", "pl"]) {
    const text = readFileSync(join(root, `src/admin/i18n/${lang}.ts`), "utf8")
    assert.ok(text.includes(`community: community${lang === "en" ? "En" : "Pl"},`), `${lang}: community from the kit`)
    for (const key of ["soonMore:", "badgeSoonOne:"]) assert.ok(text.includes(key), `${lang}: ${key}`)
  }
})

test("the page kit is generated from kit/ and never edited here", () => {
  const text = readFileSync(join(root, "src/admin/lib/stripe-guide.tsx"), "utf8")
  assert.ok(text.startsWith("// GENERATED from kit/admin/guide.tsx"), "stripe-guide.tsx must come from npm run kit:sync")
  /* Inside the monorepo the kit itself says whether every copy is current. */
  const script = join(root, "../../scripts/kit.mjs")
  if (existsSync(script)) {
    const run = spawnSync(process.execPath, [script, "check", "--only", "stripe"], { encoding: "utf8" })
    assert.equal(run.status, 0, run.stderr || run.stdout)
  }
})

test("every file outside the namespace folders carries the namespace prefix, as the copy script expects", () => {
  for (const dir of ["jobs", "subscribers", "admin/widgets", "admin/lib"]) {
    const full = join(root, "src", dir)
    if (!existsSync(full)) continue
    for (const name of readdirSync(full)) assert.ok(name.startsWith("stripe-"), `${dir}/${name}`)
  }
  for (const dir of ["modules", "workflows", "admin/routes", "api/admin"]) {
    const names = readdirSync(join(root, "src", dir)).filter((n) => statSync(join(root, "src", dir, n)).isDirectory())
    assert.deepEqual(names, ["stripe"], dir)
  }
  /* API routes import the plugin's own folders only: the copy script does not carry src/workflows/index.ts. */
  for (const f of files(join(root, "src/api"))) {
    const text = readFileSync(f, "utf8")
    assert.ok(!/from "(\.\.\/)+workflows"/.test(text), relative(root, f))
  }
})

test("no tables, so no migration: the module keeps everything in memory", () => {
  assert.equal(existsSync(join(root, "src/modules/stripe/migrations")), false)
  assert.equal(existsSync(join(root, "src/modules/stripe/models")), false)
})

test("the README has no tables, the hero image, the live demo and every section", () => {
  const readme = readFileSync(join(root, "README.md"), "utf8")
  assert.ok(!readme.split("\n").some((l) => l.trimStart().startsWith("|")), "medusajs.com flattens tables")
  assert.ok(readme.startsWith("# Stripe by Koda Plus\n"))
  assert.ok(readme.includes("![Stripe page in the Medusa admin](https://raw.githubusercontent.com/Koda-Plus/medusa-integrations/main/packages/medusa-plugin-stripe/docs/admin-stripe.png)"))
  assert.ok(readme.includes("https://medusa.koda.plus/app/stripe?demo=en"))
  for (const h of ["## What it does", "## Features", "## Requirements", "## Installation", "## Configuration", "## Setup in brief", "## Security and data", "## What this plugin does not do", "## Development", "## Commercial support", "## License", "## Changelog"]) {
    assert.ok(readme.includes(`\n${h}\n`), h)
  }
})

test("package.json: the version, the keywords of the Medusa catalog, the files", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string; version: string; keywords: string[]; files: string[] }
  assert.equal(pkg.name, "@koda-plus/medusa-plugin-stripe")
  assert.equal(pkg.version, "0.1.0")
  for (const k of ["medusa-v2", "medusa-plugin-integration", "medusa-plugin-payment", "stripe", "blik", "przelewy24", "p24", "poland", "payments", "disputes", "payouts"]) assert.ok(pkg.keywords.includes(k), k)
  assert.deepEqual(pkg.files, [".medusa/server", "README.md", "CHANGELOG.md", "LICENSE"])
  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8")
  assert.ok(changelog.includes("## 0.1.0 (2026-10-07)"))
})
