import { model } from "@medusajs/framework/utils"

/**
 * THE OUTBOX. Every call Medusa owes the bridge is a row here first, then a
 * request: an order placed while the bridge machine is off still becomes a
 * ZK when it is back, in order, without anyone resending it by hand.
 *
 * Kinds: `order.create` (ZK), `order.cancel`, `order.fulfill` (WZ from a
 * Medusa fulfillment, `reference` = fulfillment id), `order.document` (the FS
 * or PA, since 0.2.0; one per order, its kind frozen in `detail`).
 *
 * Statuses: `waiting` (prepaid order, payment not captured yet), `pending`
 * (due at `next_attempt_at`), `running`, `unknown` (a sales document request
 * got no clear answer: the next attempt asks the bridge first), `succeeded`,
 * `failed` (needs a person: a non-retryable error or attempts exhausted),
 * `canceled`.
 *
 * One row per (kind, order, reference, mode): a unique index in the migration
 * makes two subscribers racing for the same order meet on the same row.
 * `demo` keeps the simulated queue apart, so going live starts with a clean one.
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
  /** Since 0.2.0: input frozen when the task was queued, for example `{ "kind": "fs" }`. */
  detail: model.json().nullable(),
  demo: model.boolean().default(false),
})

export default SubiektTask
