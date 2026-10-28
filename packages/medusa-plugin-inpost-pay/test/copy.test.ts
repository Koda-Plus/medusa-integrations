/**
 * The copy: the Polish dictionary has the same keys and placeholders as the
 * English one, no dash used as punctuation and no middle dot anywhere in the
 * package, every file outside the namespace folders carries the namespace,
 * the demo texts say it is a simulation, and the admin draws no InPost logo.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import en from "../src/admin/i18n/en.ts"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const FORBIDDEN = new RegExp(`[${String.fromCharCode(0x2013, 0x2014, 0xb7)}]`)

function absoluteImport(spec: string): string {
  const base = join(root, "src/admin/i18n", spec)
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), base]) if (existsSync(candidate)) return pathToFileURL(candidate).href
  return spec
}

/** The Polish dictionary without the typesetting (the kit is a .tsx file node --test cannot load). */
async function loadPl(): Promise<unknown> {
  const text = readFileSync(join(root, "src/admin/i18n/pl.ts"), "utf8")
    .replace(/from "(\.\.?\/[^"]+)"/g, (_m: string, spec: string) => (spec === "./en" ? `from "${spec}"` : `from "${absoluteImport(spec)}"`))
    .replace(/^import \{ typeset \} from .*$/m, "")
    .replace(/export default typeset\(pl\)\s*$/, "export default pl\n")
  const dir = mkdtempSync(join(tmpdir(), "inpostpay-pl-"))
  const file = join(dir, "pl.ts")
  writeFileSync(file, text)
  try {
    return ((await import(pathToFileURL(file).href)) as { default: unknown }).default
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
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

const placeholders = (s: string) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort()
const PLURAL = /_(one|few|many|other)$/

function files(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) files(full, out)
    else if (/\.(ts|tsx|mjs|md|json)$/.test(name)) out.push(full)
  }
  return out
}

test("copy: Polish has every English key with the same placeholders", async () => {
  const enMap = leaves(en as unknown as Tree)
  const plMap = leaves((await loadPl()) as Tree)
  const base = (k: string) => k.replace(PLURAL, "")
  const plBase = new Set([...plMap.keys()].map(base))
  for (const [k, v] of enMap) {
    assert.ok(plBase.has(base(k)), `pl is missing ${k}`)
    const pv = plMap.get(k)
    if (pv !== undefined) assert.deepEqual(placeholders(pv).filter((p) => p !== "count"), placeholders(v).filter((p) => p !== "count"), `placeholders of ${k}`)
  }
  for (const k of plMap.keys()) assert.ok(enMap.has(k) || [...enMap.keys()].some((e) => base(e) === base(k)), `pl has an extra key ${k}`)
})

test("copy: no en dash, em dash or middle dot anywhere in the package", () => {
  for (const f of [...files(join(root, "src")), ...files(join(root, "test")), join(root, "README.md"), join(root, "CHANGELOG.md"), join(root, "package.json")]) {
    if (!existsSync(f)) continue
    assert.ok(!FORBIDDEN.test(readFileSync(f, "utf8")), `${relative(root, f)} has a dash or a middle dot`)
  }
})

test("copy: files outside the namespace folders carry the namespace", () => {
  for (const d of ["jobs", "subscribers", "admin/widgets", "admin/lib"]) {
    const dir = join(root, "src", d)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) assert.ok(f.startsWith("inpostpay-"), `${d}/${f}`)
  }
})

test("copy: the demo says it is a simulation, in both languages", async () => {
  const pl = (await loadPl()) as { demo: { text: string }; mode: { demo: string } }
  assert.match(en.demo.text, /simulation/i)
  assert.match(en.mode.demo, /simulation/i)
  assert.match(pl.demo.text, /symulacj/i)
  assert.match(pl.mode.demo, /symulacj/i)
})

test("branding: the admin icon is the InPost Pay mark (yellow crescent, pink Pay) on a white tile", () => {
  const icon = readFileSync(join(root, "src/admin/lib/inpostpay-icon.tsx"), "utf8")
  assert.ok(/#FFCC05/i.test(icon), "the crescent keeps InPost's yellow")
  assert.ok(/#FF2B7E/i.test(icon), "\"Pay\" keeps InPost Pay's pink")
  assert.ok(/trademarks of their owner/.test(icon), "the trademark note stays with the mark")
})
