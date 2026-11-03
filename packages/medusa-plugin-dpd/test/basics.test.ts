/**
 * The small pure pieces and the frozen contracts: money in minor units,
 * masking, the provider id and option ids, the hosts, the groups of the
 * Panel, the event names, and the tables (every model column is in the
 * migration, the migration name is unique in the repository).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  COD_CURRENCIES,
  DPDSERVICES_HOSTS,
  DPD_MODULE,
  DPD_NS,
  INFOSERVICES_URL,
  LABEL_PAGES,
  MYPUDO_URL,
  OPTION_IDS,
  PROVIDER_IDENTIFIER,
  SHIPMENT_STAGES,
  SHIPMENT_STATES,
  isDpdProviderId,
} from "../src/modules/dpd/lib/constants.ts"
import { ATTENTION_GROUPS, SHIPMENT_GROUPS, groupOf } from "../src/modules/dpd/lib/contract.ts"
import { DPD_EVENTS } from "../src/modules/dpd/lib/events.ts"
import { decimalString, firstMinor, formatMinor, toMinor } from "../src/modules/dpd/lib/money.ts"
import { resolveOptions, secretsOf } from "../src/modules/dpd/lib/options.ts"
import { hint, maskSecrets, secretState } from "../src/modules/dpd/lib/security.ts"
import { API_KEY, PASSWORD, SANDBOX, setup } from "./helpers.ts"

const PKG = fileURLToPath(new URL("..", import.meta.url))

test("money: every shape Medusa uses becomes exact minor units, rounded half up at the second decimal", () => {
  assert.equal(toMinor(199.99), 19999)
  assert.equal(toMinor(1.005), 101, "the float 1.005 is read as written")
  assert.equal(toMinor(0.1 + 0.2), 30)
  assert.equal(toMinor(1565.0043), 156500)
  assert.equal(toMinor("249,90"), 24990)
  assert.equal(toMinor({ value: "199.99", precision: 20 }), 19999)
  assert.equal(toMinor({ numeric: 49.5 }), 4950)
  assert.equal(toMinor(-12.5), -1250)
  assert.equal(toMinor("abc"), null)
  assert.equal(toMinor(Number.NaN), null)
  assert.equal(decimalString(BigInt(5)), "5")
  assert.equal(formatMinor(19999), "199.99")
  assert.equal(formatMinor(5), "0.05")
  assert.equal(formatMinor(-1250), "-12.50")
  assert.equal(firstMinor(undefined, "x", 10), 1000)
  assert.equal(firstMinor(0, 5), 0, "zero is a value")
  assert.equal(firstMinor(null), null)
})

test("masking: configured secrets, Basic and Bearer credentials, key= values, long tokens; ids stay readable", () => {
  const o = resolveOptions({ ...SANDBOX, pickupApiKey: API_KEY, infoPassword: "info-password-0001" })
  const secrets = secretsOf(o)
  const text = `401 for koda-test:${PASSWORD} at https://mypudo.dpd.com.pl/api/v2/pudo/details?pudoId=PL14509&key=${API_KEY}&x=1 Authorization: Basic a29kYTpzZWNyZXQ= info-password-0001 ${"Q".repeat(44)}`
  const masked = maskSecrets(text, secrets)
  assert.ok(!masked.includes(PASSWORD))
  assert.ok(!masked.includes(API_KEY))
  assert.ok(!masked.includes("a29kYTpzZWNyZXQ="))
  assert.ok(!masked.includes("info-password-0001"))
  assert.ok(!masked.includes("Q".repeat(44)))
  assert.match(masked, /key=\*\*\*&x=1/)
  assert.match(masked, /Basic \*\*\*/)
  assert.match(masked, /pudoId=PL14509/)
  assert.match(masked, /koda-test/, "a login is an identifier, not a secret")
  assert.equal(maskSecrets("key=abc", []), "key=abc", "a bare word is not a query parameter")
  assert.equal(maskSecrets("?key=abc", []), "?key=***")
  assert.equal(maskSecrets("waybill 0000123456789U fid 1000", ["short"]), "waybill 0000123456789U fid 1000", "secrets under six characters are not replaced literally")
  assert.equal(secretState(""), "missing")
  assert.equal(secretState(PASSWORD), "set")
  assert.equal(hint("abcdefghijkl"), "abcd...ijkl")
  assert.equal(hint("abc"), "***")
  assert.equal(hint(null), null)
})

test("frozen ids: the provider, the module, the namespace, the five options, the provider id pattern", () => {
  assert.equal(PROVIDER_IDENTIFIER, "dpd")
  assert.equal(DPD_MODULE, "dpd")
  assert.equal(DPD_NS, "dpd")
  assert.deepEqual([...OPTION_IDS], ["dpd-courier", "dpd-courier-cod", "dpd-pickup", "dpd-pickup-cod", "dpd-return"])
  assert.equal(isDpdProviderId("dpd_dpd"), true)
  assert.equal(isDpdProviderId("dpd_other"), true)
  assert.equal(isDpdProviderId("inpost_inpost"), false)
  assert.equal(isDpdProviderId("manual_manual"), false)
  assert.equal(isDpdProviderId(null), false)
  assert.deepEqual(DPDSERVICES_HOSTS, { live: "https://dpdservices.dpd.com.pl", sandbox: "https://dpdservicesdemo.dpd.com.pl" })
  assert.ok(INFOSERVICES_URL.startsWith("https://dpdinfoservices.dpd.com.pl/"))
  assert.equal(MYPUDO_URL, "https://mypudo.dpd.com.pl/api/v2/")
  assert.deepEqual([...COD_CURRENCIES], ["PLN", "EUR", "RON", "CZK"])
  assert.deepEqual([...LABEL_PAGES], ["A4", "LBL_PRINTER"])
  assert.deepEqual([...DPD_EVENTS], ["dpd.shipment.created", "dpd.shipment.status_changed", "dpd.shipment.delivered", "dpd.return.created"])
})

test("groups of the Panel: one group per row, the same on the server and in the admin", () => {
  const row = (state: (typeof SHIPMENT_STATES)[number], stage: (typeof SHIPMENT_STAGES)[number] | null = null, handedOver = false, kind: "outbound" | "return" = "outbound") => groupOf({ kind, state, stage, handedOver })
  assert.equal(row("pending"), "to_create")
  assert.equal(row("created"), "to_create")
  assert.equal(row("labeling"), "to_create")
  assert.equal(row("labeled"), "labeled")
  assert.equal(row("labeled", "ready", true), "handed_over")
  assert.equal(row("labeled", "in_transit", true), "in_transit")
  assert.equal(row("labeled", "in_point", true), "in_transit")
  assert.equal(row("labeled", "delivered", true), "delivered")
  assert.equal(row("labeled", "problem", true), "problems")
  assert.equal(row("labeled", "returned", true), "problems")
  for (const s of ["failed", "unknown", "ambiguous", "abandoned_unknown"] as const) assert.equal(row(s), "problems", s)
  assert.equal(row("canceled"), "canceled")
  assert.equal(row("skipped"), "canceled")
  assert.equal(row("labeled", "canceled"), "canceled")
  assert.equal(row("pending", null, false, "return"), "returns")
  assert.equal(row("unknown", null, false, "return"), "returns")
  assert.equal(row("canceled", null, false, "return"), "canceled")
  for (const s of SHIPMENT_STATES) for (const st of [null, ...SHIPMENT_STAGES]) assert.ok(SHIPMENT_GROUPS.includes(row(s, st)))
  assert.deepEqual([...ATTENTION_GROUPS], ["to_create", "problems"])
})

/** The columns a model file declares (`name: model.xxx(...)`). */
function modelColumns(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(/^\s+(\w+): model\./gm)].map((m) => m[1])
}

test("tables: every model column is in the migrations, with the table names of the plan", () => {
  const migration = readFileSync(join(PKG, "src/modules/dpd/migrations/Migration20261102120000_dpd.ts"), "utf8")
  /* Stage 4 adds the columns of the handover to dpd_dispatch in a second migration (alter table only). */
  const second = readFileSync(join(PKG, "src/modules/dpd/migrations/Migration20261103120000_dpd_dispatch.ts"), "utf8")
  const added = [...second.matchAll(/add column if not exists "(\w+)"/g)].map((m) => m[1])
  assert.deepEqual(added, ["location_id", "sender", "params", "problems", "plan_hash", "attempts", "protocol_at", "ordered_at", "updated_by"])
  const tables = ["dpd_shipment", "dpd_document", "dpd_event", "dpd_dispatch", "dpd_setting"]
  for (const table of tables) {
    const file = join(PKG, "src/modules/dpd/models", `${table.replace("_", "-")}.ts`)
    assert.match(readFileSync(file, "utf8"), new RegExp(`model\\s*\\.define\\("${table}"`), table)
    const block = migration.split(`create table if not exists "${table}" (`)[1]?.split(");")[0] ?? ""
    assert.ok(block, `the migration creates ${table}`)
    const columns = new Set([...[...block.matchAll(/"(\w+)" /g)].map((m) => m[1]), ...(table === "dpd_dispatch" ? added : [])])
    for (const column of modelColumns(file)) assert.ok(columns.has(column), `${table}.${column}`)
  }
  /* Never @mikro-orm/migrations directly: the package has no @mikro-orm dependency nor peer (E11). */
  assert.match(second, /^import \{ Migration \} from "@medusajs\/framework\/mikro-orm\/migrations"$/m)
  assert.ok(!second.includes('"@mikro-orm/'), "no direct @mikro-orm import")
  assert.match(migration, /"IDX_dpd_shipment_fulfillment_id_kind_mode_unique" on "dpd_shipment" \("fulfillment_id", "kind", "mode"\)/)
  assert.match(migration, /create unique index if not exists "IDX_dpd_event_dedupe_key_unique"/)
  assert.match(migration, /create unique index if not exists "IDX_dpd_setting_key_unique" on "dpd_setting" \("key"\) where "deleted_at" is null;/)
  /* Every unique index is scoped to the live rows, as Medusa's data model scopes the index of each model. */
  const uniques = [...migration.matchAll(/create unique index if not exists "(\w+)" on "\w+" \([^)]*\)([^;]*);/g)]
  assert.equal(uniques.length, 3)
  for (const [, name, where] of uniques) assert.match(where, /"deleted_at" is null/, name)
  for (const table of tables) {
    const model = readFileSync(join(PKG, "src/modules/dpd/models", `${table.replace("_", "-")}.ts`), "utf8")
    for (const m of model.matchAll(/\{ on: \[[^\]]*\], unique: true([^}]*)\}/g)) assert.match(m[1], /deleted_at IS NULL/, `${table}: the unique index says its scope`)
  }
  assert.match(migration, /export class Migration20261102120000_dpd extends Migration/)
})

test("the second migration drops only its own columns", () => {
  const first = readFileSync(join(PKG, "src/modules/dpd/migrations/Migration20261102120000_dpd.ts"), "utf8")
  const second = readFileSync(join(PKG, "src/modules/dpd/migrations/Migration20261103120000_dpd_dispatch.ts"), "utf8")
  const [up, down] = second.split(/async down\(\)/)
  assert.ok(up && down, "an up and a down")
  const added = [...up.matchAll(/add column if not exists "(\w+)"/g)].map((m) => m[1])
  const dropped = [...down.matchAll(/drop column if exists "(\w+)"/g)].map((m) => m[1])
  assert.deepEqual(dropped, added, "down drops exactly what up added (DS2)")
  assert.ok(added.length > 0)
  /* Nothing of the first migration: no table, no index, no column it created. */
  assert.ok(!/drop (table|index)|create table|truncate|delete from|rename/i.test(second), "alter table only")
  assert.equal([...second.matchAll(/alter table if exists "(\w+)"/g)].map((m) => m[1]).join(","), "dpd_dispatch,dpd_dispatch")
  const block = first.split('create table if not exists "dpd_dispatch" (')[1]?.split(");")[0] ?? ""
  const own = new Set([...block.matchAll(/"(\w+)" /g)].map((m) => m[1]))
  for (const column of dropped) assert.ok(!own.has(column), `${column} belongs to the first migration`)
  assert.match(second, /export class Migration20261103120000_dpd_dispatch extends Migration/)
})

test("the migration name is unique across every package of the repository", () => {
  const packages = join(PKG, "..")
  const names = new Map<string, string[]>()
  const walk = (dir: string, pkg: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path, pkg)
      else if (/migrations[\\/]Migration\w+\.ts$/.test(path)) {
        const name = entry.name.replace(/\.ts$/, "")
        names.set(name, [...(names.get(name) ?? []), pkg])
      }
    }
  }
  for (const pkg of readdirSync(packages)) {
    const src = join(packages, pkg, "src")
    if (existsSync(src)) walk(src, pkg)
  }
  assert.deepEqual(names.get("Migration20261102120000_dpd"), ["medusa-plugin-dpd"])
})

test("no en dash, em dash or middle dot in the sources and tests of this package", () => {
  const forbidden = new RegExp(`[${String.fromCharCode(0x2013, 0x2014, 0xb7)}]`)
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.(ts|tsx|mjs)$/.test(e.name) ? [join(dir, e.name)] : []))
  for (const file of [...walk(join(PKG, "src")), ...walk(join(PKG, "test"))]) assert.ok(!forbidden.test(readFileSync(file, "utf8")), file)
})

test("the fake container serves the generated CRUD under Medusa's names", async () => {
  const s = setup(SANDBOX)
  const svc = s.container.resolve<Record<string, (...args: unknown[]) => Promise<unknown>>>("dpd")
  const created = (await svc.createDpdShipments({ order_id: "order_01", fulfillment_id: "ful_01", mode: "sandbox", option_id: "dpd-courier" })) as Record<string, unknown>
  assert.equal(created.state, "pending")
  assert.equal(created.kind, "outbound")
  assert.match(String(created.id), /^dpdshp_/)
  assert.deepEqual(((await svc.listAndCountDpdShipments({ mode: "sandbox" })) as [unknown[], number])[1], 1)
  assert.equal(((await svc.createDpdDispatches({ mode: "sandbox" })) as Record<string, unknown>).state, "pending")
  assert.equal(s.container.resolve("missing", { allowUnregistered: true }), undefined)
  assert.throws(() => s.container.resolve("missing"), /not registered/)
})
