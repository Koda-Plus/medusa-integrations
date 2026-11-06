/**
 * The offer flows end to end, on the simulated marketplace of demo mode and
 * an in-memory module service and Query (no database, no network):
 *
 *   an edit of a PUBLISHED offer is a close, a merge patch and a reopen,
 *   chained by the sync one command at a time, and the marketplace ends up
 *   with the new name; the price and stock sync never touches it meanwhile;
 *   an edit that breaks a rule of the marketplace is refused before anything
 *   is kept; an edit of an offer that is not on the marketplace stays here;
 *   "Remove from the panel only" forgets the offer without asking InPost and
 *   the sync never links it back by itself; "Import from InPost" links it
 *   again by its external id and reports an offer of another tool, without
 *   creating anything; the bulk days to ship and the bulk category
 *   parameters land on every chosen offer.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveOptions } from "../src/modules/vonhalsky/lib/options.ts"
import { demoOfferId, type DemoClient } from "../src/modules/vonhalsky/lib/demo.ts"
import { detachOffers, editOffer, editOffers, importOffers, listOffers, refreshOffers, setAttributesMany } from "../src/workflows/vonhalsky/offers.ts"
import { followCommands, followOffers, pushPriceStock } from "../src/workflows/vonhalsky/sync.ts"
import { clientOf } from "../src/workflows/vonhalsky/runtime.ts"

type Row = Record<string, any>

const isNull = (v: unknown) => v === null || v === undefined

/** One filter value the way the database reads it (SQL: a null column matches no comparison). */
function matches(value: unknown, filter: unknown): boolean {
  if (filter === undefined) return true
  if (filter === null) return isNull(value)
  if (Array.isArray(filter)) return filter.includes(value)
  if (typeof filter === "object") {
    return Object.entries(filter as Record<string, unknown>).every(([op, x]) => {
      switch (op) {
        case "$ne":
          return x === null ? !isNull(value) : !isNull(value) && value !== x
        case "$nin":
          return !isNull(value) && Array.isArray(x) && !x.includes(value)
        case "$lt":
          return !isNull(value) && new Date(value as string).getTime() < new Date(x as string).getTime()
        case "$ilike":
          return typeof value === "string" && new RegExp(`^${String(x).replace(/%/g, ".*")}$`, "i").test(value)
        default:
          throw new Error(`the fake does not know ${op}`)
      }
    })
  }
  return value === filter
}

function matchesAll(row: Row, filters: Record<string, unknown> = {}): boolean {
  return Object.entries(filters).every(([k, v]) => (k === "$or" ? (v as Row[]).some((sub) => matchesAll(row, sub)) : matches(row[k], v)))
}

const PREFIX: Record<string, string> = { Offers: "vhoff", Categories: "vhcat", Settings: "vhset", SyncLogs: "vhlog", Snapshots: "vhsnap", Orders: "vhord", Cases: "vhcase" }

function fakeService(options = resolveOptions({ demo: true })) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.keys(PREFIX).map((k) => [k, []]))
  let n = 0
  const svc: Record<string, unknown> = { getOptions: () => options }
  return {
    tables,
    svc: new Proxy(svc, {
      get(target, name: string) {
        if (name in target) return target[name]
        const m = /^(list|listAndCount|create|update|delete)VonHalsky(\w+)$/.exec(name)
        if (!m) return undefined
        const table = tables[m[2]]
        if (!table) throw new Error(`no table ${m[2]}`)
        const [, verb, entity] = m
        return async (input: any, config: { skip?: number; take?: number } = {}) => {
          if (verb === "list" || verb === "listAndCount") {
            const all = table.filter((r) => matchesAll(r, input ?? {}))
            const page = all.slice(config.skip ?? 0, (config.skip ?? 0) + (config.take ?? 10_000)).map((r) => ({ ...r }))
            return verb === "list" ? page : [page, all.length]
          }
          const list = Array.isArray(input) ? input : [input]
          if (verb === "create") {
            const made = list.map((x: Row) => ({ id: `${PREFIX[entity]}_${++n}`, created_at: new Date(), updated_at: new Date(), ...x }))
            table.push(...made)
            return Array.isArray(input) ? made : made[0]
          }
          if (verb === "update") {
            for (const x of list) {
              const r = table.find((y) => y.id === x.id)
              if (!r) throw new Error(`no row ${x.id}`)
              Object.assign(r, x, { updated_at: new Date() })
            }
            return input
          }
          for (const id of list) table.splice(table.findIndex((r) => r.id === id), 1)
        }
      },
    }),
  }
}

const IMG = (name: string) => `https://cdn.example.com/${name}.jpg`
const LONG = "Kubek z grubej ceramiki, szkliwiony od środka i z zewnątrz, mieści 300 ml, można go myć w zmywarce i podgrzewać w mikrofalówce."

function variant(id: string, productId: string, sku: string, ean: string, title: string) {
  return {
    id,
    sku,
    title: "Standard",
    ean,
    product_id: productId,
    manage_inventory: false,
    metadata: { brand: "Koda Plus" },
    weight: 350,
    length: 120,
    height: 100,
    width: 90,
    product: {
      title,
      status: "published",
      thumbnail: IMG(`${sku}-main`),
      description: `<p>${LONG}</p>`,
      metadata: { gpsr_manufacturer: { name: "Koda Plus sp. z o.o.", email: "gpsr@example.com" } },
      images: [{ url: IMG(`${sku}-side`), rank: 1 }],
      categories: [{ id: "pcat_mugs" }],
    },
    prices: [{ amount: 49.99, currency_code: "pln", price_list_id: null, min_quantity: null, rules_count: 0 }],
    inventory_items: [],
  }
}

const VARIANTS = [variant("variant_1", "prod_1", "KS-OFF-MUG", "5901234123457", "Kubek ceramiczny biały"), variant("variant_2", "prod_2", "KS-OFF-PEN", "4012345678901", "Długopis metalowy grawerowany")]

function fakeScope() {
  const { svc, tables } = fakeService(resolveOptions({ demo: true, untrackedStock: 10 }))
  tables.Categories.push({ id: "vhcat_1", remote_id: "demo-cat-meble", path: "Dom i ogród > Meble", leaf: true, gpsr_free: false, attributes: [{ id: "demo-attr-kolor", name: "Kolor", type: "DICTIONARY", expected: "NULL_OR_ONE", required: false, options: [], unit: null }], attributes_at: new Date() })
  tables.Settings.push({ id: "vhset_cat", key: "categories", value: { pcat_mugs: "demo-cat-meble" } })
  const query = {
    async graph(args: { entity: string; filters?: Record<string, any>; pagination?: { skip?: number; take?: number } }) {
      const ids: string[] | undefined = args.filters?.id
      if (args.entity === "product_variant") {
        const list = VARIANTS.filter((v) => !ids || ids.includes(v.id))
        const skip = args.pagination?.skip ?? 0
        return { data: list.slice(skip, skip + (args.pagination?.take ?? 1000)) }
      }
      if (args.entity === "product") return { data: [...new Set(VARIANTS.map((v) => v.product_id))].filter((p) => !ids || ids.includes(p)).map((p) => ({ id: p, variants: VARIANTS.filter((v) => v.product_id === p).map((v) => ({ id: v.id })) })) }
      return { data: [] }
    },
  }
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined }
  const scope = {
    resolve(key: string) {
      if (key === "vonhalsky") return svc
      if (key === "query") return query
      if (key === "logger") return quiet
      throw new Error(`no ${key} in the fake container`)
    },
  } as never
  return { scope, tables, offer: (variantId: string) => tables.Offers.find((r) => r.variant_id === variantId)! }
}

/** Runs the commands part until nothing is pending (each run moves every pending command one step). */
async function settle(scope: never, max = 6): Promise<void> {
  for (let i = 0; i < max; i += 1) await followCommands(scope)
}

test("flows: an edit of a published offer is close, patch and reopen, one command at a time", async () => {
  const { scope, offer } = fakeScope()
  await refreshOffers(scope)
  const listed = await listOffers(scope, [offer("variant_1").id, offer("variant_2").id])
  assert.equal(listed.listed, 2)
  await followCommands(scope)
  assert.equal(offer("variant_1").remote_status, "PUBLISHED")
  const demo = clientOf(scope) as DemoClient

  const r = await editOffer(scope, offer("variant_1").id, { title: "Kubek emaliowany niebieski", daysToShip: 5 })
  assert.equal(r.sent, "close", "a published offer is closed first")
  assert.deepEqual(r.offer.overridden, ["title", "daysToShip"])
  assert.equal(r.offer.effective?.title, "Kubek emaliowany niebieski")
  assert.equal(r.offer.medusa?.title, "Kubek ceramiczny biały", "Medusa's value stays for the placeholder")
  assert.equal(r.offer.effective?.daysToShip, 5)
  assert.equal(offer("variant_1").title, "Kubek emaliowany niebieski", "the row's name is the one sent")
  assert.equal(offer("variant_1").command_kind, "edit_close")

  /* The price and stock sync leaves an offer alone while its edit runs. */
  assert.equal(await pushPriceStock(scope), "0 prices, 0 stocks, 0 closed, 0 reopened")

  await followCommands(scope)
  assert.equal(offer("variant_1").command_kind, "edit_patch", "the close is done: the patch goes")
  assert.equal(offer("variant_1").status, "listed", "our own close never counts as taken off")
  assert.equal((await demo.getOffer(String(offer("variant_1").remote_id)))?.status, "CLOSED")

  await followCommands(scope)
  assert.equal(offer("variant_1").command_kind, "reopen", "the patch is done: the offer is reopened")
  await followCommands(scope)
  const remote = await demo.getOffer(String(offer("variant_1").remote_id))
  assert.equal(remote?.status, "PUBLISHED")
  assert.equal(remote?.name, "Kubek emaliowany niebieski")
  assert.equal(offer("variant_1").remote_status, "PUBLISHED")
  assert.equal(offer("variant_1").error, null)
})

test("flows: an edit that breaks a marketplace rule is refused and nothing is kept", async () => {
  const { scope, offer } = fakeScope()
  await refreshOffers(scope)
  const id = offer("variant_1").id
  await assert.rejects(editOffer(scope, id, { images: ["https://cdn.example.com/a.avif"] }), (e: any) => e.status === 400 && e.code === "image_invalid")
  await assert.rejects(editOffer(scope, id, { title: "Kubek" }), (e: any) => e.code === "title_invalid")
  await assert.rejects(editOffer(scope, id, { dimension: { length: 1200, width: 900, height: 200, weight: 500 } }), (e: any) => e.code === "too_large")
  await assert.rejects(editOffer(scope, id, { daysToShip: 61 }), (e: any) => e.code === "days_invalid")
  await assert.rejects(editOffer(scope, id, { description: "Za krótko." }), (e: any) => e.code === "description_short")
  assert.equal(offer("variant_1").overrides ?? null, null)
})

test("flows: an edit of an offer not on the marketplace stays here, null goes back to Medusa", async () => {
  const { scope, offer } = fakeScope()
  await refreshOffers(scope)
  const id = offer("variant_1").id
  const photos = [IMG("KS-OFF-MUG-side"), IMG("KS-OFF-MUG-new")]
  const r = await editOffer(scope, id, { images: photos, dimension: { length: 130, width: 95, height: 105, weight: 400 } })
  assert.equal(r.sent, "local")
  assert.deepEqual(r.offer.effective?.images, photos, "the order of the edit is the priority")
  assert.deepEqual(r.offer.medusa?.images, [IMG("KS-OFF-MUG-main"), IMG("KS-OFF-MUG-side")])
  assert.deepEqual(r.offer.effective?.dimension, { length: 130, width: 95, height: 105, weight: 400 })
  const back = await editOffer(scope, id, { images: null })
  assert.deepEqual(back.offer.overridden, ["dimension"])
  assert.deepEqual(back.offer.effective?.images, [IMG("KS-OFF-MUG-main"), IMG("KS-OFF-MUG-side")])
})

test("flows: remove from the panel only, then import from InPost links it again and reports a foreign offer", async () => {
  const { scope, offer } = fakeScope()
  await refreshOffers(scope)
  await listOffers(scope, [offer("variant_1").id, offer("variant_2").id])
  await settle(scope)
  const pen = offer("variant_2")
  const remoteId = String(pen.remote_id)
  const demo = clientOf(scope) as DemoClient
  const calls = demo.log.length

  const d = await detachOffers(scope, [pen.id, offer("variant_1").id, "vhoff_missing"])
  assert.equal(d.detached, 2)
  assert.equal(demo.log.length, calls, "InPost is not asked anything")
  assert.equal(offer("variant_2").status, "detached")
  assert.equal(offer("variant_2").remote_id, null)
  assert.equal((await demo.getOffer(remoteId))?.status, "PUBLISHED", "the offer stays active on the marketplace")

  /* Neither the sync nor a refresh brings it back by itself. */
  await followOffers(scope)
  await refreshOffers(scope)
  assert.equal(offer("variant_2").status, "detached")
  assert.equal(offer("variant_2").remote_id, null)

  const imported = await importOffers(scope)
  assert.equal(imported.linked, 2)
  assert.equal(offer("variant_2").status, "listed")
  assert.equal(offer("variant_2").remote_id, demoOfferId("variant_2"))
  assert.equal(offer("variant_2").pushed_price_minor, offer("variant_2").remote_price_minor, "the marketplace's price counts as last sent")
  assert.deepEqual(
    imported.unmatched.map((u) => [u.sku, u.reason]),
    [["ERP-TERMOS-500", "no_match"]],
    "an offer of another tool is reported, never invented",
  )
  const again = await importOffers(scope)
  assert.equal(again.linked, 0)
  assert.equal(again.updated, 2, "a second import reads the linked offers again")
})

test("flows: bulk days to ship and bulk category parameters", async () => {
  const { scope, offer } = fakeScope()
  await refreshOffers(scope)
  const ids = [offer("variant_1").id, offer("variant_2").id]
  const days = await editOffers(scope, ids, { daysToShip: 3 })
  assert.deepEqual(days, { updated: 2, sent: 0, skipped: [] })
  assert.deepEqual([offer("variant_1").overrides, offer("variant_2").overrides], [{ daysToShip: 3 }, { daysToShip: 3 }])
  const attrs = await setAttributesMany(scope, ids, [{ id: "demo-attr-kolor", values: ["biały"] }, { id: "unknown", values: ["x"] }])
  assert.equal(attrs.updated, 2)
  assert.deepEqual(offer("variant_2").attributes, [{ id: "demo-attr-kolor", values: ["biały"] }], "unknown parameters of the category are dropped")
  await setAttributesMany(scope, ids, [{ id: "demo-attr-kolor", values: [] }])
  assert.deepEqual(offer("variant_1").attributes, [], "a parameter given without values is removed")
  const back = await editOffers(scope, ids, { daysToShip: null })
  assert.equal(back.updated, 2)
  assert.equal(offer("variant_1").overrides, null, "nothing overridden: the column stays clean")
})
