import { model } from "@medusajs/framework/utils"

/**
 * ONE DPD SHIPMENT ("package" in DPDServices) OF A MEDUSA FULFILLMENT, or
 * one return: what the customer chose, what the plugin did about it and
 * where the boxes ("parcels" in DPDServices, one waybill each) are.
 *
 * A row is recorded when a fulfillment of the DPD provider is created
 * (`state` pending), whether or not anything is sent to DPD. The states:
 *
 *   pending, creating, created, labeling, labeled, failed, unknown,
 *   ambiguous, abandoned_unknown, skipped, canceled
 *
 * (SHIPMENT_STATES in lib/constants.ts). DPD has no idempotency key and no
 * way to cancel a shipment, so every write is the outbox step of this row: it
 * is claimed by one process (`claim_token`, `lease_until`), the request goes
 * out once with a deterministic `reference` (the fulfillment id), and an
 * unclear answer ends in `unknown`, resolved by a lookup before anything is
 * sent again. `references` keeps the history of the references tried.
 *
 * `status` is the last InfoServices event code, `stage` what it means for
 * the shop. `kind` is outbound or return; `order_id` is null only for a
 * moment while a return is tied to its order.
 *
 * THE DATABASE REFUSES A SECOND ROW FOR ONE FULFILLMENT: a unique index on
 * (fulfillment_id, kind, mode). `mode` keeps demo, sandbox and live rows
 * apart, so a store that tried the demo starts clean on its real account.
 *
 * NO RECEIVER DATA AT REST: no name, phone, e-mail or street of the customer
 * is stored. The plan reads them from the order when it is built. Pickup
 * points are public, so their id is kept. Amounts are minor units (grosze).
 */
const DpdShipment = model
  .define("dpd_shipment", {
    id: model.id({ prefix: "dpdshp" }).primaryKey(),
    order_id: model.text().nullable(),
    display_id: model.number().nullable(),
    fulfillment_id: model.text().nullable(),
    return_id: model.text().nullable(),
    kind: model.text().default("outbound"),
    mode: model.text(),
    option_id: model.text(),
    service: model.text().nullable(),
    pudo_id: model.text().nullable(),
    country_code: model.text().nullable(),
    session_type: model.text().nullable(),
    cod_minor: model.number().nullable(),
    currency: model.text().nullable(),
    reference: model.text().nullable(),
    references: model.json().nullable(),
    boxes: model.json().nullable(),
    waybills: model.json().nullable(),
    session_id: model.text().nullable(),
    state: model.text().default("pending"),
    status: model.text().nullable(),
    stage: model.text().nullable(),
    plan_hash: model.text().nullable(),
    problems: model.json().nullable(),
    dispatch_id: model.text().nullable(),
    handed_over_at: model.dateTime().nullable(),
    claim_token: model.text().nullable(),
    lease_until: model.dateTime().nullable(),
    shipped_marked_at: model.dateTime().nullable(),
    delivered_marked_at: model.dateTime().nullable(),
    last_checked_at: model.dateTime().nullable(),
    error: model.text().nullable(),
    error_code: model.text().nullable(),
    attempts: model.number().default(0),
  })
  .indexes([
    { on: ["fulfillment_id", "kind", "mode"], unique: true, where: "fulfillment_id IS NOT NULL AND deleted_at IS NULL" },
    { on: ["order_id", "mode"], where: "deleted_at IS NULL" },
    { on: ["state", "mode"], where: "deleted_at IS NULL" },
    { on: ["return_id"], where: "deleted_at IS NULL" },
    { on: ["dispatch_id"], where: "deleted_at IS NULL" },
    { on: ["mode", "last_checked_at"], where: "deleted_at IS NULL" },
  ])

export default DpdShipment
