import { model } from "@medusajs/framework/utils"

/**
 * A CORRECTION PLAN: what an issued document should be corrected by, for a
 * person to approve. Computed by `lib/corrections.ts` from the order's state
 * (returns, refunds, edits, a cancellation) against the document and the
 * corrections already decided.
 *
 *   draft     computed, waits for a person; recomputed in place while it
 *             waits (`revision` grows when the content changes, and an
 *             approval names the revision the person saw)
 *   manual    the plugin does not issue it (a receipt, a claim or an
 *             exchange, unknown positions); a person handles it and marks it
 *             done
 *   approved  a person approved it: a correction document row is queued
 *             (`correction_document_id`) and the corrections writer issues
 *             it, exactly once
 *   issued    the correction exists in Fakturownia
 *   dismissed a person decided Fakturownia needs no correction from the plugin
 *   done      a manual plan a person handled
 *   obsolete  the order went back to what the document says before anyone
 *             decided
 *
 * One open plan (draft or manual) per document: a partial unique index. A
 * decided plan (approved, issued, dismissed, done) counts as applied when the
 * next plan is computed, so nothing is planned twice. No buyer data: product
 * names, quantities, amounts, rates, the sources' ids.
 */
const FakturowniaCorrection = model
  .define("fakturownia_correction", {
    id: model.id({ prefix: "fkcor" }).primaryKey(),
    order_id: model.text(),
    display_id: model.number().nullable(),
    document_id: model.text(),
    document_kind: model.text(),
    document_number: model.text().nullable(),
    demo: model.boolean().default(false),
    status: model.text().default("draft"),
    manual_reason: model.text().nullable(),
    revision: model.number().default(1),
    sources: model.json().nullable(),
    source_key: model.text().nullable(),
    reasons: model.json().nullable(),
    reason: model.text().nullable(),
    positions: model.json().nullable(),
    notes: model.json().nullable(),
    currency: model.text().nullable(),
    delta_net: model.float().nullable(),
    delta_vat: model.float().nullable(),
    delta_gross: model.float().nullable(),
    simulated: model.boolean().default(false),
    correction_document_id: model.text().nullable(),
    approved_by: model.text().nullable(),
    approved_at: model.dateTime().nullable(),
    closed_by: model.text().nullable(),
    closed_at: model.dateTime().nullable(),
    close_note: model.text().nullable(),
    computed_at: model.dateTime().nullable(),
  })
  .indexes([
    { on: ["document_id"], unique: true, where: "status IN ('draft', 'manual') AND deleted_at IS NULL" },
    { on: ["order_id"], where: "deleted_at IS NULL" },
    { on: ["demo", "status"], where: "deleted_at IS NULL" },
  ])

export default FakturowniaCorrection
