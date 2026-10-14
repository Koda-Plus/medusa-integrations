/**
 * App mode (`appProvider`): the store keeps its own e-mail provider. The
 * options, the row its provider reports with `recordAppEmail`, and the rule
 * that a second report of the same message updates only an app row.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { appEmailRow } from "../src/modules/emails/lib/app-record.ts"
import { missingOptions, resolveOptions } from "../src/modules/emails/lib/options.ts"
import { appProviderServes } from "../src/api/admin/emails/helpers.ts"
import { memoryStore } from "./helpers.ts"

const NOW = new Date("2026-10-14T12:00:00Z")

test("appProvider turns on app mode, needs no key and loses to demo", () => {
  const o = resolveOptions({ appProvider: "resend" })
  assert.equal(o.mode, "app")
  assert.equal(o.appProvider, "resend")
  assert.deepEqual(missingOptions(o), [])
  const demo = resolveOptions({ appProvider: "resend", demo: true })
  assert.equal(demo.mode, "demo")
  assert.equal(demo.appProvider, null)
  const bad = resolveOptions({ appProvider: "not a provider id!" })
  assert.equal(bad.mode, "dev")
  assert.ok(bad.problems.some((p) => p.startsWith("appProvider")))
})

test("the app provider counts with or without the module prefix in Medusa's table", () => {
  assert.equal(appProviderServes(["resend"], "resend"), true)
  assert.equal(appProviderServes(["notification_resend"], "resend"), true)
  assert.equal(appProviderServes(["cloud"], "resend"), false)
  assert.equal(appProviderServes(null, "resend"), null)
})

test("a reported e-mail is masked, hashed, linked to its order and keyed by the notification", () => {
  const row = appEmailRow(
    {
      notification: {
        id: "noti_1",
        to: "anna.nowak@example.com, biuro@example.com",
        template: "order-confirmation",
        data: { locale: "pl-PL", order: { id: "order_01ABC" } },
        idempotency_key: "order-confirmation:order_01ABC",
        receiver_id: "cus_01XYZ",
      },
      status: "sent",
      subject: "Potwierdzenie zamówienia #812",
      externalId: "re_msg_1",
    },
    NOW,
  )
  assert.equal(row.key, "order-confirmation:order_01ABC")
  assert.equal(row.kind, "app")
  assert.equal(row.status, "sent")
  assert.equal(row.recipient, "a***@e***.com, b***@e***.com")
  assert.ok(row.recipient_hash && row.recipient_hash.length === 40)
  assert.equal(row.order_id, "order_01ABC")
  assert.equal(row.customer_id, "cus_01XYZ")
  assert.equal(row.locale, "pl")
  assert.equal(row.external_id, "re_msg_1")
  assert.equal(row.sent_at, NOW)
  assert.equal(row.error, null)
  assert.ok(!JSON.stringify(row).includes("anna.nowak"))
})

test("a failed report keeps a masked error, and a test from the admin stays a test under its own key", () => {
  const failed = appEmailRow({ notification: { to: "jan@example.com", template: "welcome" }, status: "failed", error: "550 jan@example.com rejected, key re_123456789abc" }, NOW)
  assert.equal(failed.status, "failed")
  assert.equal(failed.error_code, "PROVIDER_ERROR")
  assert.ok(!String(failed.error).includes("jan@example.com"))
  assert.equal(failed.sent_at, null)
  assert.ok(failed.key.startsWith("emails:adhoc:"))

  const test = appEmailRow(
    { notification: { to: "me@example.com", template: "welcome", provider_data: { emails: { key: "emails:test:abc", kind: "test", requestedBy: "user_1" } } }, status: "sent" },
    NOW,
  )
  assert.equal(test.kind, "test")
  assert.equal(test.key, "emails:test:abc")
  assert.equal(test.requested_by, "user_1")
  assert.equal(test.trigger, "test")
})

test("a second report of the same message updates an app row and never touches a row of the plugin's own flows", async () => {
  const store = memoryStore()
  const first = appEmailRow({ notification: { id: "noti_2", to: "a@example.com", template: "welcome", idempotency_key: "welcome:cus_1" }, status: "failed", error: "timeout" }, NOW)
  await store.recordApp(first)
  const again = appEmailRow({ notification: { id: "noti_2", to: "a@example.com", template: "welcome", idempotency_key: "welcome:cus_1" }, status: "sent", externalId: "re_2" }, NOW)
  const updated = await store.recordApp(again)
  assert.equal(updated?.status, "sent")
  assert.equal(updated?.external_id, "re_2")
  assert.equal(updated?.attempts, 2)

  await store.record({ ...appEmailRow({ notification: { to: "b@example.com", template: "order.placed", idempotency_key: "emails:order.placed:order_9" }, status: "sent" }, NOW), kind: "event" })
  const clash = await store.recordApp(appEmailRow({ notification: { to: "b@example.com", template: "order.placed", idempotency_key: "emails:order.placed:order_9" }, status: "failed" }, NOW))
  assert.equal(clash, null)
})
