import { model } from "@medusajs/framework/utils"

/**
 * THE OUTBOX. Every call Medusa owes the bridge is a row here first, then a
 * request: an order placed while the bridge machine is off still becomes a
 * ZK when it is back, in order, without anyone resending it by hand.
 *
 * Kinds: `order.create` (ZK), `order.cancel`, `order.fulfill` (WZ from a
 * Medusa fulfillment, `reference` = fulfillment id).
 *
 * Statuses: `waiting` (prepaid order, payment not captured yet), `pending`
 * (due at `next_attempt_at`), `running`, `succeeded`, `failed` (needs a
 * person: a non-retryable error or attempts exhausted), `canceled`.
 *
 * One row per (kind, order, reference): a unique index in the migration
 * makes two subscribers racing for the same order meet on the same row.
 */
const SubiektTask = model.define("subiekt_task", {
  id: model.id({ prefix: "sbtask" }).primaryKey(),
  kind: model.text(),
  order_id: model.text(),
  display_id: model.number().nullable(),
  reference: model.text().nullable(),
  status: model.text(),
  trigger: model.text(),
  attempts: model.number().default(0),
  next_attempt_at: model.dateTime().nullable(),
  started_at: model.dateTime().nullable(),
  succeeded_at: model.dateTime().nullable(),
  last_error: model.text().nullable(),
  last_error_code: model.text().nullable(),
  result: model.json().nullable(),
})

export default SubiektTask
