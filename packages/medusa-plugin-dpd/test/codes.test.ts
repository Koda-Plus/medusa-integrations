/**
 * Every code the server can hand the admin has its words in both
 * dictionaries: the problems of a plan and of a DPD answer, the warnings of a
 * plan, the error codes kept on a row and the codes of a refused action. A
 * missing key would show the bare code to a warehouse.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import en from "../src/admin/i18n/en.ts"
import { ACTION_ERROR_CODES, SHIPMENT_ERROR_CODES } from "../src/modules/dpd/lib/contract.ts"
import { DPD_ERROR_CODES, DPD_PROBLEM_CODES } from "../src/modules/dpd/lib/dpd-answers.ts"
import { PLAN_PROBLEM_CODES, PLAN_WARNING_CODES } from "../src/modules/dpd/lib/plan.ts"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

type Tree = { [key: string]: string | Tree }

/**
 * The Polish dictionary without the typesetting (the kit is a .tsx file,
 * which `node --test` cannot load): the same object, read from a copy with
 * the typeset import and call taken out and the other imports made absolute.
 */
async function loadPl(): Promise<Tree> {
  const dir = join(root, "src/admin/i18n")
  const text = readFileSync(join(dir, "pl.ts"), "utf8")
    .replace(/^import \{ typeset \} from .*$/m, "")
    .replace(/from "(\.\.?\/[^"]+)"/g, (_m: string, spec: string) => {
      if (spec === "./en") return `from "${spec}"`
      const base = join(dir, spec)
      return `from "${pathToFileURL(base.endsWith(".ts") ? base : `${base}.ts`).href}"`
    })
    .replace(/export default typeset\(pl\)\s*$/, "export default pl\n")
  const tmp = mkdtempSync(join(tmpdir(), "dpd-codes-"))
  const file = join(tmp, "pl.ts")
  writeFileSync(file, text)
  try {
    return ((await import(pathToFileURL(file).href)) as { default: Tree }).default
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function section(tree: Tree, name: string): Record<string, string | Tree> {
  const value = tree[name]
  assert.ok(value && typeof value === "object", `the dictionary has the section ${name}`)
  return value
}

/** The codes of `codes` that have no non empty string under `section` in `tree`. */
function missing(tree: Tree, name: string, codes: readonly string[]): string[] {
  const s = section(tree, name)
  return codes.filter((c) => typeof s[c] !== "string" || (s[c] as string).trim() === "")
}

const CASES: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  ["plan problems", "problem", PLAN_PROBLEM_CODES],
  ["DPD answer problems", "problem", DPD_PROBLEM_CODES],
  ["plan warnings", "warning", PLAN_WARNING_CODES],
  ["row error codes", "errorCode", SHIPMENT_ERROR_CODES],
  ["action error codes", "actionError", ACTION_ERROR_CODES],
]

test("every plan problem, DPD problem, warning, row error code and action error code has an English text", () => {
  const tree = en as unknown as Tree
  for (const [what, name, codes] of CASES) assert.deepEqual(missing(tree, name, codes), [], `en ${what}`)
})

test("every plan problem, DPD problem, warning, row error code and action error code has a Polish text", async () => {
  const tree = await loadPl()
  for (const [what, name, codes] of CASES) assert.deepEqual(missing(tree, name, codes), [], `pl ${what}`)
})

/* Codes the server adds next to the lists above; listed here so their words exist before any list carries them. */
const ADDED_PROBLEMS = ["payer_fid_missing"] as const

test("the added problem codes have their words in both dictionaries", async () => {
  assert.deepEqual(missing(en as unknown as Tree, "problem", ADDED_PROBLEMS), [], "en")
  assert.deepEqual(missing(await loadPl(), "problem", ADDED_PROBLEMS), [], "pl")
})

/* Row error codes the server adds next to SHIPMENT_ERROR_CODES (the pacing of a click, which a person retries by hand); their words exist before the server writes them. */
const ADDED_ERROR_CODES = ["rate_limited", "rate_limited_manual"] as const

/** Every .ts file of the server: src without the admin. */
function serverFiles(dir = join(root, "src"), out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (full !== join(root, "src", "admin")) serverFiles(full, out)
    } else if (name.endsWith(".ts")) out.push(full)
  }
  return out
}

/** The code literals of an expression: every quoted snake case word that is not the right side of a comparison. */
function literals(expr: string): string[] {
  return [...expr.matchAll(/(?<![=!]=\s*)["']([a-z][a-z0-9_]*)["']/g)].map((m) => m[1])
}

/**
 * Every error code the server writes on a row, read from the sources: each
 * `error_code: ...` of an object, each `"error_code" = '...'` of the SQL,
 * the variable an `error_code: code` takes its value from, and the error of
 * a demo sample. A code written there without its words fails the test
 * below, even before it joins SHIPMENT_ERROR_CODES.
 */
function writtenErrorCodes(): Map<string, string> {
  const found = new Map<string, string>()
  for (const file of serverFiles()) {
    const text = readFileSync(file, "utf8")
    const where = relative(root, file)
    const add = (codes: string[]) => {
      for (const c of codes) if (!found.has(c)) found.set(c, where)
    }
    for (const m of text.matchAll(/\berror_code"?\s*(?::|=(?!=))\s*([^,}\n]+)/g)) {
      const expr = m[1].trim()
      add(literals(expr))
      /* error_code: code, where code is a const of the same file, maybe the answer of a function of the same file. */
      if (/^[A-Za-z_]\w*$/.test(expr) && expr !== "null") {
        for (const decl of text.matchAll(new RegExp(String.raw`\bconst ${expr}\b[^=\n]*=\s*([^\n]+)`, "g"))) {
          add(literals(decl[1]))
          for (const call of decl[1].matchAll(/\b([A-Za-z_]\w*)\(/g)) {
            const fn = text.match(new RegExp(String.raw`\bfunction ${call[1]}\b[^\n]*\)\s*:\s*([^\n{]+)\{([\s\S]*?)\n\}`))
            if (!fn) continue
            add(literals(fn[1]))
            for (const ret of fn[2].matchAll(/\breturn ([^\n]+)/g)) add(literals(ret[1]))
          }
        }
      }
    }
    for (const m of text.matchAll(/\berror: \{ code: "([a-z][a-z0-9_]*)"/g)) add([m[1]])
  }
  return found
}

test("every error code the server writes on a row, read from the sources, has its words in both dictionaries", async () => {
  const written = writtenErrorCodes()
  /* The scan reads the sources it should: a code of each kind of writer. */
  for (const code of ["rate_limited", "adopted", "waybill_count_mismatch", "duplicate_not_found", "label_unclear", "label_not_found", "lease_expired", "label_lease_expired", "abandoned_found", "timeout"]) {
    assert.ok(written.has(code), `read from the sources: ${code}`)
  }
  const all = [...new Set([...SHIPMENT_ERROR_CODES, ...DPD_ERROR_CODES, ...ADDED_ERROR_CODES, ...written.keys()])]
  const where = (c: string) => (written.has(c) ? `${c} (${written.get(c)})` : c)
  assert.deepEqual(missing(en as unknown as Tree, "errorCode", all).map(where), [], "en")
  assert.deepEqual(missing(await loadPl(), "errorCode", all).map(where), [], "pl")
})

test("the pacing codes read as DPD being busy, the one a person retries by hand with a minute to wait", async () => {
  const pl = await loadPl()
  const enCodes = section(en as unknown as Tree, "errorCode")
  const plCodes = section(pl, "errorCode")
  assert.equal(enCodes.rate_limited_manual, "DPD is busy: try again in a minute.")
  assert.equal(plCodes.rate_limited_manual, "DPD jest zajęty: spróbuj ponownie za minutę.")
  assert.equal(typeof enCodes.rate_limited, "string")
  assert.equal(typeof plCodes.rate_limited, "string")
})

test("every DPD error code is a value a row can keep", () => {
  const kept = new Set<string>(SHIPMENT_ERROR_CODES)
  assert.deepEqual(DPD_ERROR_CODES.filter((c) => !kept.has(c)), [])
})

test("the code lists have no duplicates", () => {
  for (const [what, , codes] of CASES) assert.equal(new Set(codes).size, codes.length, what)
})

test("the action errors live apart from the page error string, which stays a plain text", () => {
  const tree = en as unknown as Tree
  assert.equal(typeof tree.error, "string")
  assert.equal(typeof tree.actionError, "object")
})
