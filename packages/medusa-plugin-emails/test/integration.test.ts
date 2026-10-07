/**
 * E-mails in the koda.integration/1 contract: the shared conformance checks
 * on sample rows for orders and customers, then what the plugin itself
 * promises: the worst message of a record speaks, test sends never count,
 * a customer's line covers the e-mails of their guest orders (by the hash of
 * the address), metadata changes nothing, the counters count one grouped
 * read of the last 7 days and link to filters the page reads, and answering
 * never writes.
 */
import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { MESSAGE_FILTERS, MESSAGE_WINDOWS } from "../src/modules/emails/lib/contract.ts"
import { COUNTER_LINKS } from "../src/modules/emails/lib/integration.ts"
import { addressHash } from "../src/modules/emails/lib/keys.ts"
import { makeContext } from "../src/modules/emails/lib/kit-routes.ts"
import { resolveOptions, type EmailsPluginOptions } from "../src/modules/emails/lib/options.ts"
import { forgetProvider, noteProvider } from "../src/modules/emails/lib/provider-status.ts"
import type { MessageRow, NewMessage } from "../src/modules/emails/lib/store.ts"
import { emailsIntegration } from "../src/workflows/emails/integration.ts"
import { conformance } from "./kit-conformance.ts"
import { LIVE, logger, memoryStore, type MemoryStore } from "./helpers.ts"

beforeEach(() => forgetProvider())

type Row = Record<string, any>

const A = "order_01EMAILS0000000000000001"
const B = "order_01EMAILS0000000000000002"
const C = "order_01EMAILS0000000000000003"
const D = "order_01EMAILS0000000000000004"
const ANNA = "cus_01EMAILSANNA"
const PIOTR = "cus_01EMAILSPIOTR"
const HOUR = 3600 * 1000

function setup(options: EmailsPluginOptions = LIVE) {
  const resolved = resolveOptions(options)
  const store = memoryStore()
  const queries: Row[] = []
  const customers: Row[] = [
    { id: ANNA, email: "Anna@example.com", metadata: { emails_bounced: true, marketplace_order_ref: "allegro:1" } },
    { id: PIOTR, email: "piotr@example.com", metadata: {} },
  ]
  const svc = { getOptions: () => resolved, isDemo: () => resolved.demo, getLogger: () => logger(), mask: (t: string) => t }
  const query = {
    graph: async (args: Row) => {
      queries.push(args)
      if (args.entity !== "customer") return { data: [] }
      const ids: string[] = args.filters?.id ?? []
      return { data: customers.filter((c) => ids.includes(c.id)) }
    },
  }
  const registry: Record<string, unknown> = { emails: svc, query, emailsMessageStore: store }
  const scope = {
    resolve(key: string, o?: { allowUnregistered?: boolean }) {
      if (key in registry) return registry[key]
      if (o?.allowUnregistered) return undefined
      throw new Error(`not registered: ${key}`)
    },
  }
  return { scope, store, queries, customers }
}

let seq = 0
async function add(store: MemoryStore, extra: Partial<NewMessage> & { status: MessageRow["status"]; error_code?: string | null; hoursAgo?: number }): Promise<void> {
  seq += 1
  const { hoursAgo = 1, ...rest } = extra
  await store.record({
    key: `emails:test-row:${seq}`,
    template: "order.placed",
    locale: "pl",
    demo: false,
    kind: "event",
    recipient: "a***@e***.com",
    subject: "S",
    trigger: null,
    resource_type: null,
    resource_id: null,
    order_id: null,
    notification_id: null,
    requested_by: null,
    created_at: new Date(Date.now() - hoursAgo * HOUR),
    ...rest,
  } as Parameters<MemoryStore["record"]>[0])
}

async function sample() {
  const s = setup()
  const anna = addressHash("anna@example.com")
  /* A: confirmed, then the shipping e-mail failed. */
  await add(s.store, { status: "sent", order_id: A, customer_id: ANNA, recipient_hash: anna, hoursAgo: 30 })
  await add(s.store, { status: "failed", template: "order.shipped", order_id: A, customer_id: ANNA, recipient_hash: anna, error_code: "validation_error", hoursAgo: 2 })
  /* B: may not have gone out. */
  await add(s.store, { status: "unknown", order_id: B, customer_id: PIOTR, recipient_hash: addressHash("piotr@example.com"), error_code: "TIMEOUT" })
  /* C: a guest order of Anna (no customer id), sent; and a test send that must not count. */
  await add(s.store, { status: "sent", order_id: C, customer_id: null, recipient_hash: anna, hoursAgo: 3 })
  await add(s.store, { status: "failed", kind: "test", order_id: C, error_code: "validation_error" })
  /* D: only skipped, the template is off. */
  await add(s.store, { status: "skipped", order_id: D, error_code: "TEMPLATE_OFF" })
  /* Piotr's welcome was refused for the address. */
  await add(s.store, { status: "failed", template: "customer.welcome", customer_id: PIOTR, recipient_hash: addressHash("piotr@example.com"), error_code: "INVALID_RECIPIENT" })
  s.store.writes.length = 0
  return s
}

{
  const s = await sample()
  conformance({ routes: emailsIntegration, scope: s.scope, entity: "order", knownIds: [A, B, C, D], writes: () => s.store.writes })
}
{
  const s = await sample()
  conformance({ routes: emailsIntegration, scope: s.scope, entity: "customer", knownIds: [ANNA, PIOTR], writes: () => s.store.writes })
}

const en = (scope: unknown) => makeContext({ scope: scope as never, lang: "en" })

test("the worst message of an order speaks: a failed shipping e-mail turns the card red, with the template's name", async () => {
  const s = await sample()
  const [a, b, c, d] = await emailsIntegration.build.summaries(en(s.scope), "order", [A, B, C, D])
  assert.equal(a.state, "failed")
  assert.equal(a.tone, "red")
  assert.equal(a.title.fallback, "Order shipped: not sent")
  assert.equal(a.detail?.key, "integration.order.latest", "the confirmation that went out")
  assert.deepEqual(a.counts, { total: 2, sent: 1, failed: 1, unknown: 0, sending: 0, skipped: 0 })
  assert.deepEqual(a.links, [{ kind: "admin", href: `/emails?order_id=${A}` }])
  assert.equal(a.widget, "emails.order")
  assert.equal(b.state, "attention")
  assert.equal(b.detail?.key, "integration.order.checkResend")
  assert.equal(c.state, "ok", "the failed test send to the order never counts")
  assert.equal(c.title.fallback, "1 e-mail sent")
  assert.equal(d.state, "none")
  assert.equal(d.title.fallback, "Order confirmation: not sent, the template is off")
  const [none] = await emailsIntegration.build.summaries(en(s.scope), "order", ["order_01NOTHING"])
  assert.equal(none.state, "none")
})

test("Polish lines read right for any template, plurals included", async () => {
  const s = await sample()
  const pl = makeContext({ scope: s.scope as never, lang: "pl" })
  const [a] = await emailsIntegration.build.summaries(pl, "order", [A])
  assert.equal(a.title.fallback, "Zamówienie wysłane: nie wysłano")
  assert.equal(a.title.params?.template, "Zamówienie wysłane", "the name of the template in the answer's language")
  for (let i = 0; i < 5; i++) await add(s.store, { status: "sent", order_id: "order_01MANY", template: i % 2 ? "order.shipped" : "order.placed" })
  const [many] = await emailsIntegration.build.summaries(pl, "order", ["order_01MANY"])
  assert.equal(many.title.fallback, "Wysłano 5 e-maili")
  const [few] = await emailsIntegration.build.summaries(pl, "order", [C])
  assert.equal(few.title.fallback, "Wysłano 1 e-mail")
})

test("a customer's line covers the customer's own e-mails and those of guest orders to the same address; a refused address waits for a person", async () => {
  const s = await sample()
  const [anna, piotr] = await emailsIntegration.build.summaries(en(s.scope), "customer", [ANNA, PIOTR])
  assert.equal(anna.state, "failed", "the failed shipping e-mail of order A")
  assert.equal(anna.counts.total, 3, "two e-mails of her account and the one of her guest order")
  assert.deepEqual(anna.links, [{ kind: "admin", href: `/emails?customer_id=${ANNA}` }])
  assert.equal(anna.widget, null)
  assert.equal(piotr.state, "attention")
  assert.equal(piotr.title.fallback, "Welcome: the address was refused")
  assert.equal(piotr.detail?.key, "integration.customer.more", "and the unclear order e-mail")
  const reads = s.queries.filter((q) => q.entity === "customer")
  assert.equal(reads.length, 1, "all customers in one read, by id")
  assert.deepEqual(reads[0].fields, ["id", "email"])
})

test("metadata changes nothing: the line comes from the send log only", async () => {
  const s = await sample()
  const before = await emailsIntegration.build.summaries(en(s.scope), "customer", [ANNA])
  s.customers[0].metadata = {}
  const after = await emailsIntegration.build.summaries(en(s.scope), "customer", [ANNA])
  assert.deepEqual(after, before)
})

test("demo mode: sent e-mails read as simulated", async () => {
  const s = setup({ ...LIVE, demo: true })
  await add(s.store, { status: "sent", demo: true, order_id: A })
  await add(s.store, { status: "sent", demo: false, order_id: A, template: "order.shipped" })
  const [a] = await emailsIntegration.build.summaries(en(s.scope), "order", [A])
  assert.equal(a.title.fallback, "1 e-mail simulated", "the rows of the other mode never count")
})

test("board counters: one grouped read of the last 7 days, linked to filters the page reads", async () => {
  const s = await sample()
  await add(s.store, { status: "failed", order_id: "order_01OLD", hoursAgo: 8 * 24 })
  await add(s.store, { status: "failed", order_id: null, template: "customer.welcome", error_code: "INVALID_RECIPIENT", recipient_hash: addressHash("piotr@example.com") })
  const reads = s.store.writes.length
  const a = await emailsIntegration.build.attention(en(s.scope), ["orders", "customers"])
  const by = Object.fromEntries(a.items.map((c) => [c.key, c]))
  assert.equal(by.messages_failed.count, 2, "A's shipping e-mail and B's unclear one; the old one and the test send are out")
  assert.equal(by.messages_failed.tone, "red")
  assert.equal(by.messages_failed.scope, "orders")
  assert.equal(by.bounced.count, 1, "one address, refused twice")
  assert.equal(by.bounced.tone, "orange")
  assert.equal(by.bounced.scope, "customers")
  assert.equal(by.messages_failed.label.fallback, "E-mails not sent")
  for (const c of a.items) {
    const url = new URL(c.link.href, "https://admin.example.com")
    assert.equal(url.pathname, "/emails")
    assert.ok(MESSAGE_FILTERS.includes(url.searchParams.get("filter") as never), c.key)
    assert.ok(MESSAGE_WINDOWS.includes(url.searchParams.get("since") as never), c.key)
  }
  assert.deepEqual(Object.values(COUNTER_LINKS).sort(), a.items.map((c) => c.link.href).sort())
  assert.equal(s.store.writes.length, reads)
  const onlyOrders = await emailsIntegration.build.attention(en(s.scope), ["orders"])
  assert.deepEqual(onlyOrders.items.map((c) => c.key), ["messages_failed"])
})

test("the manifest: demo only when switched on, no key says Log only, a missing provider and another mode are problems", async () => {
  const off = await emailsIntegration.build.manifest(en(setup({ ...LIVE, apiKey: undefined }).scope))
  assert.equal(off.mode, "off")
  assert.equal(off.configured, false)
  assert.deepEqual(off.problems.map((p) => p.key), ["integration.problem.no_key", "integration.problem.no_provider"])
  noteProvider({ ...LIVE, channels: ["email"] })
  const live = await emailsIntegration.build.manifest(en(setup().scope))
  assert.equal(live.mode, "live")
  assert.deepEqual(live.problems, [])
  assert.deepEqual(live.widgets, [{ id: "emails.order", zone: "order.details" }])
  assert.deepEqual(live.entities, ["order", "customer"])
  assert.equal(live.adminPath, "/emails")
  const demo = await emailsIntegration.build.manifest(en(setup({ ...LIVE, demo: true }).scope))
  assert.equal(demo.mode, "demo")
  assert.deepEqual(demo.problems.map((p) => p.key), ["integration.problem.demo", "integration.problem.mode_differs"])
})
