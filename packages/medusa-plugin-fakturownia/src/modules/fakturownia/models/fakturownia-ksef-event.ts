import { model } from "@medusajs/framework/utils"

/**
 * THE KSeF HISTORY OF A DOCUMENT: every change of `gov_status` the plugin saw
 * (after issue, in the status job), every "send to KSeF again" a person asked
 * for, with the KSeF number and the error messages Fakturownia reported at
 * that moment. Read by the KSeF drawer of the admin.
 */
const FakturowniaKsefEvent = model
  .define("fakturownia_ksef_event", {
    id: model.id({ prefix: "fkksef" }).primaryKey(),
    document_id: model.text(),
    order_id: model.text(),
    demo: model.boolean().default(false),
    source: model.text(),
    gov_status: model.text().nullable(),
    gov_id: model.text().nullable(),
    errors: model.json().nullable(),
    requested_by: model.text().nullable(),
    note: model.text().nullable(),
  })
  .indexes([{ on: ["document_id", "created_at"], where: "deleted_at IS NULL" }])

export default FakturowniaKsefEvent
