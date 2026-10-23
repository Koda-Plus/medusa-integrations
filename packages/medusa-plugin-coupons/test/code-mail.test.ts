/**
 * E-mails of a code (who gets it, never twice, new people onto the customer
 * rule), deleting only an unused coupon, the plain counter of uses and the
 * creator's warning for a limit of 1 shared by several customers.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { cleanIds, cleanMessage, codeSentOf, deleteBlockers, looksDeletable, planSend, sendBlockers, usageOf, withSent, MESSAGE_MAX } from "../src/modules/coupons/lib/code-mail.ts"
import { toCouponDto } from "../src/modules/coupons/lib/describe.ts"
import { wizardWarnings } from "../src/modules/coupons/lib/wizard.ts"
import type { WizardInput } from "../src/modules/coupons/lib/contract.ts"

const entry = (customer_id: string, at = "2026-10-20T10:00:00.000Z") => ({ customer_id, email: `${customer_id}@example.com`, at, by: "admin@example.com" })

test("code_sent is read from metadata, broken rows left out", () => {
  assert.deepEqual(codeSentOf(null), [])
  assert.deepEqual(codeSentOf({ code_sent: "x" }), [])
  const rows = codeSentOf({ code_sent: [entry("cus_a"), { email: "no-id@example.com" }, null, { customer_id: "cus_b" }] })
  assert.deepEqual(
    rows.map((r) => r.customer_id),
    ["cus_a", "cus_b"],
  )
  assert.equal(rows[1].by, null)
})

test("a promotion's metadata shows on the coupon", () => {
  const c = toCouponDto({ id: "promo_1", code: "CB-JESIEN", metadata: { code_sent: [entry("cus_a")], created_by: "nina" } }, undefined)
  assert.equal(c.codeSent?.length, 1)
  assert.equal(c.codeSent?.[0].customer_id, "cus_a")
})

test("new sends are appended once per person, other metadata kept", () => {
  const m = withSent({ created_by: "nina", code_sent: [entry("cus_a")] }, [entry("cus_a", "2026-10-21T00:00:00.000Z"), entry("cus_b")])
  assert.equal(m.created_by, "nina")
  const rows = codeSentOf(m)
  assert.deepEqual(
    rows.map((r) => r.customer_id),
    ["cus_a", "cus_b"],
  )
  assert.equal(rows[0].at, "2026-10-20T10:00:00.000Z")
})

test("only people who did not get it are sent to; new ones join the customer rule", () => {
  const p = planSend({ requested: ["cus_a", "cus_b", "cus_c", "cus_b"], sent: [entry("cus_a")], ruleIds: ["cus_a", "cus_b"], nobody: null })
  assert.deepEqual(p.toSend, ["cus_b", "cus_c"])
  assert.deepEqual(p.skipped, ["cus_a"])
  assert.deepEqual(p.addToRule, ["cus_c"])
  assert.deepEqual(p.ruleAfter, ["cus_a", "cus_b", "cus_c"])
})

test("the store's nobody marker is dropped when people join the rule", () => {
  const p = planSend({ requested: ["cus_x"], sent: [], ruleIds: ["brak-klienta"], nobody: "brak-klienta" })
  assert.deepEqual(p.addToRule, ["cus_x"])
  assert.deepEqual(p.ruleAfter, ["cus_x"])
})

test("a coupon for everyone or for groups is never narrowed to the people it goes to", () => {
  const p = planSend({ requested: ["cus_x"], sent: [], ruleIds: [], nobody: null })
  assert.deepEqual(p.toSend, ["cus_x"])
  assert.deepEqual(p.addToRule, [])
  assert.equal(p.ruleAfter, null)
})

test("everybody already has it: nothing to send", () => {
  const p = planSend({ requested: ["cus_a"], sent: [entry("cus_a")], ruleIds: ["cus_a"], nobody: null })
  assert.deepEqual(p.toSend, [])
  assert.deepEqual(p.skipped, ["cus_a"])
})

test("the instruction and the ids are checked", () => {
  assert.equal(cleanMessage("   ").error, "message")
  assert.equal(cleanMessage("x".repeat(MESSAGE_MAX + 1)).error, "message_long")
  assert.equal(cleanMessage(" 10% off \r\n").value, "10% off")
  assert.deepEqual(cleanIds(["cus_a", "cus_a", "bad id", 4, "cus_b"]), ["cus_a", "cus_b"])
})

test("the code goes out only for a working coupon with a code and a sender", () => {
  assert.deepEqual(sendBlockers({ automatic: false, code: "CB-X", status: "active" }, true), [])
  assert.deepEqual(sendBlockers({ automatic: false, code: "CB-X", status: "scheduled" }, true), [])
  assert.deepEqual(sendBlockers({ automatic: true, code: "AUTO", status: "active" }, true), ["automatic"])
  assert.deepEqual(sendBlockers({ automatic: false, code: "CB-X", status: "paused" }, false), ["no_sender", "paused"])
  assert.deepEqual(sendBlockers({ automatic: false, code: "CB-X", status: "used_up" }, true), ["ended"])
})

test("only a coupon nobody used can be deleted", () => {
  assert.deepEqual(deleteBlockers({ used: 0, orders: 0 }), [])
  assert.deepEqual(deleteBlockers({ used: 1, orders: 0 }), ["used"])
  /* A canceled order counts: the history keeps its promotion. */
  assert.deepEqual(deleteBlockers({ used: 0, orders: 1 }), ["used"])
  const base = toCouponDto({ id: "promo_1", code: "CB-COPY", used: 0 }, undefined)
  assert.equal(looksDeletable(base), true)
  assert.equal(looksDeletable({ ...base, stats: { ...base.stats, orders: 1 } }), false)
})

test("the counter in parts: uses, the limit in total, per customer, customers", () => {
  const c = toCouponDto({ id: "promo_1", code: "CB-X", limit: 1, used: 0, rules: [{ attribute: "customer.id", operator: "in", values: [{ value: "cus_a" }, { value: "cus_b" }, { value: "brak-klienta" }] }] }, undefined)
  assert.deepEqual(usageOf(c, "brak-klienta"), { used: 0, limit: 1, perCustomer: null, customers: 2 })
  assert.deepEqual(usageOf({ ...c, limit: null, terms: { perCustomerOrders: 1 } }, null), { used: 0, limit: null, perCustomer: 1, customers: 3 })
})

const wizard = (over: Partial<WizardInput> = {}): WizardInput => ({
  kind: "percent_order",
  value: 10,
  audience: "customer",
  customerIds: ["cus_a", "cus_b"],
  mode: "code",
  code: "CB-SALONY",
  validity: "30d",
  limit: 1,
  ...over,
})

test("limit 1 with several customers: the creator warns that it works once in total", () => {
  assert.ok(wizardWarnings(wizard(), { active: [], memberGroupIds: [], features: ["perCustomerOrders"] }).includes("once_many_customers"))
  assert.ok(wizardWarnings(wizard(), { active: [], memberGroupIds: [] }).includes("once_many_customers_total"))
  const quiet = (w: WizardInput) => wizardWarnings(w, { active: [], memberGroupIds: [], features: ["perCustomerOrders"] }).filter((x) => x.startsWith("once_many"))
  assert.deepEqual(quiet(wizard({ customerIds: ["cus_a"] })), [])
  assert.deepEqual(quiet(wizard({ limit: null, terms: { perCustomerOrders: 1 } })), [])
  assert.deepEqual(quiet(wizard({ audience: "everyone" })), [])
})
