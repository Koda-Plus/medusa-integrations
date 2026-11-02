import { model } from "@medusajs/framework/utils"

/**
 * A DOCUMENT DPD GAVE THE PLUGIN: a label, a return label or a handover
 * protocol, as the base64 bytes DPD sent.
 *
 *   type   label | return_label | protocol
 *   format PDF (the only one v1 asks for)
 *   page   A4 | LBL_PRINTER
 *
 * Labels are kept because generateSpedLabels advises the parcels on every
 * call and DPD does not document a reprint: the plugin asks once (a POST
 * with a claim) and serves the stored bytes on every GET. A label or a
 * return label belongs to a shipment (`shipment_id`), a protocol to a
 * handover (`dispatch_id`). Rows older than `documentRetentionDays` are
 * deleted by the status pass.
 */
const DpdDocument = model
  .define("dpd_document", {
    id: model.id({ prefix: "dpddoc" }).primaryKey(),
    shipment_id: model.text().nullable(),
    dispatch_id: model.text().nullable(),
    type: model.text(),
    format: model.text().default("PDF"),
    page: model.text().nullable(),
    document_id: model.text().nullable(),
    data: model.text(),
    mode: model.text(),
    created_by: model.text().nullable(),
  })
  .indexes([
    { on: ["shipment_id", "type"], where: "deleted_at IS NULL" },
    { on: ["dispatch_id"], where: "deleted_at IS NULL" },
    { on: ["mode", "created_at"], where: "deleted_at IS NULL" },
  ])

export default DpdDocument
