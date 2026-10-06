/**
 * The house rules of the copy and of the monorepo: no dash used as
 * punctuation and no middle dot anywhere, the Polish dictionary typeset, the
 * page kit identical to the one of the other Koda Plus integrations, the
 * migration name unique across the packages.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { FORBIDDEN } from "./helpers.ts"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

function files(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) files(full, out)
    else if (/\.(ts|tsx|md|json)$/.test(name)) out.push(full)
  }
  return out
}

test("no en dash, em dash or middle dot in the sources, the README, the changelog or the docs", () => {
  const checked = [...files(join(root, "src")), ...files(join(root, "docs")), join(root, "README.md"), join(root, "CHANGELOG.md"), join(root, "package.json")]
  const offenders = checked.filter((f) => FORBIDDEN.test(readFileSync(f, "utf8"))).map((f) => relative(root, f))
  assert.deepEqual(offenders, [])
})

test("the Polish dictionary is typed by the English one and typeset", () => {
  const pl = readFileSync(join(root, "src/admin/i18n/pl.ts"), "utf8")
  assert.match(pl, /const pl: typeof en = \{/)
  assert.match(pl.trimEnd(), /export default typeset\(pl\)$/)
  assert.match(pl, /from "\.\.\/lib\/emails-guide"/)
})

test("both dictionaries carry the shared community block of the Koda Plus integrations", () => {
  for (const lang of ["en", "pl"]) {
    const text = readFileSync(join(root, `src/admin/i18n/${lang}.ts`), "utf8")
    for (const key of ["addStore:", "prompt:", "discord:", "greeting:", "failed:"]) assert.ok(text.includes(key), `${lang}: ${key}`)
  }
})

test("the page kit is a byte for byte copy of the kit of the other integrations, never edited here", () => {
  const md5 = (file: string) => createHash("md5").update(readFileSync(file)).digest("hex")
  const mine = md5(join(root, "src/admin/lib/emails-guide.tsx"))
  const siblings = join(root, "..")
  const theirs: string[] = []
  for (const dir of existsSync(siblings) ? readdirSync(siblings) : []) {
    const libDir = join(siblings, dir, "src/admin/lib")
    if (dir === "medusa-plugin-emails" || !existsSync(libDir)) continue
    for (const f of readdirSync(libDir).filter((n) => n.endsWith("-guide.tsx"))) theirs.push(md5(join(libDir, f)))
  }
  /* While a kit change is copied from package to package, the packages differ for a moment: this copy must equal one of them. */
  if (theirs.length > 0) assert.ok(theirs.includes(mine), `emails-guide.tsx (${mine}) matches no other package: copy the kit, never edit it here`)
})

test("every file outside the namespace folders carries the namespace prefix, as the copy script expects", () => {
  for (const dir of ["jobs", "subscribers", "admin/widgets", "admin/lib"]) {
    for (const name of readdirSync(join(root, "src", dir))) assert.ok(name.startsWith("emails-"), `${dir}/${name}`)
  }
})

test("the migration name is unique across the packages of the monorepo", () => {
  const mine = readdirSync(join(root, "src/modules/emails/migrations"))
  assert.deepEqual(mine, ["Migration20261007110000.ts"])
  const siblings = join(root, "..")
  for (const dir of existsSync(siblings) ? readdirSync(siblings) : []) {
    if (dir === "medusa-plugin-emails") continue
    const modules = join(siblings, dir, "src/modules")
    if (!existsSync(modules)) continue
    for (const m of readdirSync(modules)) {
      const migrations = join(modules, m, "migrations")
      if (!existsSync(migrations)) continue
      for (const f of readdirSync(migrations)) assert.ok(!mine.includes(f), `${dir}/${m}/${f} has the same name`)
    }
  }
})
