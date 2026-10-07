/**
 * The flows inside Medusa, with a fake container: every event reads what it
 * needs, applies the skip rules and the switches, and hands the notification
 * module the right template, data and key. Also the abandoned cart job, a
 * person's retry, the demo outbox and housekeeping.
 */
import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { resolveOptions, type EmailsPluginOptions } from "../src/modules/emails/lib/options.ts"
import { createResendClient } from "../src/modules/emails/lib/resend.ts"
import { deliver, type IncomingNotification } from "../src/modules/emails/lib/send.ts"
import { EMPTY_SETTINGS, forgetSettings, templateKey } from "../src/modules/emails/lib/settings.ts"
import { forgetProvider, noteProvider } from "../src/modules/emails/lib/provider-status.ts"
import { resetPace } from "../src/modules/emails/lib/resend.ts"
import { runAbandonedCarts } from "../src/workflows/emails/abandoned-carts.ts"
import { ensureDemoOutbox } from "../src/workflows/emails/demo.ts"
import { onCustomerCreated, onNegotiation, onOrderCanceled, onOrderPlaced, onPasswordReset, onShipmentCreated, retryMessage } from "../src/workflows/emails/events.ts"
import { runHousekeeping } from "../src/workflows/emails/housekeeping.ts"
import { previewData } from "../src/workflows/emails/preview.ts"
import { resolveTemplate } from "../src/modules/emails/lib/registry.ts"
import { canRetry } from "../src/modules/emails/lib/dto.ts"
import { FakeResend, LIVE, logger, memoryStore, type MemoryStore } from "./helpers.ts"

beforeEach(() => {
  forgetSettings()
  forgetProvider()
  resetPace()
})

type Row = Record<string, any>

const HOUR = 3600 * 1000

function fixtures(): Record<string, Row[]> {
  const now = Date.now()
  return {
    order: [
      {
        id: "order_1",
        display_id: 1042,
        email: "anna@example.com",
        currency_code: "pln",
        created_at: new Date(now - 2 * HOUR).toISOString(),
        metadata: {},
        customer_id: "cus_1",
        total: 100,
        item_total: 90,
        shipping_total: 10,
        tax_total: 18.7,
        items: [{ id: "li_1", product_title: "Lamp", variant_sku: "L-1", quantity: 2, unit_price: 45 }],
        shipping_address: { first_name: "Anna", city: "Poznań", country_code: "pl" },
        fulfillments: [],
      },
      { id: "order_2", display_id: 1043, email: "bob@example.com", metadata: { marketplace_order_ref: "allegro:9" }, items: [] },
    ],
    fulfillment: [
      {
        id: "ful_1",
        shipped_at: new Date(now - HOUR).toISOString(),
        provider_id: "manual_manual",
        labels: [{ tracking_number: "TN-1", tracking_url: "https://track.example.com/TN-1" }],
        items: [{ title: "Lamp", quantity: 2, line_item_id: "li_1" }],
        order: { id: "order_1" },
      },
    ],
    customer: [
      { id: "cus_1", email: "anna@example.com", first_name: "Anna", has_account: true, created_at: new Date(now - HOUR).toISOString(), metadata: { locale: "pl" } },
      { id: "cus_guest", email: "guest@example.com", has_account: false },
      { id: "cus_2", email: "piotr@example.com", first_name: "Piotr", has_account: true, created_at: new Date(now - 5 * HOUR).toISOString(), metadata: {} },
    ],
    user: [{ id: "user_1", email: "admin@example.com", first_name: "Remik" }],
    product_variant: [{ id: "variant_1", title: "Black", sku: "CH-1", product: { title: "Chair" } }],
    cart: [
      { id: "cart_old", email: "c1@example.com", currency_code: "pln", updated_at: new Date(now - 30 * HOUR).toISOString(), items: [{ title: "Lamp", quantity: 1, unit_price: 45 }], item_total: 45 },
      { id: "cart_two", email: "c2@example.com", updated_at: new Date(now - 30 * HOUR).toISOString(), items: [{ title: "Lamp", quantity: 1, unit_price: 45 }] },
      { id: "cart_empty", email: "c3@example.com", updated_at: new Date(now - 30 * HOUR).toISOString(), items: [] },
    ],
  }
}

function matches(row: Row, filters: Row): boolean {
  return Object.entries(filters ?? {}).every(([k, v]) => {
    if (v === null) return row[k] === null || row[k] === undefined
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if ("$ne" in v) return row[k] !== null && row[k] !== undefined
      const at = new Date(row[k]).getTime()
      if ("$lt" in v && !(at < new Date(v.$lt).getTime())) return false
      if ("$gt" in v && !(at > new Date(v.$gt).getTime())) return false
      return true
    }
    return row[k] === v
  })
}

interface Setup {
  scope: { resolve(key: string, o?: { allowUnregistered?: boolean }): any }
  data: Record<string, Row[]>
  store: MemoryStore
  sent: Row[]
  graphs: Row[]
  log: ReturnType<typeof logger>
  /** Resend behind the client the direct path uses (messages with a secret link). */
  resend: FakeResend
}

/**
 * A fake Medusa container. `provider: true` registers the plugin's provider
 * in this process (its note and options), as Medusa does at boot: messages
 * with a secret link (the password reset) go to it directly.
 */
function setup(options: EmailsPluginOptions = LIVE, opts: { failSend?: boolean; provider?: boolean } = {}): Setup {
  const resolved = resolveOptions(options)
  const data = fixtures()
  const store = memoryStore()
  const sent: Row[] = []
  const graphs: Row[] = []
  const log = logger()
  const svc = {
    getOptions: () => resolved,
    isDemo: () => resolved.demo,
    getLogger: () => log,
    mask: (t: string) => t,
  }
  const query = {
    graph: async (args: Row) => {
      graphs.push(args)
      const rows = (data[args.entity] ?? []).filter((r) => matches(r, args.filters))
      const skip = args.pagination?.skip ?? 0
      return { data: args.pagination?.take ? rows.slice(skip, skip + args.pagination.take) : rows.slice(skip) }
    },
  }
  const notifications = {
    createNotifications: async (input: Row) => {
      if (opts.failSend) throw new Error("Could not find a notification provider for channel: email")
      sent.push(input)
      return { ...input, status: "success", external_id: `re_${sent.length}` }
    },
  }
  const resend = new FakeResend()
  if (opts.provider) noteProvider({ ...options, channels: ["email"] })
  const registry: Record<string, unknown> = {
    emails: svc,
    query,
    notification: notifications,
    emailsMessageStore: store,
    emailsResendClient: createResendClient({ apiKey: resolved.apiKey, timeoutMs: 2000, maxRetries: 0, requestsPerSecond: 1000, fetch: resend.fetch, sleep: async () => {}, random: () => 0.5 }),
    configModule: { admin: { backendUrl: "https://api.example.com", path: "/app" } },
  }
  return {
    scope: {
      resolve(key: string, o?: { allowUnregistered?: boolean }) {
        if (key in registry) return registry[key]
        if (o?.allowUnregistered) return undefined
        throw new Error(`not registered: ${key}`)
      },
    },
    data,
    store,
    sent,
    graphs,
    log,
    resend,
  }
}

test("order.placed: the template, the address, the data and one key per order", async () => {
  const s = setup()
  const r = await onOrderPlaced(s.scope, "order_1")
  assert.deepEqual(r, { status: "sent" })
  assert.equal(s.sent.length, 1)
  const n = s.sent[0]
  assert.equal(n.template, "order.placed")
  assert.equal(n.channel, "email")
  assert.equal(n.to, "anna@example.com")
  assert.equal(n.idempotency_key, "emails:order.placed:order_1")
  assert.equal(n.trigger_type, "order.placed")
  assert.equal(n.resource_type, "order")
  assert.equal(n.receiver_id, "cus_1")
  assert.deepEqual(n.provider_data.emails, { key: "emails:order.placed:order_1", kind: "event", orderId: "order_1", customerId: "cus_1", requestedBy: null, retry: false })
  assert.equal(n.data.order_number, "1042")
  assert.equal(n.data.items[0].title, "Lamp")
  assert.ok(s.graphs[0].fields.includes("locale"), "newer columns are asked for first")
})

test("marketplace orders and switched-off templates create no notification", async () => {
  const s = setup()
  assert.equal((await onOrderPlaced(s.scope, "order_2")).status, "skipped")
  await s.store.setSetting(templateKey(false, "order.canceled"), { on: false }, "user_1")
  forgetSettings()
  assert.equal((await onOrderCanceled(s.scope, "order_1")).status, "disabled")
  assert.equal(s.sent.length, 0)
})

test("Query refusing the newer columns: the read is repeated without them", async () => {
  const s = setup()
  const query = s.scope.resolve("query")
  const original = query.graph
  query.graph = async (args: Row) => {
    if (args.fields.includes("custom_display_id")) throw new Error("Trying to query by not existing property Order.custom_display_id")
    return original(args)
  }
  assert.equal((await onOrderPlaced(s.scope, "order_1")).status, "sent")
})

test("shipment.created: skipped with no_notification, otherwise the tracking goes out under the fulfillment's key", async () => {
  const s = setup()
  assert.equal((await onShipmentCreated(s.scope, "ful_1", true)).status, "skipped")
  assert.equal((await onShipmentCreated(s.scope, "ful_1", false)).status, "sent")
  const n = s.sent[0]
  assert.equal(n.template, "order.shipped")
  assert.equal(n.idempotency_key, "emails:order.shipped:ful_1")
  assert.deepEqual(n.data.tracking, [{ number: "TN-1", url: "https://track.example.com/TN-1", carrier: null }])
  assert.equal(n.provider_data.emails.orderId, "order_1")
})

test("customer.created: guests get nothing, registered customers a welcome in their language", async () => {
  const s = setup()
  assert.equal((await onCustomerCreated(s.scope, "cus_guest")).status, "skipped")
  assert.equal((await onCustomerCreated(s.scope, "cus_1")).status, "sent")
  assert.equal(s.sent[0].data.locale, "pl")
  assert.equal(s.sent[0].idempotency_key, "emails:customer.welcome:cus_1")
})

test("auth.password_reset: the link with the token reaches only Resend, never Medusa's notification table, a log line or a key", async () => {
  const s = setup(LIVE, { provider: true })
  assert.equal((await onPasswordReset(s.scope, { entity_id: "anna@example.com", actor_type: "customer", token: "tok-123" })).status, "sent")
  assert.equal(s.sent.length, 0, "no notification: GET /admin/notifications would hand the token to every admin user")
  const toAnna = s.resend.calls[0]
  assert.match(toAnna.body.html, /https:\/\/shop\.example\.com\/reset-password\?token=tok-123&amp;email=anna%40example\.com/)
  assert.ok(!toAnna.headers["idempotency-key"].includes("tok-123"))
  assert.equal((await onPasswordReset(s.scope, { entity_id: "admin@example.com", actor_type: "user", token: "tok-9" })).status, "sent")
  assert.ok(String(s.resend.calls[1].body.text).includes("https://api.example.com/app/reset-password?token=tok-9&email=admin%40example.com"))
  assert.equal((await onPasswordReset(s.scope, { entity_id: "x@example.com", actor_type: "vendor", token: "t" })).status, "skipped")
  assert.ok(s.log.lines.every((l) => !l.includes("tok-123") && !l.includes("tok-9")))
  const rows = s.store.rows.filter((r) => r.template === "password.reset")
  assert.equal(rows.length, 2)
  assert.ok(rows.every((r) => r.status === "sent" && !JSON.stringify(r).includes("tok-")), "the log keeps no token")
  assert.equal(rows[0].customer_id, "cus_1", "the customer's reset is on the customer's page")
})

test("auth.password_reset without the provider registered in this process: not sent at all, never through Medusa's notifications", async () => {
  const s = setup()
  const r = await onPasswordReset(s.scope, { entity_id: "anna@example.com", actor_type: "customer", token: "tok-123" })
  assert.equal(r.status, "no_provider")
  assert.equal(s.sent.length, 0)
  assert.equal(s.resend.calls.length, 0)
  const row = s.store.rows.find((x) => x.template === "password.reset")
  assert.equal(row?.status, "failed")
  assert.equal(row?.error_code, "NO_PROVIDER")
  assert.ok(!JSON.stringify(s.store.rows).includes("tok-123"))
})

test("auth.password_reset: at most passwordResetsPerHour e-mails to one address in an hour; the rest are logged as skipped", async () => {
  const s = setup({ ...LIVE, passwordResetsPerHour: 2 }, { provider: true })
  const ask = (email: string, token: string) => onPasswordReset(s.scope, { entity_id: email, actor_type: "customer", token })
  assert.equal((await ask("anna@example.com", "t-1")).status, "sent")
  assert.equal((await ask("Anna@Example.com ", "t-2")).status, "sent", "the same address, typed otherwise")
  const third = await ask("anna@example.com", "t-3")
  assert.deepEqual(third, { status: "skipped", reason: "THROTTLED" })
  assert.equal((await ask("piotr@example.com", "t-4")).status, "sent", "another address has its own limit")
  assert.equal(s.resend.calls.length, 3)
  const throttled = s.store.rows.filter((r) => r.error_code === "THROTTLED")
  assert.equal(throttled.length, 1)
  assert.equal(throttled[0].status, "skipped")
  assert.ok(s.log.lines.some((l) => l.startsWith("warn") && l.includes("At most 2 password.reset e-mails")))
})

test("demo mode handles no password reset of an admin user, and keeps a customer's reset with the link hidden", async () => {
  const s = setup({ ...LIVE, demo: true }, { provider: true })
  const admin = await onPasswordReset(s.scope, { entity_id: "admin@example.com", actor_type: "user", token: "eyJhbGciOiJIUzI1NiJ9.eyJlbnRpdHlfaWQiOiJhZG1pbiJ9.c2lnbmF0dXJlMTIz" })
  assert.equal(admin.status, "skipped")
  const skipped = s.store.rows.find((r) => r.error_code === "DEMO_ADMIN_RESET")
  assert.equal(skipped?.status, "skipped")
  assert.equal((await onPasswordReset(s.scope, { entity_id: "anna@example.com", actor_type: "customer", token: "eyJhbGciOiJIUzI1NiJ9.eyJjdXN0b21lciI6ImFubmEifQ.c2lnbmF0dXJlNDU2" })).status, "sent")
  assert.equal(s.resend.calls.length, 0, "demo mode never calls Resend")
  const kept = s.store.rows.find((r) => r.template === "password.reset" && r.status === "sent")
  assert.ok(kept?.body_html && kept.body_text, "the outbox shows the message")
  assert.ok(!String(kept?.body_html).includes("eyJ") && !String(kept?.body_text).includes("eyJ"), "but never the token")
  assert.ok(String(kept?.body_html).includes("https://link.hidden.invalid/"))
})

test("negotiations: off by default; on, the price in major units; a demo negotiation never mails in live mode", async () => {
  /* The event data of the Koda Plus negotiations plugin. */
  const event = {
    id: "neg_1",
    ref: "NEG-2026-1001",
    status: "counter_offered",
    previous_status: "open",
    subject: "variant",
    customer_id: "cus_1",
    product_id: "prod_1",
    variant_id: "variant_1",
    cart_id: null,
    sku: "CH-1",
    qty: 12,
    price: "469.00",
    price_amount: 46900,
    currency_code: "pln",
    expires_at: "2026-10-14T10:00:00.000Z",
    actor: "admin",
    actor_id: "user_1",
    message_id: null,
    demo: false,
  }
  const off = setup()
  assert.equal((await onNegotiation(off.scope, "negotiation.countered", event)).status, "disabled")
  const on = setup({ ...LIVE, templates: { "negotiation.countered": true, "negotiation.accepted": true, "negotiation.rejected": true } })
  assert.equal((await onNegotiation(on.scope, "negotiation.countered", event)).status, "sent")
  const n = on.sent[0]
  assert.equal(n.data.price, 469)
  assert.equal(n.data.subject, "variant")
  assert.equal(n.data.expires_at, "2026-10-14T10:00:00.000Z")
  assert.equal(n.data.product_title, "Chair")
  assert.equal(n.data.variant_title, "Black")
  assert.equal((await onNegotiation(on.scope, "negotiation.countered", { ...event, price: "450.00", price_amount: 45000 })).status, "sent")
  assert.notEqual(on.sent[1].idempotency_key, n.idempotency_key, "every counter offer is its own message")
  assert.equal((await onNegotiation(on.scope, "negotiation.accepted", { ...event, demo: true })).status, "skipped")
  assert.equal((await onNegotiation(on.scope, "negotiation.rejected", { ...event, status: "rejected", actor: "customer" })).status, "skipped", "the customer declined it")
  assert.equal((await onNegotiation(on.scope, "negotiation.rejected", { ...event, status: "rejected", actor: "admin" })).status, "sent")
  assert.equal((await onNegotiation(on.scope, "negotiation.unknown", event)).status, "skipped")
})

test("a failing notification module is reported, never thrown, and the e-mail gets a failed row a person can retry", async () => {
  const s = setup(LIVE, { failSend: true })
  const r = await onOrderPlaced(s.scope, "order_1")
  assert.equal(r.status, "failed")
  assert.ok(s.log.lines.some((l) => l.startsWith("warn") && l.includes("notification provider")))
  const row = s.store.rows[0]
  assert.equal(row.key, "emails:order.placed:order_1")
  assert.equal(row.status, "failed")
  assert.equal(row.error_code, "PRE_SEND")
  assert.equal(row.order_id, "order_1")
  assert.equal(row.customer_id, "cus_1")
  assert.equal(row.recipient, "a***@e***.com")
  assert.ok(canRetry(row), "the page offers Retry")
})

test("an e-mail that fails before the provider (Query down) gets a failed row under the event's key; a duplicate delivery of the event writes nothing", async () => {
  const s = setup()
  const query = s.scope.resolve("query")
  const original = query.graph
  query.graph = async () => {
    throw new Error("Knex: Timeout acquiring a connection. The pool is probably full.")
  }
  assert.equal((await onOrderPlaced(s.scope, "order_1")).status, "failed")
  assert.equal(s.store.rows[0].key, "emails:order.placed:order_1")
  assert.equal(s.store.rows[0].error_code, "PRE_SEND")
  assert.equal(s.store.rows[0].resource_id, "order_1")
  query.graph = original
  /* A person's retry takes that row over. */
  assert.equal((await retryMessage(s.scope, s.store.rows[0], "user_1")).status, "sent")
  assert.equal(s.sent[0].provider_data.emails.retry, true)

  const dup = setup()
  dup.scope.resolve("notification").createNotifications = async () => {
    throw Object.assign(new Error("Notification with idempotency_key: emails:order.placed:order_1, already exists."), { type: "invalid_data" })
  }
  assert.deepEqual(await onOrderPlaced(dup.scope, "order_1"), { status: "skipped", reason: "duplicate" })
  assert.equal(dup.store.rows.length, 0, "the other delivery owns the key: a failed row here would stop it")
})

test("settings that cannot be read before any were read: the subscriber sends nothing and logs SETTINGS_UNAVAILABLE", async () => {
  const s = setup()
  s.store.settings = async () => {
    throw new Error("Connection terminated unexpectedly")
  }
  assert.equal((await onOrderPlaced(s.scope, "order_1")).status, "failed")
  assert.equal(s.sent.length, 0)
  assert.equal(s.store.rows[0].error_code, "SETTINGS_UNAVAILABLE")
})

test("abandoned carts: off by default; on, one reminder per usable cart, never twice", async () => {
  const off = setup()
  assert.deepEqual(await runAbandonedCarts(off.scope), { checked: 0, sent: 0, skipped: 0, failed: 0, off: true })
  const s = setup({ ...LIVE, templates: { "cart.abandoned": true } })
  const run = await runAbandonedCarts(s.scope)
  assert.equal(run?.sent, 2, "the empty cart is left out")
  assert.deepEqual(s.sent.map((n) => n.idempotency_key).sort(), ["emails:cart.abandoned:cart_old", "emails:cart.abandoned:cart_two"])
  const cartQuery = s.graphs.find((g) => g.entity === "cart")
  assert.equal(cartQuery?.filters.completed_at, null)
  assert.ok(cartQuery?.filters.updated_at.$lt instanceof Date && cartQuery.filters.updated_at.$gt instanceof Date)
  await s.store.record({ key: "emails:cart.abandoned:cart_old", template: "cart.abandoned", locale: "pl", demo: false, kind: "job", recipient: null, subject: null, trigger: null, resource_type: "cart", resource_id: "cart_old", order_id: null, notification_id: null, requested_by: null, status: "sent" })
  await s.store.record({ key: "emails:cart.abandoned:cart_two", template: "cart.abandoned", locale: "pl", demo: false, kind: "job", recipient: null, subject: null, trigger: null, resource_type: "cart", resource_id: "cart_two", order_id: null, notification_id: null, requested_by: null, status: "sent" })
  const again = await runAbandonedCarts(s.scope)
  assert.equal(again?.sent, 0)
  assert.equal(again?.skipped, 2)
})

test("abandoned carts hour after hour for four days: one e-mail per cart, none for a cart idle for months, even when the job cannot read the send log", async () => {
  // A job this plugin replaced kept a "reminded" mark in the cart's metadata. The mark was never
  // written, nothing capped the cart's age, and one cart idle for months got the reminder every
  // hour. Here the job's own read of the send log fails on every run, so it offers every cart in
  // the window each hour; only the provider's claim stands between those offers and Resend.
  const start = Date.parse("2026-10-06T12:00:00.000Z")
  const idleFor = (hours: number) => new Date(start - hours * HOUR).toISOString()
  const items = [{ title: "Szlifierka kątowa 125 mm", variant_sku: "KS-ELN-125", quantity: 11, unit_price: 289 }]
  const carts: Row[] = [
    { id: "cart_months", email: "ola@example.com", currency_code: "pln", updated_at: idleFor(82 * 24), items },
    { id: "cart_ready", email: "anna@example.com", currency_code: "pln", updated_at: idleFor(30), items },
    { id: "cart_later", email: "piotr@example.com", currency_code: "pln", updated_at: idleFor(2), items },
    { id: "cart_guest", email: null, currency_code: "pln", updated_at: idleFor(30), items },
  ]
  const options = resolveOptions({ ...LIVE, templates: { "cart.abandoned": true } })
  const store = memoryStore()
  store.existingKeys = async () => {
    throw new Error("Connection terminated unexpectedly")
  }
  const resend = new FakeResend()
  const client = createResendClient({ apiKey: options.apiKey, timeoutMs: 2000, maxRetries: 0, requestsPerSecond: 1000, fetch: resend.fetch, sleep: async () => {}, random: () => 0.5 })
  const log = logger()
  let clock = start
  const registry: Record<string, unknown> = {
    emails: { getOptions: () => options, isDemo: () => false, getLogger: () => log, mask: (t: string) => t },
    query: { graph: async (args: Row) => ({ data: carts.filter((r) => matches(r, args.filters)).slice(0, args.pagination?.take) }) },
    // Medusa's notification module without its own idempotency (as if its rows were gone):
    // every notification reaches the provider's delivery.
    notification: {
      createNotifications: (n: Row) => deliver({ options, store, loadSettings: async () => EMPTY_SETTINGS, client: () => client, logger: log, now: () => new Date(clock) }, n as IncomingNotification),
    },
    emailsMessageStore: store,
  }
  const scope = {
    resolve(key: string, o?: { allowUnregistered?: boolean }) {
      if (key in registry) return registry[key]
      if (o?.allowUnregistered) return undefined
      throw new Error(`not registered: ${key}`)
    },
  }
  for (let hour = 0; hour <= 96; hour++) {
    clock = start + hour * HOUR
    await runAbandonedCarts(scope, new Date(clock))
  }
  assert.deepEqual(
    resend.calls.map((c) => c.headers["idempotency-key"]),
    ["emails:cart.abandoned:cart_ready", "emails:cart.abandoned:cart_later"],
    "97 hourly runs: one e-mail per cart idle 24 to 72 hours, none for the cart idle for months or the guest",
  )
  assert.deepEqual(
    store.rows.map((r) => [r.key, r.status]),
    [
      ["emails:cart.abandoned:cart_ready", "sent"],
      ["emails:cart.abandoned:cart_later", "sent"],
    ],
  )
})

test("abandoned carts: only carts with an address are read, page after page, so reminded carts never hide a new one", async () => {
  const s = setup({ ...LIVE, templates: { "cart.abandoned": true }, abandonedCart: { maxPerRun: 1 } })
  const now = Date.now()
  const items = [{ title: "Lamp", quantity: 1, unit_price: 45 }]
  s.data.cart = [
    { id: "cart_a", email: "a@example.com", updated_at: new Date(now - 30 * HOUR).toISOString(), items },
    { id: "cart_b", email: "b@example.com", updated_at: new Date(now - 31 * HOUR).toISOString(), items },
    { id: "cart_c", email: "c@example.com", updated_at: new Date(now - 32 * HOUR).toISOString(), items },
    { id: "cart_new", email: "d@example.com", updated_at: new Date(now - 33 * HOUR).toISOString(), items },
  ]
  for (const id of ["cart_a", "cart_b", "cart_c"]) {
    await s.store.record({ key: `emails:cart.abandoned:${id}`, template: "cart.abandoned", locale: null, demo: false, kind: "job", recipient: null, subject: null, trigger: null, resource_type: "cart", resource_id: id, order_id: null, notification_id: null, requested_by: null, status: "sent" })
  }
  const run = await runAbandonedCarts(s.scope)
  assert.equal(run?.sent, 1)
  assert.deepEqual(s.sent.map((n) => n.idempotency_key), ["emails:cart.abandoned:cart_new"], "found on the second page")
  const reads = s.graphs.filter((g) => g.entity === "cart")
  assert.ok(reads.length >= 2)
  assert.deepEqual(reads[0].filters.email, { $ne: null })
  assert.equal(reads[1].pagination.skip, 3)
})

test("previews and test sends from the newest cart or parcel carry sample ids and tracking, never the real ones", async () => {
  const s = setup({ ...LIVE, templates: { "cart.abandoned": true } })
  const o = resolveOptions({ ...LIVE, templates: { "cart.abandoned": true } })
  const cart = await previewData(s.scope, resolveTemplate("cart.abandoned", o)!, "pl", "latest")
  assert.equal(cart.source, "latest")
  assert.equal(cart.data.cart_id, "cart_sample")
  assert.equal(cart.sourceRef, "cart_old", "the page still says which cart it came from")
  const parcel = await previewData(s.scope, resolveTemplate("order.shipped", o)!, "en", "latest")
  assert.equal(parcel.data.order_id, "order_sample")
  assert.ok(!JSON.stringify(parcel.data).includes("TN-1") && !JSON.stringify(parcel.data).includes("track.example.com"), "no real tracking number")
  assert.ok(!JSON.stringify(parcel.data).includes("Anna"))
})

test("a person's retry reads the order again and asks the provider to take the row over, under a new Medusa key", async () => {
  const s = setup()
  const row = await s.store.record({ key: "emails:order.placed:order_1", template: "order.placed", locale: "pl", demo: false, kind: "event", recipient: "a***@e***.com", subject: "S", trigger: "order.placed", resource_type: "order", resource_id: "order_1", order_id: "order_1", notification_id: null, requested_by: null, status: "failed", error_code: "validation_error" })
  const r = await retryMessage(s.scope, row!, "user_9")
  assert.equal(r.status, "sent")
  const n = s.sent[0]
  assert.match(n.idempotency_key, /^emails:order\.placed:order_1:retry:1:/)
  assert.equal(n.provider_data.emails.key, "emails:order.placed:order_1")
  assert.equal(n.provider_data.emails.retry, true)
  assert.equal(n.provider_data.emails.requestedBy, "user_9")
})

const SEED_KEYS = ["emails:customer.welcome:cus_1", "emails:customer.welcome:cus_2", "emails:order.placed:order_1", "emails:order.shipped:ful_1"]
const at = (row: Row | undefined) => new Date(row?.created_at).getTime()
const keysOf = (s: Setup) => s.store.rows.map((r) => r.key).sort()
const row = (s: Setup, key: string) => s.store.rows.find((r) => r.key === key)

test("demo mode: the outbox is seeded from the newest orders and customers, dated over the last day, with one failed welcome", async () => {
  const s = setup({ ...LIVE, demo: true })
  const now = new Date()
  assert.equal(await ensureDemoOutbox(s.scope, now), 4)
  assert.deepEqual(keysOf(s), SEED_KEYS, "the marketplace order and the guest are left out")
  assert.ok(s.store.rows.every((r) => r.demo && r.kind === "seed"))
  assert.ok(s.store.rows.some((r) => r.status === "sent" && String(r.body_html).includes("<html")))
  const failed = s.store.rows.filter((r) => r.status === "failed")
  assert.equal(failed.length, 1)
  assert.equal(failed[0].template, "customer.welcome")
  assert.equal(failed[0].error_code, "validation_error")

  /* Dated relative to the seed, not to the records: alive on the counters. */
  const hoursAgo = (key: string) => (now.getTime() - at(row(s, key))) / HOUR
  assert.ok(Math.abs(hoursAgo("emails:order.placed:order_1") - 0.4) < 0.05)
  assert.ok(at(row(s, "emails:order.shipped:ful_1")) > at(row(s, "emails:order.placed:order_1")), "the parcel leaves after its order is confirmed")
  assert.ok(Math.abs(hoursAgo("emails:customer.welcome:cus_2") - 10.5) < 0.05)
  assert.ok(s.store.rows.every((r) => at(r) <= now.getTime()))
  assert.deepEqual(await s.store.counts(true, now), { sent24h: 3, sent30d: 3, attention30d: 1, tests30d: 0, testsSent30d: 0, skipped30d: 0, refused30d: 0 })

  assert.equal(await ensureDemoOutbox(s.scope, new Date(now.getTime() + 11 * HOUR)), 0, "a fresh seed stays")
  assert.equal(await ensureDemoOutbox(setup().scope), 0, "never in live mode")
})

test("demo mode: a stale seed is rebuilt with fresh dates under the same keys; real events, tests and a retry in flight stay", async () => {
  const s = setup({ ...LIVE, demo: true })
  const t0 = new Date()
  await ensureDemoOutbox(s.scope, t0)
  const base = { template: "order.placed", locale: "pl", demo: true, recipient: null, subject: "S", trigger: null, resource_type: "order", order_id: null, notification_id: null, requested_by: null }
  await s.store.record({ ...base, key: "emails:order.placed:order_9", kind: "event", resource_id: "order_9", status: "sent", created_at: new Date(t0.getTime() - 3 * HOUR) })
  await s.store.record({ ...base, key: "emails:test:1", kind: "test", resource_id: null, status: "sent", created_at: new Date(t0.getTime() - 2 * HOUR) })
  const event = { ...row(s, "emails:order.placed:order_9")! }
  const welcome = row(s, "emails:customer.welcome:cus_1")!
  welcome.status = "sending"
  const welcomeAt = at(welcome)

  const t1 = new Date(t0.getTime() + 13 * HOUR)
  assert.equal(await ensureDemoOutbox(s.scope, t1), 3, "the welcome in the middle of a retry is not rewritten")
  assert.deepEqual(keysOf(s), [...SEED_KEYS, "emails:order.placed:order_9", "emails:test:1"].sort(), "no duplicates")
  assert.ok(Math.abs((t1.getTime() - at(row(s, "emails:order.placed:order_1"))) / HOUR - 0.4) < 0.05, "fresh dates")
  assert.equal(row(s, "emails:customer.welcome:cus_2")?.status, "failed", "the failed welcome is back for the next visitor")
  assert.equal(at(row(s, "emails:customer.welcome:cus_1")), welcomeAt)
  assert.deepEqual(row(s, "emails:order.placed:order_9"), event, "a row of a real event is never touched")
  assert.equal(row(s, "emails:test:1")?.kind, "test")
  assert.equal((await s.store.counts(true, t1)).sent24h > 0, true)
})

test("demo mode: a seed of the earlier version (dated like its records) is refreshed at once, and its leftovers go", async () => {
  const s = setup({ ...LIVE, demo: true })
  const now = new Date()
  const june = new Date("2026-06-12T09:00:00Z")
  const base = { template: "order.placed", locale: "pl", demo: true, kind: "seed" as const, recipient: null, subject: "S", trigger: null, resource_type: "order", order_id: null, notification_id: null, requested_by: null, status: "sent" as const, created_at: june }
  await s.store.record({ ...base, key: "emails:order.placed:order_1", resource_id: "order_1" })
  await s.store.record({ ...base, key: "emails:order.placed:order_gone", resource_id: "order_gone" })
  /* An event row for a record the seed would pick: the record is not seeded twice. */
  await s.store.record({ ...base, kind: "event", template: "customer.welcome", key: "emails:customer.welcome:cus_1", resource_type: "customer", resource_id: "cus_1", created_at: now })
  await s.store.setSetting("demo:seeded", { at: new Date(now.getTime() - HOUR).toISOString() }, "system")

  assert.equal(await ensureDemoOutbox(s.scope, now), 3)
  assert.deepEqual(keysOf(s), SEED_KEYS)
  assert.ok(now.getTime() - at(row(s, "emails:order.placed:order_1")) < HOUR, "the June row is dated again")
  assert.equal(row(s, "emails:customer.welcome:cus_1")?.kind, "event")
  assert.equal((await s.store.counts(true, now)).sent24h, 3)
})

test("demo mode: housekeeping rebuilds a stale seed, so the demo stays alive without visits", async () => {
  const s = setup({ ...LIVE, demo: true })
  const r = await runHousekeeping(s.scope)
  assert.equal(r?.seeded, 4)
  assert.equal((await runHousekeeping(s.scope))?.seeded, 0, "fresh")
})

test("housekeeping: a send stuck past its lease becomes unknown, old rows go", async () => {
  const s = setup()
  await s.store.claimNew(
    { key: "k1", template: "order.placed", locale: null, demo: false, kind: "event", recipient: null, subject: null, trigger: null, resource_type: null, resource_id: null, order_id: null, notification_id: null, requested_by: null },
    { token: "t", leaseUntil: new Date(Date.now() - 1000), resendKey: "k1" },
  )
  await s.store.record({ key: "k2", template: "order.placed", locale: null, demo: false, kind: "event", recipient: null, subject: null, trigger: null, resource_type: null, resource_id: null, order_id: null, notification_id: null, requested_by: null, status: "sent", created_at: new Date(Date.now() - 400 * 24 * HOUR) })
  const r = await runHousekeeping(s.scope)
  assert.deepEqual(r, { expired: 1, pruned: 1, prunedDemo: 0, seeded: 0 })
  assert.equal(s.store.rows[0].status, "unknown")
})
