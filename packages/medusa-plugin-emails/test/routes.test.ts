/**
 * The admin routes with a fake request scope: reads never write (the demo
 * outbox is built by its own POST), unexpected errors answer a plain
 * sentence, the messages of a customer and a search by the full address,
 * secret links never leave in a stored message, and the guards in front of
 * the plugin's admin routes and the store routes.
 */
import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import middlewares from "../src/api/middlewares.ts"
import { GET as statusRoute } from "../src/api/admin/emails/route.ts"
import { POST as seedRoute } from "../src/api/admin/emails/demo/seed/route.ts"
import { GET as messagesRoute } from "../src/api/admin/emails/messages/route.ts"
import { GET as messageRoute } from "../src/api/admin/emails/messages/[id]/route.ts"
import { addressHash } from "../src/modules/emails/lib/keys.ts"
import { resolveOptions, type EmailsPluginOptions } from "../src/modules/emails/lib/options.ts"
import { forgetProvider, noteProvider } from "../src/modules/emails/lib/provider-status.ts"
import { HIDDEN_LINK } from "../src/modules/emails/lib/security.ts"
import { forgetSettings } from "../src/modules/emails/lib/settings.ts"
import type { MessageRow, NewMessage } from "../src/modules/emails/lib/store.ts"
import { fakeResponse } from "./kit-conformance.ts"
import { LIVE, logger, memoryStore, type MemoryStore } from "./helpers.ts"

beforeEach(() => {
  forgetSettings()
  forgetProvider()
})

type Row = Record<string, any>

/** The filters of the generated service, as the routes use them. */
function matchWhere(row: Row, where: Row): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === "$and") {
      if (!(v as Row[]).every((w) => matchWhere(row, w))) return false
      continue
    }
    if (k === "$or") {
      if (!(v as Row[]).some((w) => matchWhere(row, w))) return false
      continue
    }
    const value = row[k]
    if (Array.isArray(v)) {
      if (!v.includes(value)) return false
    } else if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("$gte" in v && !(new Date(value).getTime() >= new Date(v.$gte).getTime())) return false
      if ("$ilike" in v) {
        const needle = String(v.$ilike).replace(/^%|%$/g, "").replace(/\\(.)/g, "$1").toLowerCase()
        if (!String(value ?? "").toLowerCase().includes(needle)) return false
      }
    } else if (value !== v) return false
  }
  return true
}

interface Ctx {
  scope: { resolve(key: string, o?: { allowUnregistered?: boolean }): any }
  store: MemoryStore
  log: ReturnType<typeof logger>
  failList?: Error
}

function setup(options: EmailsPluginOptions = LIVE): Ctx {
  const resolved = resolveOptions(options)
  const store = memoryStore()
  const log = logger()
  const ctx: Ctx = { scope: null as never, store, log }
  const list = (where: Row, config: Row = {}) => {
    if (ctx.failList) throw ctx.failList
    const rows = store.rows.filter((r) => matchWhere(r as unknown as Row, where)).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    return rows.slice(config.skip ?? 0, (config.skip ?? 0) + (config.take ?? rows.length))
  }
  const svc = {
    getOptions: () => resolved,
    isDemo: () => resolved.demo,
    getLogger: () => log,
    mask: (t: string) => t.replace(/postgres:\/\/\S+/g, "postgres://***"),
    listEmailsMessages: async (where: Row, config: Row) => list(where, config),
    listAndCountEmailsMessages: async (where: Row, config: Row) => [list(where, config), list(where, {}).length],
  }
  const now = Date.now()
  const data: Record<string, Row[]> = {
    order: [
      { id: "order_1", display_id: 1001, email: "anna@example.com", customer_id: "cus_1", currency_code: "pln", created_at: new Date(now - 3600_000).toISOString(), metadata: {}, items: [{ id: "li_1", title: "Lamp", quantity: 1, unit_price: 10 }] },
    ],
    customer: [{ id: "cus_1", email: "anna@example.com", first_name: "Anna", has_account: true, created_at: new Date(now - 7200_000).toISOString(), metadata: {} }],
    fulfillment: [],
  }
  const query = {
    graph: async (args: Row) => {
      const rows = (data[args.entity] ?? []).filter((r) => Object.entries(args.filters ?? {}).every(([k, v]) => (v && typeof v === "object" ? true : r[k] === v)))
      return { data: args.pagination?.take ? rows.slice(0, args.pagination.take) : rows }
    },
  }
  const registry: Record<string, unknown> = { emails: svc, query, emailsMessageStore: store }
  ctx.scope = {
    resolve(key: string, o?: { allowUnregistered?: boolean }) {
      if (key in registry) return registry[key]
      if (o?.allowUnregistered) return undefined
      throw new Error(`not registered: ${key}`)
    },
  }
  return ctx
}

const req = (ctx: Ctx, extra: Row = {}) => ({ scope: ctx.scope, query: {}, params: {}, headers: {}, method: "GET", path: "/admin/emails", auth_context: { actor_id: "user_1" }, ...extra }) as any

function row(extra: Partial<NewMessage> & { status: MessageRow["status"]; body_html?: string | null; body_text?: string | null; error_code?: string | null }): Parameters<MemoryStore["record"]>[0] {
  return {
    key: `emails:k:${Math.random()}`,
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
    ...extra,
  } as Parameters<MemoryStore["record"]>[0]
}

test("GET /admin/emails only reads: in demo mode it says the outbox is stale; the seed is built by its own POST", async () => {
  const ctx = setup({ ...LIVE, demo: true })
  const first = fakeResponse()
  await statusRoute(req(ctx), first)
  assert.equal(first.statusCode, 200)
  assert.deepEqual(first.body.demo, { seededAt: null, stale: true })
  assert.deepEqual(ctx.store.writes, [], "a GET never writes, not even the demo seed")

  const seeded = fakeResponse()
  await seedRoute(req(ctx, { method: "POST" }), seeded)
  assert.equal(seeded.statusCode, 200)
  assert.ok(seeded.body.written >= 2)
  assert.equal(seeded.body.status.demo.stale, false)
  assert.ok(ctx.store.writes.includes("replaceSeed"))

  const before = ctx.store.writes.length
  const again = fakeResponse()
  await statusRoute(req(ctx), again)
  assert.equal(again.body.demo.stale, false)
  assert.equal(ctx.store.writes.length, before)
  /* A fresh seed stays as it is. */
  const twice = fakeResponse()
  await seedRoute(req(ctx, { method: "POST" }), twice)
  assert.equal(twice.body.written, 0)
})

test("the demo seed only in demo mode, and never while the provider of this process would really send", async () => {
  const live = setup()
  const res = fakeResponse()
  await seedRoute(req(live, { method: "POST" }), res)
  assert.equal(res.statusCode, 409)
  assert.deepEqual(live.store.writes, [])
  const demo = setup({ ...LIVE, demo: true })
  noteProvider({ ...LIVE, channels: ["email"] })
  const mixed = fakeResponse()
  await seedRoute(req(demo, { method: "POST" }), mixed)
  assert.equal(mixed.statusCode, 409)
  assert.equal(mixed.body.code, "provider_not_demo")
  assert.deepEqual(demo.store.writes, [])
})

test("the status names the provider's own mode, the feed and e-mail providers, and asks for db:migrate on an older log", async () => {
  const ctx = setup()
  noteProvider({ ...LIVE, demo: true, channels: ["email"] })
  const res = fakeResponse()
  await statusRoute(req(ctx), res)
  assert.equal(res.body.mode, "live")
  assert.equal(res.body.provider.mode, "demo", "the page can say that the two differ")
  assert.equal(res.body.provider.feedProviders, null, "unknown without Medusa's table")
  assert.equal(res.body.demo, null)
  assert.equal(res.body.logReady, true)
  assert.equal(res.body.limits.passwordResetsPerHour, 3)
  ctx.store.schemaReady = async () => false
  const old = fakeResponse()
  await statusRoute(req(ctx), old)
  assert.equal(old.body.logReady, false)
})

test("an unexpected error answers a plain sentence; the details go to the server log only", async () => {
  const ctx = setup()
  ctx.failList = new Error('select "id" from "emails_message" where ... ; connection to postgres://user:pw@db.example.com failed')
  const res = fakeResponse()
  await messagesRoute(req(ctx, { query: { filter: "attention" } }), res)
  assert.equal(res.statusCode, 503)
  assert.doesNotMatch(JSON.stringify(res.body), /select|postgres|emails_message/)
  assert.ok(ctx.log.lines.some((l) => l.startsWith("error") && l.includes("select") && !l.includes("user:pw")))
})

test("the messages of a customer: by the customer id and by the hash of the customer's address (guest orders); a full address finds its messages", async () => {
  const ctx = setup()
  await ctx.store.record(row({ status: "sent", template: "customer.welcome", customer_id: "cus_1", recipient_hash: addressHash("anna@example.com") }))
  await ctx.store.record(row({ status: "sent", order_id: "order_guest", customer_id: null, recipient_hash: addressHash("anna@example.com") }))
  await ctx.store.record(row({ status: "failed", order_id: "order_other", customer_id: "cus_2", recipient_hash: addressHash("piotr@example.com"), error_code: "INVALID_RECIPIENT" }))
  const mine = fakeResponse()
  await messagesRoute(req(ctx, { query: { customer_id: "cus_1" } }), mine)
  assert.equal(mine.statusCode, 200)
  assert.equal(mine.body.count, 2)
  assert.ok(mine.body.messages.every((m: Row) => m.customerId === "cus_1" || m.orderId === "order_guest"))
  assert.ok(mine.body.messages.every((m: Row) => !("recipientHash" in m) && !("recipient_hash" in m)), "the hash never leaves the server")
  const byAddress = fakeResponse()
  await messagesRoute(req(ctx, { query: { q: "Piotr@Example.com" } }), byAddress)
  assert.equal(byAddress.body.count, 1)
  const bounced = fakeResponse()
  await messagesRoute(req(ctx, { query: { filter: "bounced", since: "7d" } }), bounced)
  assert.equal(bounced.body.count, 1)
  assert.equal(bounced.body.messages[0].orderId, "order_other")
  assert.equal(bounced.body.messages[0].label?.en, "Order confirmation", "a row carries the template's name")
  const wrong = fakeResponse()
  await messagesRoute(req(ctx, { query: { customer_id: "'; drop" } }), wrong)
  assert.equal(wrong.statusCode, 400)
})

test("a stored password reset never shows its link: hidden by this version, not shown at all from an older one; tokens leave no body", async () => {
  const ctx = setup({ ...LIVE, demo: true })
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJlbnRpdHlfaWQiOiJhbm5hIn0.c2lnbmF0dXJlMTIzNDU2"
  const old = await ctx.store.record(row({ demo: true, status: "sent", template: "password.reset", body_html: `<a href="https://shop.example.com/reset-password?token=${jwt}">Reset</a>`, body_text: `https://shop.example.com/reset-password?token=${jwt}` }))
  const kept = await ctx.store.record(row({ demo: true, status: "sent", template: "password.reset", body_html: `<a href="${HIDDEN_LINK}">Reset</a>`, body_text: HIDDEN_LINK }))
  const other = await ctx.store.record(row({ demo: true, status: "sent", template: "order.placed", body_html: `<p>${jwt}</p>`, body_text: "x" }))
  const read = async (id: string) => {
    const res = fakeResponse()
    await messageRoute(req(ctx, { params: { id } }), res)
    return res
  }
  const a = await read(old!.id)
  assert.equal(a.statusCode, 200)
  assert.equal(a.body.html, null)
  assert.equal(a.body.text, null)
  const b = await read(kept!.id)
  assert.match(String(b.body.html), /link\.hidden\.invalid/)
  const c = await read(other!.id)
  assert.ok(!String(c.body.html).includes("eyJ"))
  assert.equal(c.headers["cache-control"], "private, no-store")
  assert.equal((await read("emmsg_nope")).statusCode, 404)
})

type Guard = (req: unknown, res: unknown, next: () => void) => void
const routes = (middlewares as unknown as { routes: Array<{ matcher: string; middlewares: Guard[] }> }).routes

test("the write guard stands in front of every admin route of the plugin", () => {
  const route = routes.find((r) => r.matcher === "/admin/emails*")
  assert.ok(route)
  const guard = route.middlewares[0]
  const form = fakeResponse()
  let passed = false
  guard({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } }, form, () => (passed = true))
  assert.equal(form.statusCode, 415)
  assert.equal(passed, false)
  guard({ method: "POST", headers: { "content-type": "application/json" } }, fakeResponse(), () => (passed = true))
  assert.equal(passed, true)
})

test("a shopper may not set the keys that stop the e-mails of an order; the language stays theirs", () => {
  const ctx = setup()
  for (const matcher of ["/store/carts*", "/store/customers/me*", "/store/customers"]) {
    const route = routes.find((r) => r.matcher === matcher)
    assert.ok(route, matcher)
    const blocked = fakeResponse()
    let passed = false
    route.middlewares[0]({ method: "POST", scope: ctx.scope, headers: {}, body: { metadata: { marketplace_order_ref: "allegro:1" } } }, blocked, () => (passed = true))
    assert.equal(blocked.statusCode, 400, matcher)
    assert.equal(blocked.body.code, "reserved_metadata_key")
    assert.equal(passed, false)
    route.middlewares[0]({ method: "POST", scope: ctx.scope, headers: {}, body: { metadata: { locale: "pl" } } }, fakeResponse(), () => (passed = true))
    assert.equal(passed, true)
  }
})
