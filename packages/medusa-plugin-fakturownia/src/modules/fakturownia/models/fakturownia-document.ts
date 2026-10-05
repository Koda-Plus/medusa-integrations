import { model } from "@medusajs/framework/utils"

/**
 * THE DOCUMENT OUTBOX: one row per order and document kind, and what
 * Fakturownia made of it.
 *
 * STATE LIVES HERE, NOT IN ORDER METADATA. A row is inserted by a subscriber
 * BEFORE anything goes to the network (`pending`), claimed by one process at
 * a time (`issuing`, with a claim token and a lease) and finished as
 * `issued`, `failed` or `unknown`. See `lib/outbox.ts` for every state.
 *
 * THE DATABASE REFUSES DUPLICATES: a unique index on (order_id, kind, demo),
 * so a second VAT invoice (or proforma, or receipt) of one order cannot even
 * be queued, and a partial unique index on (order_id, demo) for the final
 * kinds, so an order never gets both a VAT invoice and a receipt. `demo`
 * keeps simulated documents apart: a store that evaluated the demo and then
 * connects a real account starts clean.
 *
 * WHAT WAS SENT, WITHOUT WHO IT WAS FOR: the kind, the order number (`oid`),
 * the issue date, the currency, the gross total and the positions (product
 * names, SKUs, quantities, amounts, tax rates). No buyer name, address, e-mail
 * or tax ID is stored; `buyer_type` says only "company" or "person".
 *
 * `total_gross` is `numeric(14,2)` in the migration (exact money), declared as
 * a float here; the DTO reads it with `Number()`.
 */
const FakturowniaDocument = model
  .define("fakturownia_document", {
    id: model.id({ prefix: "fkdoc" }).primaryKey(),
    order_id: model.text(),
    display_id: model.number().nullable(),
    kind: model.text(),
    status: model.text().default("pending"),
    demo: model.boolean().default(false),
    fakturownia_id: model.text().nullable(),
    number: model.text().nullable(),
    oid: model.text().nullable(),
    issue_date: model.text().nullable(),
    currency: model.text().nullable(),
    total_gross: model.float().nullable(),
    positions: model.json().nullable(),
    buyer_type: model.text().nullable(),
    from_fakturownia_id: model.text().nullable(),
    paid: model.boolean().default(false),
    paid_at: model.dateTime().nullable(),
    pay_requested_at: model.dateTime().nullable(),
    gov_status: model.text().nullable(),
    gov_id: model.text().nullable(),
    gov_error: model.text().nullable(),
    gov_checked_at: model.dateTime().nullable(),
    error: model.text().nullable(),
    error_code: model.text().nullable(),
    attempts: model.number().default(0),
    next_attempt_at: model.dateTime().nullable(),
    claim_token: model.text().nullable(),
    claimed_at: model.dateTime().nullable(),
    lease_until: model.dateTime().nullable(),
    issued_at: model.dateTime().nullable(),
    cancel_requested_at: model.dateTime().nullable(),
    email_status: model.text().nullable(),
    emailed_at: model.dateTime().nullable(),
    email_error: model.text().nullable(),
  })
  .indexes([
    { on: ["order_id", "kind", "demo"], unique: true, where: "deleted_at IS NULL" },
    { on: ["order_id", "demo"], unique: true, where: "kind IN ('vat', 'receipt') AND deleted_at IS NULL" },
    { on: ["status", "next_attempt_at"], where: "deleted_at IS NULL" },
    { on: ["fakturownia_id"], where: "deleted_at IS NULL" },
    { on: ["issued_at"], where: "deleted_at IS NULL" },
  ])

export default FakturowniaDocument
