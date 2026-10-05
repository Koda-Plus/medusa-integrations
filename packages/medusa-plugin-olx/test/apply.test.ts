import { test } from "node:test"
import assert from "node:assert/strict"
import {
  applyLifecycle,
  applyPrices,
  publishOnce,
  reconcileLifecycle,
  reconcilePrices,
  reconcilePublications,
  type AdvertSnapshot,
  type FoundAdvert,
} from "../src/modules/olx/lib/apply.ts"
import { OlxApiError, OlxUnknownResultError } from "../src/modules/olx/lib/errors.ts"
import { clock, memoryPlanStore, memoryPublicationStore, planRow, type Row } from "./helpers.ts"

function snap(status: string, price: number | null = 100): AdvertSnapshot {
  return {
    status,
    price: price === null ? null : { value: price, currency: "PLN" },
    raw: {
      data: {
        id: 1,
        status,
        title: "Wiertarko-wkrętarka 18V",
        description: "Opis.",
        category_id: 1559,
        advertiser_type: "business",
        contact: { name: "Sklep" },
        location: { city_id: 5659 },
        price: price === null ? null : { value: price, currency: "PLN" },
        attributes: [{ code: "state", value: "new" }],
      },
    },
  }
}

/** A scripted OLX: statuses by advert, answers by advert, and a log of every write. */
function fakeLifecycle(statuses: Record<string, string>, answers: Record<string, () => void> = {}) {
  const writes: string[] = []
  return {
    writes,
    transport: {
      async read(olxId: string) {
        return statuses[olxId] ? snap(statuses[olxId]) : null
      },
      async command(olxId: string, command: string) {
        writes.push(`${command}:${olxId}`)
        const answer = answers[olxId]
        if (answer) answer()
        statuses[olxId] = command === "deactivate" ? "removed_by_user" : command === "activate" ? "active" : "outdated"
      },
    },
  }
}

function rowsOf(list: Row[]): Map<string, Row> {
  return new Map(list.map((r) => [r.id, { ...r }]))
}

test("lifecycle: look first, write once, record the answer", async () => {
  const rows = rowsOf([
    planRow({ olx_id: "1" }),
    planRow({ olx_id: "2" }),
    planRow({ olx_id: "3", action: "activate", from_value: "removed_by_user", to_value: "active" }),
    planRow({ olx_id: "4" }),
    planRow({ olx_id: "5", action: "finish", to_value: "finished" }),
  ])
  const fake = fakeLifecycle({ "1": "active", "2": "removed_by_user", "3": "active", "5": "limited" })
  const report = await applyLifecycle([...rows.values()] as never, { ...clock, store: memoryPlanStore(rows), transport: fake.transport, isSuccess: false })
  assert.deepEqual(fake.writes, ["deactivate:1", "finish:5"], "only what was still needed went out")
  assert.equal(rows.get("olxpi_1")?.state, "done")
  assert.ok(rows.get("olxpi_1")?.paused_at, "the plugin remembers it paused advert 1")
  assert.equal(rows.get("olxpi_2")?.state, "idle", "ended by someone else: not ours to bring back")
  assert.equal(rows.get("olxpi_2")?.paused_at, null)
  assert.equal(rows.get("olxpi_3")?.state, "done", "already live: adopted")
  assert.equal(rows.get("olxpi_4")?.note, "advert_gone")
  assert.equal(rows.get("olxpi_5")?.paused_at, null, "finished adverts are never reactivated")
  assert.equal(report.attempted, 2)
  assert.equal(report.succeeded, 3)
})

test("lifecycle: rejections count and quarantine on the third, unclear answers become unknown", async () => {
  const rows = rowsOf([planRow({ olx_id: "1", attempts: 2, state: "failed" }), planRow({ olx_id: "2" }), planRow({ olx_id: "3" })])
  const fake = fakeLifecycle(
    { "1": "active", "2": "active", "3": "active" },
    {
      "1": () => {
        throw new OlxApiError(400, "OLX 400: ad: Ad has to be active", false)
      },
      "2": () => {
        throw new OlxUnknownResultError("POST /adverts/2/commands", new Error("timeout"))
      },
    },
  )
  const report = await applyLifecycle([...rows.values()] as never, { ...clock, store: memoryPlanStore(rows), transport: fake.transport, isSuccess: false })
  assert.equal(rows.get("olxpi_1")?.state, "quarantined")
  assert.equal(rows.get("olxpi_1")?.attempts, 3)
  assert.match(String(rows.get("olxpi_1")?.last_error), /Ad has to be active/)
  assert.equal(rows.get("olxpi_2")?.state, "unknown")
  assert.ok(rows.get("olxpi_2")?.unknown_since)
  assert.equal(rows.get("olxpi_3")?.state, "done")
  assert.equal(report.quarantined, 1)
  assert.equal(report.unknown, 1)
})

test("lifecycle: throttling stops the run and leaves the row waiting without an attempt", async () => {
  const rows = rowsOf([planRow({ olx_id: "1" }), planRow({ olx_id: "2" })])
  const fake = fakeLifecycle(
    { "1": "active", "2": "active" },
    {
      "1": () => {
        throw new OlxApiError(429, "OLX 429", true)
      },
    },
  )
  const report = await applyLifecycle([...rows.values()] as never, { ...clock, store: memoryPlanStore(rows), transport: fake.transport, isSuccess: false })
  assert.equal(report.stoppedBy, "throttled")
  assert.equal(rows.get("olxpi_1")?.state, "pending")
  assert.equal(rows.get("olxpi_1")?.attempts, 0)
  assert.equal(rows.get("olxpi_2")?.state, "pending", "never reached")
  assert.deepEqual(fake.writes, ["deactivate:1"])
})

test("lifecycle: a row another process holds is skipped", async () => {
  const rows = rowsOf([planRow({ olx_id: "1", state: "applying" })])
  const fake = fakeLifecycle({ "1": "active" })
  const report = await applyLifecycle([planRow({ olx_id: "1" })] as never, { ...clock, store: memoryPlanStore(rows), transport: fake.transport, isSuccess: false })
  assert.equal(report.busy, 1)
  assert.deepEqual(fake.writes, [])
})

test("lifecycle: unknown rows are read before anything is decided", async () => {
  const rows = rowsOf([planRow({ olx_id: "1", state: "unknown" }), planRow({ olx_id: "2", state: "unknown" })])
  const fake = fakeLifecycle({ "1": "removed_by_user", "2": "active" })
  const report = await reconcileLifecycle([...rows.values()] as never, { ...clock, store: memoryPlanStore(rows), transport: fake.transport, isSuccess: false })
  assert.equal(rows.get("olxpi_1")?.state, "done", "it went through after all")
  assert.ok(rows.get("olxpi_1")?.paused_at)
  assert.equal(rows.get("olxpi_2")?.state, "pending", "it did not: planned again, for the next run")
  assert.deepEqual(fake.writes, [], "reconciling never writes")
  assert.equal(report.succeeded, 1)
})

function priceRow(olxId: string, from: number, to: number, over: Row = {}): Row {
  return planRow({ olx_id: olxId, writer: "price", action: "price", reason: "price_changed", from_value: { value: from, currency: "PLN" }, to_value: { value: to, currency: "PLN" }, ...over })
}

test("prices: the whole advert goes back with only the price changed; a price changed on OLX is not overwritten", async () => {
  const rows = rowsOf([priceRow("1", 100, 110), priceRow("2", 100, 110), priceRow("3", 100, 110), priceRow("4", 100, 110)])
  const current: Record<string, AdvertSnapshot> = { "1": snap("active", 100), "2": snap("active", 105), "3": snap("active", 110), "4": snap("limited", 100) }
  const puts: Array<{ olxId: string; body: Record<string, unknown> }> = []
  const learned: string[] = []
  const report = await applyPrices([...rows.values()] as never, {
    ...clock,
    store: memoryPlanStore(rows),
    onAdvert: async (olxId) => {
      learned.push(olxId)
    },
    transport: {
      async read(olxId) {
        return current[olxId] ?? null
      },
      async put(olxId, body) {
        puts.push({ olxId, body })
        return snap("active", Number((body.price as { value: number }).value))
      },
    },
  })
  assert.deepEqual(puts.map((p) => p.olxId), ["1"])
  assert.deepEqual(puts[0].body.price, { value: 110, currency: "PLN" })
  assert.equal(puts[0].body.title, "Wiertarko-wkrętarka 18V")
  assert.equal(rows.get("olxpi_1")?.state, "done")
  assert.equal(rows.get("olxpi_2")?.note, "price_changed_on_olx")
  assert.equal(rows.get("olxpi_3")?.state, "done", "already there: adopted")
  assert.equal(rows.get("olxpi_4")?.state, "idle")
  assert.ok(learned.includes("2"), "the snapshot learns the price OLX has now")
  assert.equal(report.attempted, 1)
})

test("prices: unknown rows settle by reading the advert", async () => {
  const rows = rowsOf([priceRow("1", 100, 110, { state: "unknown" }), priceRow("2", 100, 110, { state: "unknown" })])
  await reconcilePrices([...rows.values()] as never, {
    ...clock,
    store: memoryPlanStore(rows),
    transport: {
      async read(olxId) {
        return olxId === "1" ? snap("active", 110) : snap("active", 100)
      },
      async put() {
        throw new Error("must not write")
      },
    },
  })
  assert.equal(rows.get("olxpi_1")?.state, "done")
  assert.equal(rows.get("olxpi_2")?.state, "pending")
})

function publication(id: string, sku: string, over: Row = {}): Row {
  return { id, variant_id: `variant_${id}`, product_id: "prod_1", sku, state: "planned", attempts: 0, payload: { title: `Advert ${sku}`, external_id: sku }, demo: false, ...over }
}

function fakeOlx(existing: FoundAdvert[] = []) {
  const adverts = [...existing]
  const calls: string[] = []
  let createAnswer: (payload: Record<string, unknown>) => FoundAdvert = (payload) => {
    const a = { olxId: String(1900000000 + adverts.length), url: "https://www.olx.pl/d/x", status: "new", externalId: String(payload.external_id) }
    adverts.push(a)
    return a
  }
  return {
    calls,
    adverts,
    setCreate(fn: (payload: Record<string, unknown>) => FoundAdvert) {
      createAnswer = fn
    },
    transport: {
      async findByExternalId(ext: string) {
        calls.push(`find:${ext}`)
        return adverts.filter((a) => String(a.externalId).toUpperCase() === ext.toUpperCase())
      },
      async create(payload: Record<string, unknown>) {
        calls.push(`create:${payload.external_id}`)
        return createAnswer(payload)
      },
    },
  }
}

test("publishing: a lookup before every create; what OLX already has is adopted, not duplicated", async () => {
  const rows = rowsOf([publication("a", "SKU-A"), publication("b", "SKU-B")])
  const olx = fakeOlx([{ olxId: "1700000001", url: "https://www.olx.pl/d/a", status: "active", externalId: "sku-a" }])
  const report = await publishOnce([...rows.values()] as never, { ...clock, store: memoryPublicationStore(rows), transport: olx.transport })
  assert.deepEqual(olx.calls, ["find:SKU-A", "find:SKU-B", "create:SKU-B"])
  assert.equal(rows.get("a")?.state, "published")
  assert.equal(rows.get("a")?.adopted, true, "matched case-insensitively and adopted")
  assert.equal(rows.get("b")?.state, "published")
  assert.equal(rows.get("b")?.adopted, false)
  assert.equal(report.attempted, 1)
  assert.equal(report.succeeded, 2)

  /* Running again changes nothing: published rows are not claimable. */
  const again = await publishOnce([...rows.values()] as never, { ...clock, store: memoryPublicationStore(rows), transport: olx.transport })
  assert.equal(again.busy, 2)
  assert.equal(olx.calls.filter((c) => c.startsWith("create")).length, 1)
})

test("publishing: an unclear create is looked up again; found means adopted, not found means unknown", async () => {
  const rows = rowsOf([publication("a", "SKU-A"), publication("b", "SKU-B")])
  const olx = fakeOlx()
  olx.setCreate((payload) => {
    if (payload.external_id === "SKU-A") olx.adverts.push({ olxId: "1800000001", url: "https://www.olx.pl/d/a", status: "new", externalId: "SKU-A" })
    throw new OlxUnknownResultError("POST /adverts", new Error("timeout"))
  })
  const report = await publishOnce([...rows.values()] as never, {
    ...clock,
    store: memoryPublicationStore(rows),
    transport: olx.transport,
    sleep: async () => undefined,
  })
  assert.equal(rows.get("a")?.state, "published")
  assert.equal(rows.get("a")?.olx_id, "1800000001")
  assert.equal(rows.get("b")?.state, "unknown")
  assert.equal(report.unknown, 1)
  assert.equal(olx.calls.filter((c) => c === "create:SKU-B").length, 1, "never sent twice in a run")
})

test("publishing: rejections quarantine after three; unknown rows wait out the grace period", async () => {
  const rows = rowsOf([publication("a", "SKU-A", { state: "failed", attempts: 2 })])
  const olx = fakeOlx()
  olx.setCreate(() => {
    throw new OlxApiError(400, "OLX 400: title: Too many capital letters", false)
  })
  await publishOnce([...rows.values()] as never, { ...clock, store: memoryPublicationStore(rows), transport: olx.transport })
  assert.equal(rows.get("a")?.state, "quarantined")

  const fresh = new Date(clock.now().getTime() - 5 * 60 * 1000)
  const old = new Date(clock.now().getTime() - 60 * 60 * 1000)
  const pending = rowsOf([publication("u1", "SKU-U1", { state: "unknown", unknown_since: fresh }), publication("u2", "SKU-U2", { state: "unknown", unknown_since: old })])
  const quiet = fakeOlx()
  await reconcilePublications([...pending.values()] as never, { ...clock, store: memoryPublicationStore(pending), transport: quiet.transport })
  assert.equal(pending.get("u1")?.state, "unknown", "too early to conclude it does not exist")
  assert.equal(pending.get("u2")?.state, "planned", "a quarter of an hour later and still absent: safe to create")
  assert.ok(!quiet.calls.some((c) => c.startsWith("create")), "reconciling never creates")
})
