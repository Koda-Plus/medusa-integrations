/**
 * The provider's delivery path, end to end without a database or a network:
 * dev mode without an API key, the simulated outbox of demo mode, a live
 * send with its exact request, idempotency on three levels, the switches,
 * finished content, failures and a person's retry.
 */
import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { resolveOptions } from "../src/modules/emails/lib/options.ts"
import { createResendClient, resetPace } from "../src/modules/emails/lib/resend.ts"
import { deliver, DeliveryError, type IncomingNotification } from "../src/modules/emails/lib/send.ts"
import { EMPTY_SETTINGS, readSettings, templateKey, type EffectiveSettings } from "../src/modules/emails/lib/settings.ts"
import { sampleOrder } from "../src/modules/emails/lib/templates/samples.ts"
import { API_KEY, FakeResend, LIVE, live, logger, memoryStore, type MemoryStore } from "./helpers.ts"

beforeEach(() => resetPace())

function deps(options = live(), store: MemoryStore | null = memoryStore(), fake = new FakeResend(), settings: EffectiveSettings = EMPTY_SETTINGS) {
  const log = logger()
  const client = createResendClient({ apiKey: options.apiKey, timeoutMs: 2000, maxRetries: 2, requestsPerSecond: 1000, fetch: fake.fetch, sleep: async () => {}, random: () => 0.5 })
  return { d: { options, store, loadSettings: async () => settings, client: () => client, logger: log }, store, fake, log }
}

const order = (extra: Partial<IncomingNotification> = {}): IncomingNotification => ({
  id: "noti_1",
  to: "anna.nowak@example.com",
  channel: "email",
  template: "order.placed",
  data: sampleOrder("pl") as unknown as Record<string, unknown>,
  idempotency_key: "emails:order.placed:order_1",
  trigger_type: "order.placed",
  resource_type: "order",
  resource_id: "order_1",
  ...extra,
})

test("live: one request with the key as Idempotency-Key, the text part, Reply-To and tags; the row says sent", async () => {
  const { d, store, fake } = deps()
  const r = await deliver(d, order())
  assert.equal(r.outcome, "sent")
  assert.equal(r.id, "re_msg_1")
  assert.equal(fake.calls.length, 1)
  const call = fake.calls[0]
  assert.equal(call.url, "https://api.resend.com/emails")
  assert.equal(call.headers.authorization, `Bearer ${API_KEY}`)
  assert.equal(call.headers["idempotency-key"], "emails:order.placed:order_1")
  assert.equal(call.body.from, "Koda Supply <orders@mail.example.com>")
  assert.deepEqual(call.body.to, ["anna.nowak@example.com"])
  assert.deepEqual(call.body.reply_to, ["support@example.com"])
  assert.equal(call.body.subject, "Mamy Twoje zamówienie nr 1042")
  assert.match(call.body.html, /<html lang="pl"/)
  assert.match(call.body.text, /Razem: 802,49/)
  assert.deepEqual(call.body.tags, [
    { name: "template", value: "order_placed" },
    { name: "source", value: "medusa" },
  ])
  assert.match(call.body.headers["X-Entity-Ref-ID"], /^[0-9a-f]{24}$/)
  const row = store!.rows[0]
  assert.equal(row.status, "sent")
  assert.equal(row.external_id, "re_msg_1")
  assert.equal(row.recipient, "a***@e***.com")
  assert.equal(row.order_id, "order_1")
  assert.equal(row.locale, "pl")
  assert.equal(row.body_html, null, "live rows never keep the body")
})

test("one event never sends twice: the same key answers with the first e-mail id", async () => {
  const { d, store, fake } = deps()
  const first = await deliver(d, order())
  const second = await deliver(d, order({ id: "noti_2" }))
  assert.equal(fake.calls.length, 1)
  assert.equal(second.outcome, "duplicate")
  assert.equal(second.id, first.id)
  assert.equal(store!.rows.length, 1)
})

test("provider_data.emails.key wins over the notification key; without any key each notification gets its own", async () => {
  const { d, store } = deps()
  await deliver(d, order({ idempotency_key: "emails:order.placed:order_1:retry:1:x", provider_data: { emails: { key: "emails:order.placed:order_1" } } }))
  assert.equal(store!.rows[0].key, "emails:order.placed:order_1")
  await deliver(d, order({ id: "noti_9", idempotency_key: null, template: "order.placed" }))
  assert.equal(store!.rows[1].key, "emails:notification:noti_9")
  assert.equal(store!.rows[1].kind, "app")
})

test("dev mode (no API key): nothing is sent, the row says why, the log masks the address", async () => {
  const fake = new FakeResend()
  const { d, store, log } = deps(resolveOptions({ ...LIVE, apiKey: "" }), memoryStore(), fake)
  const r = await deliver(d, order())
  assert.equal(r.outcome, "logged")
  assert.equal(fake.calls.length, 0)
  assert.equal(store!.rows[0].status, "skipped")
  assert.equal(store!.rows[0].error_code, "NO_API_KEY")
  assert.ok(log.lines.some((l) => l.includes("dev mode") && l.includes("a***@e***.com")))
  assert.ok(log.lines.every((l) => !l.includes("anna.nowak@example.com")))
})

test("demo mode: the simulated outbox keeps the rendered message, nothing leaves the server", async () => {
  const fake = new FakeResend()
  const { d, store } = deps(resolveOptions({ ...LIVE, demo: true }), memoryStore(), fake)
  const r = await deliver(d, order())
  assert.equal(r.outcome, "simulated")
  assert.match(String(r.id), /^demo_/)
  assert.equal(fake.calls.length, 0)
  const row = store!.rows[0]
  assert.equal(row.demo, true)
  assert.equal(row.status, "sent")
  assert.match(String(row.body_html), /Mamy Twoje zamówienie/)
  assert.match(String(row.body_text), /Razem/)
})

test("a template turned off in the admin is skipped and recorded; a test send still goes out", async () => {
  const settings = readSettings([{ key: templateKey(false, "order.placed"), value: { on: false }, updated_by: "user_1", updated_at: new Date() }], false)
  const { d, store, fake } = deps(live(), memoryStore(), new FakeResend(), settings)
  const r = await deliver(d, order())
  assert.equal(r.outcome, "skipped")
  assert.equal(fake.calls.length, 0)
  assert.equal(store!.rows[0].error_code, "TEMPLATE_OFF")
  const t = await deliver(d, order({ idempotency_key: "emails:test:1", provider_data: { emails: { key: "emails:test:1", kind: "test" } } }))
  assert.equal(t.outcome, "sent")
  assert.match(fake.calls[0].body.subject, /^\[Test\] /)
})

test("a template turned off in the options cannot be turned on by the admin", async () => {
  const settings = readSettings([{ key: templateKey(false, "order.placed"), value: { on: true }, updated_at: new Date() }], false)
  const { d, fake } = deps(live({ templates: { "order.placed": false } }), memoryStore(), new FakeResend(), settings)
  const r = await deliver(d, order())
  assert.equal(r.outcome, "skipped")
  assert.equal(fake.calls.length, 0)
})

test("finished content without a template is sent as it is, with a text part made from the HTML", async () => {
  const { d, fake } = deps()
  await deliver(d, order({ template: "my-own", content: { subject: "Hello", html: "<p>Hi <a href=\"https://x.example.com\">there</a></p>" }, data: {} }))
  assert.equal(fake.calls[0].body.subject, "Hello")
  assert.equal(fake.calls[0].body.text, "Hi there (https://x.example.com)")
})

test("an unknown template without content fails, recorded and thrown", async () => {
  const { d, store, fake } = deps()
  await assert.rejects(() => deliver(d, order({ template: "nope.nothing", content: null })), (e: unknown) => e instanceof DeliveryError && e.code === "UNKNOWN_TEMPLATE")
  assert.equal(fake.calls.length, 0)
  assert.equal(store!.rows[0].status, "failed")
})

test("a recipient that is not an address is refused before anything is rendered", async () => {
  const { d, fake } = deps()
  await assert.rejects(() => deliver(d, order({ to: "not-an-address" })), (e: unknown) => e instanceof DeliveryError && e.code === "INVALID_RECIPIENT")
  assert.equal(fake.calls.length, 0)
})

test("live without a valid From: refused with MISSING_FROM", async () => {
  const { d, fake } = deps(resolveOptions({ ...LIVE, from: "" }))
  await assert.rejects(() => deliver(d, order()), (e: unknown) => e instanceof DeliveryError && e.code === "MISSING_FROM")
  assert.equal(fake.calls.length, 0)
})

test("a refusal by Resend is final: the row is failed with the message masked, nothing is retried", async () => {
  const fake = new FakeResend().answer({ status: 403, body: { statusCode: 403, name: "validation_error", message: `The example.com domain is not verified. Key ${API_KEY}, to anna.nowak@example.com` } })
  const { d, store, log } = deps(live(), memoryStore(), fake)
  await assert.rejects(() => deliver(d, order()), (e: unknown) => e instanceof DeliveryError && e.code === "validation_error")
  assert.equal(fake.calls.length, 1)
  const row = store!.rows[0]
  assert.equal(row.status, "failed")
  assert.equal(row.retryable, false)
  assert.ok(!String(row.error).includes(API_KEY) && !String(row.error).includes("anna.nowak@example.com"))
  assert.ok(log.lines.every((l) => !l.includes(API_KEY)))
  /* The same event again: not sent again by itself */
  await assert.rejects(() => deliver(d, order({ id: "noti_2" })), (e: unknown) => e instanceof DeliveryError && e.code === "NOT_RETRIED")
  assert.equal(fake.calls.length, 1)
})

test("a timeout after every try leaves the row unknown (it may have gone out), with the same key on every try", async () => {
  const fake = new FakeResend().answer("timeout", "timeout", "timeout")
  const { d, store } = deps(live(), memoryStore(), fake)
  await assert.rejects(() => deliver(d, order()))
  assert.equal(fake.calls.length, 3)
  assert.ok(fake.calls.every((c) => c.headers["idempotency-key"] === "emails:order.placed:order_1"))
  assert.equal(store!.rows[0].status, "unknown")
  assert.equal(store!.rows[0].retryable, true)
})

test("a person's retry takes the failed row over with a rotated Resend key, and then it is sent", async () => {
  const fake = new FakeResend().answer({ status: 422, body: { name: "validation_error", message: "Invalid `to` field." } })
  const { d, store } = deps(live(), memoryStore(), fake)
  await assert.rejects(() => deliver(d, order()))
  const retry = await deliver(d, order({ id: "noti_3", idempotency_key: "emails:order.placed:order_1:retry:1:abc", provider_data: { emails: { key: "emails:order.placed:order_1", retry: true, requestedBy: "user_7" } } }))
  assert.equal(retry.outcome, "sent")
  assert.equal(fake.calls.length, 2)
  assert.equal(fake.calls[1].headers["idempotency-key"], "emails:order.placed:order_1#r1")
  const row = store!.rows[0]
  assert.equal(store!.rows.length, 1)
  assert.equal(row.status, "sent")
  assert.equal(row.rotation, 1)
  assert.equal(row.requested_by, "user_7")
})

test("without the send log table the message is still sent, protected by Resend's key", async () => {
  const store = memoryStore()
  store.failWith = Object.assign(new Error('relation "emails_message" does not exist'), { code: "42P01" })
  const { d, fake, log } = deps(live(), store)
  const r = await deliver(d, order())
  assert.equal(r.outcome, "sent")
  assert.equal(fake.calls.length, 1)
  assert.ok(log.lines.some((l) => l.includes("db:migrate")))
})

test("a template that throws is recorded as a render error, nothing is sent", async () => {
  const { d, store, fake } = deps(
    live({
      templates: {
        "broken.one": {
          render: () => {
            throw new Error("boom")
          },
        },
      },
    }),
  )
  await assert.rejects(() => deliver(d, order({ template: "broken.one", idempotency_key: "emails:broken" })), (e: unknown) => e instanceof DeliveryError && e.code === "RENDER_ERROR")
  assert.equal(fake.calls.length, 0)
  assert.equal(store!.rows[0].error_code, "RENDER_ERROR")
})

test("cc, bcc and reply_to from provider_data are passed on when they are valid addresses", async () => {
  const { d, fake } = deps()
  await deliver(d, order({ provider_data: { cc: "boss@example.com, nope", bcc: ["archive@example.com"], reply_to: "sales@example.com" } }))
  assert.deepEqual(fake.calls[0].body.cc, ["boss@example.com"])
  assert.deepEqual(fake.calls[0].body.bcc, ["archive@example.com"])
  assert.deepEqual(fake.calls[0].body.reply_to, ["sales@example.com"])
})
