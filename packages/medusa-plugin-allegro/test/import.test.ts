import { test } from "node:test"
import assert from "node:assert/strict"
import { checkoutFormFromApi, isPaid, nipOf, type CheckoutForm } from "../src/modules/allegro/lib/checkout.ts"
import {
  cancelDecision,
  drainAction,
  planImport,
  processImport,
  sameTotal,
  type ImportContext,
  type ImportPorts,
  type ImportRow,
  untaxedIds,
} from "../src/modules/allegro/lib/import.ts"
import { refLockKey } from "../src/modules/allegro/lib/constants.ts"
import { itemQuantity } from "../src/modules/allegro/lib/reservations.ts"
import { compareEventIds, cursorExpired, eventsFromApi, intentOf, intentsByForm, latestEventId } from "../src/modules/allegro/lib/events.ts"

const FORM_ID = "29738e61-7f6a-11e8-ac45-09db60ede9d6"

function rawForm(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: FORM_ID,
    status: "READY_FOR_PROCESSING",
    revision: "819b5836",
    updatedAt: "2026-10-06T09:00:00.000Z",
    buyer: { id: "1", email: "ymu1woaqq+54111a037@allegrogroup.pl", login: "kupujacy", firstName: "Jan", lastName: "Kowalski", guest: false, phoneNumber: "+48 600 000 000" },
    payment: { id: "p1", type: "ONLINE", finishedAt: "2026-10-06T08:59:00.000Z", paidAmount: { amount: "164.98", currency: "PLN" } },
    fulfillment: { status: "NEW" },
    delivery: {
      address: { firstName: "Jan", lastName: "Kowalski", street: "Długa 1", city: "Kraków", zipCode: "30-001", countryCode: "PL", phoneNumber: "+48 600 000 000" },
      method: { id: "m-locker", name: "Allegro Paczkomaty InPost" },
      pickupPoint: { id: "KRA01M", name: "Paczkomat KRA01M", description: "Przy sklepie", address: { street: "Rynek 1", zipCode: "30-001", city: "Kraków", countryCode: "PL" } },
      cost: { amount: "9.99", currency: "PLN" },
    },
    invoice: {
      required: true,
      address: {
        street: "Firmowa 2",
        city: "Kraków",
        zipCode: "30-002",
        countryCode: "PL",
        company: { name: "Firma Sp. z o.o.", ids: [{ type: "PL_NIP", value: "123-456-32-18" }], vatPayerStatus: "ACTIVE", taxId: "9999999999" },
        naturalPerson: null,
      },
    },
    lineItems: [
      {
        id: "a0000000-0000-4000-a000-000000000001",
        offer: { id: "17000000001", name: "Wkrętarka 18V", external: { id: "ks-wk-18v" } },
        quantity: 1,
        originalPrice: { amount: "139.99", currency: "PLN" },
        price: { amount: "129.99", currency: "PLN" },
        tax: { rate: "23.00" },
        boughtAt: "2026-10-06T08:58:00.000Z",
      },
      {
        id: "a0000000-0000-4000-a000-000000000002",
        offer: { id: "17000000002", name: "Bity", external: null },
        quantity: 2,
        price: { amount: "12.50", currency: "PLN" },
        boughtAt: "2026-10-06T08:57:00.000Z",
      },
    ],
    summary: { totalToPay: { amount: "164.98", currency: "PLN" } },
    marketplace: { id: "allegro-pl" },
    ...over,
  }
}

const variant1 = { id: "variant_1", productId: "prod_1", sku: "KS-WK-18V", productTitle: "Wkrętarka akumulatorowa" }
const variant2 = { id: "variant_2", productId: "prod_2", sku: "KS-BIT", productTitle: "Zestaw bitów" }

const ctx = (over: Partial<ImportContext> = {}): ImportContext => ({
  regionId: "reg_pl",
  currency: "pln",
  salesChannelId: "sc_allegro",
  byOffer: new Map([["17000000002", variant2]]),
  bySku: new Map([["KS-WK-18V", variant1]]),
  shippingOptionId: null,
  shippingOptions: { "m-locker": "so_inpost" },
  demo: false,
  ...over,
})

function form(over: Record<string, unknown> = {}): CheckoutForm {
  const f = checkoutFormFromApi(rawForm(over))
  assert.ok(f)
  return f
}

test("checkout form: everything the order needs, NIP from the typed ids, paid only with paidAmount", () => {
  const f = form()
  assert.equal(f.lines.length, 2)
  assert.equal(f.lines[0].externalId, "ks-wk-18v")
  assert.equal(f.boughtAt, "2026-10-06T08:57:00.000Z")
  assert.equal(f.invoice.address?.nip, "1234563218")
  assert.equal(f.delivery.pickupPoint?.id, "KRA01M")
  assert.equal(isPaid(f), true)
  assert.equal(isPaid(form({ payment: { id: "p", type: "CASH_ON_DELIVERY", paidAmount: null } })), false)
  assert.equal(isPaid(form({ payment: { id: "p", type: "ONLINE", paidAmount: null } })), false)
  assert.equal(nipOf({ taxId: "PL 123" }), "PL123")
  assert.equal(checkoutFormFromApi({ status: "BOUGHT" }), null)
})

test("import plan: lines by the offer link, then by signature; Allegro prices, tax inclusive, not discountable", () => {
  const d = planImport(form(), ctx())
  assert.equal(d.kind, "create")
  if (d.kind !== "create") return
  assert.deepEqual(
    d.order.items.map((i) => [i.variant_id, i.quantity, i.unit_price, i.is_tax_inclusive, i.is_discountable]),
    [
      ["variant_1", 1, 129.99, true, false],
      ["variant_2", 2, 12.5, true, false],
    ],
  )
  assert.equal(d.order.items[0].title, "Wkrętarka akumulatorowa")
  assert.equal(d.order.items[0].metadata.allegro_line_item_id, "a0000000-0000-4000-a000-000000000001")
  assert.equal(d.order.metadata.marketplace_order_ref, `allegro:${FORM_ID}`)
  assert.equal(d.order.metadata.nip, "1234563218")
  assert.equal(d.order.metadata.allegro_pickup_point_id, "KRA01M")
  assert.equal(d.order.shipping_methods[0].amount, 9.99)
  assert.equal(d.order.shipping_methods[0].is_tax_inclusive, true)
  assert.equal(d.order.shipping_methods[0].shipping_option_id, "so_inpost")
  assert.equal(d.order.currency_code, "pln")
  assert.equal(d.order.no_notification, true)
  assert.equal(d.email, "ymu1woaqq+54111a037@allegrogroup.pl")
  assert.equal(d.paid, true)
})

test("import plan: a parcel locker goes to the second address line, never to the company", () => {
  const d = planImport(form(), ctx())
  if (d.kind !== "create") throw new Error("expected create")
  assert.equal(d.order.shipping_address.company, undefined)
  /* The point name already carries its id, so it is not repeated. */
  assert.equal(d.order.shipping_address.address_2, "Paczkomat KRA01M")
  assert.equal(d.order.shipping_address.country_code, "pl")
  /* A name without the id gets it appended, an id alone stands alone. */
  const delivery = rawForm().delivery as Record<string, unknown>
  const named = planImport(form({ delivery: { ...delivery, pickupPoint: { id: "POP-WAW123", name: "Żabka, ul. Prosta 5" } } }), ctx())
  if (named.kind !== "create") throw new Error("expected create")
  assert.equal(named.order.shipping_address.address_2, "Żabka, ul. Prosta 5, POP-WAW123")
  /* The invoice address is the billing address, with the company name and nothing else in company. */
  assert.equal(d.order.billing_address.company, "Firma Sp. z o.o.")
  assert.equal(d.order.billing_address.address_1, "Firmowa 2")
  assert.equal(d.order.billing_address.address_2, undefined)
})

test("import plan: without an invoice the billing address is the delivery address without the locker", () => {
  const d = planImport(form({ invoice: { required: false } }), ctx())
  if (d.kind !== "create") throw new Error("expected create")
  assert.equal(d.order.billing_address.address_1, "Długa 1")
  assert.equal(d.order.billing_address.address_2, undefined)
  assert.equal(d.order.metadata.nip, undefined)
})

test("import plan: a line without a variant holds the order, a product is never invented", () => {
  const d = planImport(form(), ctx({ byOffer: new Map(), bySku: new Map([["KS-WK-18V", variant1]]) }))
  assert.equal(d.kind, "hold")
  if (d.kind !== "hold") return
  assert.equal(d.code, "unmapped_lines")
  assert.match(d.reason, /offer 17000000002 "Bity" \(no signature\)/)
})

test("import plan: wait until ready, skip a cancelled form, hold another currency or no address", () => {
  assert.equal(planImport(form({ status: "FILLED_IN" }), ctx()).kind, "wait")
  assert.equal(planImport(form({ status: "CANCELLED" }), ctx()).kind, "skip")
  const eur = planImport(form(), ctx({ currency: "eur" }))
  assert.equal(eur.kind === "hold" ? eur.code : eur.kind, "currency_mismatch")
  const raw = rawForm()
  const noAddress = planImport(form({ delivery: { ...(raw.delivery as Record<string, unknown>), address: null } }), ctx())
  assert.equal(noAddress.kind === "hold" ? noAddress.code : noAddress.kind, "no_address")
})

test("totals: the same to the grosz and in the same currency", () => {
  assert.equal(sameTotal({ value: 164.98, currency: "PLN" }, { value: 164.98000001, currency: "pln" }), true)
  assert.equal(sameTotal({ value: 164.98, currency: "PLN" }, { value: 164.97, currency: "PLN" }), false)
  assert.equal(sameTotal(null, null), true)
})

test("drain: what an event does to the row of its form", () => {
  assert.deepEqual(drainAction(null, "import"), { kind: "insert", status: "pending" })
  assert.deepEqual(drainAction({ status: "pending" }, "import"), { kind: "nudge" })
  assert.deepEqual(drainAction({ status: "imported" }, "import"), { kind: "none" })
  assert.equal(drainAction(null, "cancel").kind, "insert")
  assert.equal(drainAction({ status: "held" }, "cancel").kind, "cancel_before_import")
  assert.equal(drainAction({ status: "imported" }, "cancel").kind, "request_cancel")
  assert.equal(drainAction({ status: "importing" }, "cancel").kind, "request_cancel")
  assert.equal(drainAction({ status: "imported" }, "refresh").kind, "request_refresh")
  assert.equal(drainAction(null, "refresh").kind, "none")
  assert.equal(drainAction(null, "ignore").kind, "none")
})

test("events: parsed oldest first, a cancellation wins over an import of the same form", () => {
  const events = eventsFromApi({
    events: [
      { id: "1532603898317497", type: "BOUGHT", occurredAt: "2026-10-06T08:00:00Z", order: { checkoutForm: { id: "A" } } },
      { id: "1532603898317498", type: "READY_FOR_PROCESSING", occurredAt: "2026-10-06T08:01:00Z", order: { checkoutForm: { id: "A" } } },
      { id: "1532603898317499", type: "BUYER_CANCELLED", occurredAt: "2026-10-06T08:02:00Z", order: { checkoutForm: { id: "A" } } },
      { id: "1532603898317500", type: "READY_FOR_PROCESSING", occurredAt: "2026-10-06T08:03:00Z", order: { checkoutForm: { id: "B" } } },
      { type: "READY_FOR_PROCESSING" },
    ],
  })
  assert.equal(events.length, 4)
  const intents = intentsByForm(events)
  assert.equal(intents.get("A")?.intent, "cancel")
  assert.equal(intents.get("A")?.lastEventId, "1532603898317499")
  assert.equal(intents.get("B")?.intent, "import")
  assert.equal(intentOf("BOUGHT"), "ignore")
  assert.equal(intentOf("AUTO_CANCELLED"), "cancel")
  assert.equal(intentOf("BUYER_MODIFIED"), "refresh")
  assert.equal(compareEventIds("999", "1000"), -1)
  assert.equal(compareEventIds("1532603898317500", "1532603898317499"), 1)
  assert.equal(latestEventId({ latestEvent: { id: "42", occurredAt: "x" } }), "42")
  assert.equal(latestEventId({}), null)
  const now = new Date("2026-10-06T00:00:00Z")
  assert.equal(cursorExpired(new Date("2026-08-01T00:00:00Z"), now, 60), true)
  assert.equal(cursorExpired(new Date("2026-09-20T00:00:00Z"), now, 60), false)
})

/* ------------------------------------------------------------------ */
/* The exactly-once processor, against fakes                          */
/* ------------------------------------------------------------------ */

interface FakeOrder {
  id: string
  display_id: number | null
  ours: boolean
  ref: string
  draft: boolean
  paid?: boolean
  email?: string | null
}

interface World {
  row: ImportRow & { claim?: string | null; patch?: Record<string, unknown>; order_id?: string | null }
  orders: FakeOrder[]
  created: number
  placed: number
  paidMarks: number
  lookups: number
  locks: string[]
  fetchError?: Error & { status?: number }
  createError?: Error & { type?: string }
  completeError?: Error & { type?: string }
  stockProblem?: string
  claimTaken?: boolean
  leaseLost?: boolean
  /** Another importer holds `marketplace-order-ref:<ref>` right now. */
  lockTaken?: boolean
  /** Runs after every lookup by reference (a rival creating the order in between). */
  afterLookup?: (w: World) => void
  total?: { value: number; currency: string }
}

function world(over: Partial<World> = {}): World {
  return {
    row: { id: "algimp_1", checkout_form_id: FORM_ID, status: "pending", attempts: 0, created_at: "2026-10-06T09:00:00Z" },
    orders: [],
    created: 0,
    placed: 0,
    paidMarks: 0,
    lookups: 0,
    locks: [],
    ...over,
  }
}

function ports(w: World): ImportPorts {
  return {
    now: () => new Date("2026-10-06T10:00:00Z"),
    token: () => "token-1",
    claim: async (row, token) => {
      if (w.claimTaken || !["pending", "unknown"].includes(w.row.status)) return null
      w.row = { ...w.row, status: "importing", attempts: w.row.attempts + 1, claim: token }
      return w.row
    },
    progress: async (_row, token, patch) => {
      if (w.leaseLost || w.row.claim !== token) return false
      w.row = { ...w.row, ...(patch as Partial<ImportRow>) }
      return true
    },
    finish: async (_row, token, patch) => {
      if (w.leaseLost || w.row.claim !== token) return false
      w.row = { ...w.row, ...(patch as Partial<ImportRow>), claim: null, patch }
      return true
    },
    findOrderByRef: async (ref) => {
      w.lookups += 1
      const found = w.orders.find((o) => o.ref === ref) ?? null
      w.afterLookup?.(w)
      return found ? { id: found.id, display_id: found.display_id, ours: found.ours, draft: found.draft } : null
    },
    withRefLock: async (ref, fn) => {
      if (w.lockTaken) return null
      w.locks.push(refLockKey(ref))
      return fn()
    },
    fetchForm: async () => {
      if (w.fetchError) throw w.fetchError
      return form()
    },
    context: async () => ctx(),
    precheckStock: async () => w.stockProblem ?? null,
    createDraft: async () => {
      if (w.createError) throw w.createError
      w.created += 1
      w.orders.push({ id: `order_${w.created}`, display_id: 100 + w.created, ours: true, ref: `allegro:${FORM_ID}`, draft: true })
      return { orderId: `order_${w.created}`, displayId: 100 + w.created }
    },
    complete: async (orderId, args) => {
      if (w.completeError) throw w.completeError
      const o = w.orders.find((x) => x.id === orderId) as FakeOrder
      if (o.draft) {
        o.email = args.email
        o.draft = false
        w.placed += 1
      }
      if (args.paid && !o.paid) {
        o.paid = true
        w.paidMarks += 1
      }
      return { orderId, displayId: o.display_id, total: w.total ?? { value: 164.98, currency: "PLN" } }
    },
  }
}

test("exactly once: a draft is created, placed and paid once; a repeat adopts it instead of creating a second", async () => {
  const w = world()
  const first = await processImport(w.row, ports(w))
  assert.equal(first.kind, "imported")
  assert.equal(w.created, 1)
  assert.equal(w.placed, 1, "placed: reservations and order.placed, once")
  assert.equal(w.paidMarks, 1)
  assert.equal(w.orders[0].email, "ymu1woaqq+54111a037@allegrogroup.pl", "the e-mail goes on the draft before it is placed")
  assert.equal(w.row.status, "imported")
  assert.equal(w.row.order_id, "order_1")
  assert.equal(w.row.total_mismatch, false)
  assert.deepEqual(w.locks, [`marketplace-order-ref:allegro:${FORM_ID}`], "created under the shared lock")
  /* The process died before the result was written: the row came back as unknown. */
  w.row = { ...w.row, status: "unknown" }
  const second = await processImport(w.row, ports(w))
  assert.equal(second.kind, "adopted")
  assert.equal(w.created, 1)
  assert.equal(w.placed, 1)
  assert.equal(w.paidMarks, 1)
  assert.equal(w.row.status, "imported")
})

test("exactly once: a draft left by a crash is finished on the next attempt, never created again", async () => {
  const w = world({ orders: [{ id: "order_9", display_id: 109, ours: true, ref: `allegro:${FORM_ID}`, draft: true }] })
  w.row = { ...w.row, status: "unknown" }
  const out = await processImport(w.row, ports(w))
  assert.equal(out.kind, "adopted")
  assert.equal(w.created, 0)
  assert.equal(w.placed, 1)
  assert.equal(w.paidMarks, 1)
  assert.equal(w.row.order_id, "order_9")
  assert.match(String(w.row.reason), /draft; it was placed now/)
})

test("exactly once: when finishing fails after the draft exists, its id stays on the row and the retry finishes it", async () => {
  const w = world({ completeError: new Error("connection reset") })
  const first = await processImport(w.row, ports(w))
  assert.equal(first.kind, "retry")
  assert.equal(w.created, 1)
  assert.equal(w.row.status, "pending")
  assert.equal(w.row.order_id, "order_1")
  assert.equal(w.row.reason_code, "complete_failed")
  w.completeError = undefined
  const second = await processImport(w.row, ports(w))
  assert.equal(second.kind, "adopted")
  assert.equal(w.created, 1, "never a second order")
  assert.equal(w.placed, 1)
})

test("exactly once: an order another integration imported (same marketplace_order_ref) makes us step back", async () => {
  const w = world({ orders: [{ id: "order_bl", display_id: 7, ours: false, ref: `allegro:${FORM_ID}`, draft: false }] })
  const out = await processImport(w.row, ports(w))
  assert.equal(out.kind, "duplicate")
  assert.equal(w.created, 0)
  assert.equal(w.row.status, "skipped")
  assert.equal(w.row.reason_code, "duplicate_ref")
})

test("a race with another plugin: the order it creates right after our first lookup is found again under the shared lock", async () => {
  const w = world({
    afterLookup: (x) => {
      /* BaseLinker creates the same Allegro order just after our first look. */
      if (x.lookups === 1) x.orders.push({ id: "order_bl", display_id: 79, ours: false, ref: `allegro:${FORM_ID}`, draft: false })
    },
  })
  const out = await processImport(w.row, ports(w))
  assert.equal(out.kind, "duplicate")
  assert.equal(w.lookups, 2, "looked up before the plan and again inside the lock")
  assert.deepEqual(w.locks, [`marketplace-order-ref:allegro:${FORM_ID}`])
  assert.equal(w.created, 0, "never a second Medusa order")
  assert.equal(w.row.status, "skipped")
  assert.equal(w.row.reason_code, "duplicate_ref")
  assert.match(String(w.row.reason), /#79/)
})

test("the shared lock held by another importer: nothing is created, the row comes back in a minute", async () => {
  const w = world({ lockTaken: true })
  const out = await processImport(w.row, ports(w))
  assert.equal(out.kind, "busy")
  assert.equal(w.created, 0)
  assert.equal(w.row.status, "pending")
  assert.equal(w.row.reason_code, "busy")
  assert.equal(w.row.attempts, 0, "a busy lock is not a failed attempt")
  assert.equal((w.row.patch?.next_attempt_at as Date).toISOString(), "2026-10-06T10:01:00.000Z")
})

test("exactly once: a claim another process holds means nothing happens here", async () => {
  const w = world({ claimTaken: true })
  assert.deepEqual(await processImport(w.row, ports(w)), { kind: "busy" })
  assert.equal(w.created, 0)
})

test("import: a failed read of the form is retried later, a 404 is held", async () => {
  const w = world({ fetchError: Object.assign(new Error("Allegro 503"), { status: 503 }) })
  const out = await processImport(w.row, ports(w))
  assert.equal(out.kind, "retry")
  assert.equal(w.row.status, "pending")
  assert.ok(w.row.patch?.next_attempt_at instanceof Date)
  const gone = world({ fetchError: Object.assign(new Error("not found"), { status: 404 }) })
  assert.equal((await processImport(gone.row, ports(gone))).kind, "held")
})

test("import: an oversell found before the order is held with the reason", async () => {
  const w = world({ stockProblem: "KS-WK-18V: Allegro sold 1 and Medusa has 0 available. This is an oversell." })
  const out = await processImport(w.row, ports(w))
  assert.equal(out.kind, "held")
  assert.equal(w.row.reason_code, "stock")
  assert.equal(w.created, 0)
})

test("import: Medusa refusing the data holds the order; an unexpected error retries, then holds", async () => {
  const refused = world({ createError: Object.assign(new Error("Some variant does not have the required inventory"), { type: "not_allowed" }) })
  assert.equal((await processImport(refused.row, ports(refused))).kind, "held")
  assert.equal(refused.row.reason_code, "workflow_error")

  const flaky = world({ createError: new Error("connection reset") })
  assert.equal((await processImport(flaky.row, ports(flaky))).kind, "retry")
  assert.equal(flaky.row.status, "pending")
  assert.equal(flaky.row.reason_code, "create_failed")

  const tired = world({ createError: new Error("connection reset") })
  tired.row = { ...tired.row, attempts: 4 }
  assert.equal((await processImport(tired.row, ports(tired))).kind, "held")
  assert.equal(tired.row.reason_code, "too_many_attempts")
})

test("import: a total that differs from Allegro is imported and flagged", async () => {
  const w = world({ total: { value: 150, currency: "PLN" } })
  const out = await processImport(w.row, ports(w))
  assert.equal(out.kind, "imported")
  assert.equal(w.row.total_mismatch, true)
  assert.equal(w.row.reason_code, "total_mismatch")
})

test("import: a lost lease right after the draft stops before anything else; the next run finishes the draft", async () => {
  const w = world({ leaseLost: true })
  const out = await processImport(w.row, ports(w))
  assert.equal(out.kind, "lost")
  assert.equal(w.created, 1)
  assert.equal(w.placed, 0, "not placed by a process that lost its claim")
  w.leaseLost = false
  w.row = { ...w.row, status: "unknown", claim: null }
  assert.equal((await processImport(w.row, ports(w))).kind, "adopted")
  assert.equal(w.created, 1)
  assert.equal(w.placed, 1)
})

test("import: a cash on delivery order is placed but not marked paid", async () => {
  const w = world()
  const cod = { ...form(), payment: { ...form().payment, type: "CASH_ON_DELIVERY", paidAmount: null } } as CheckoutForm
  const p = ports(w)
  p.fetchForm = async () => cod
  assert.equal((await processImport(w.row, p)).kind, "imported")
  assert.equal(w.placed, 1)
  assert.equal(w.paidMarks, 0)
})

test("tax lines: only what came out without any gets the forced calculation", () => {
  assert.deepEqual(
    untaxedIds([{ id: "i1", tax_lines: [{ id: "t1" }] }, { id: "i2", tax_lines: [] }, { id: "i3" }, null, { id: "i4", tax_lines: [null] }]),
    ["i2", "i3", "i4"],
  )
  assert.deepEqual(untaxedIds(null), [])
})

test("item quantity: Query's quantity, else the detail, else the raw value; never a zero by accident", () => {
  assert.equal(itemQuantity({ quantity: 2 }), 2)
  assert.equal(itemQuantity({ quantity: undefined, detail: { quantity: 3 } }), 3)
  assert.equal(itemQuantity({ raw_quantity: { value: "4" } }), 4)
  assert.equal(itemQuantity({ quantity: "0", detail: { quantity: 5 } }), 5)
  assert.equal(itemQuantity(null), 0)
})

test("cancellation: cancel only when nothing is fulfilled, otherwise ask a person", () => {
  assert.deepEqual(cancelDecision({ status: "pending", activeFulfillments: 0 }), { kind: "cancel" })
  assert.equal(cancelDecision({ status: "pending", activeFulfillments: 1 }).kind, "attention")
  assert.equal(cancelDecision({ status: "completed", activeFulfillments: 0 }).kind, "attention")
  assert.equal(cancelDecision({ status: "canceled", activeFulfillments: 0 }).kind, "already")
  assert.equal(cancelDecision(null).kind, "gone")
})
