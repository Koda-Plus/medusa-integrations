import { model } from "@medusajs/framework/utils"

/**
 * Documents Subiekt issued for Medusa orders: the ZK the plugin asked for, the
 * WZ the warehouse issued and, since 0.2.0, the FS or PA with its KSeF number. Unique by (kind, number, demo, order), so the
 * same document arriving twice (the create answer and the event feed, or a
 * replayed event) stays one row, while a number Subiekt reuses for another
 * order (a different company database after a switch from a test copy) is
 * never silently swallowed.
 *
 * `applied_at` marks that the side effects ran (order metadata, the
 * `subiekt.document_issued` event, an optional fulfillment), so a replay
 * never repeats them. `demo` keeps simulated documents apart from real ones.
 */
const SubiektDocument = model.define("subiekt_document", {
  id: model.id({ prefix: "sbdoc" }).primaryKey(),
  order_id: model.text().nullable(),
  display_id: model.number().nullable(),
  kind: model.text(),
  number: model.text(),
  subiekt_id: model.text().nullable(),
  status: model.text().default("open"),
  issued_at: model.dateTime().nullable(),
  source: model.text(),
  warehouse: model.text().nullable(),
  related: model.json().nullable(),
  event_id: model.text().nullable(),
  applied_at: model.dateTime().nullable(),
  /** Since 0.2.0: the number KSeF assigned to the e-invoice of an FS. */
  ksef_number: model.text().nullable(),
  demo: model.boolean().default(false),
})

export default SubiektDocument
