import { model } from "@medusajs/framework/utils"

/**
 * THE E-MAIL HISTORY OF DOCUMENTS: every time the plugin asked Fakturownia
 * to e-mail a document (automatically after issue, a person from the admin,
 * a payment reminder), with who asked, when and the result.
 *
 * PERSONAL DATA: the address is stored MASKED ("a***@e***.pl"), enough to
 * tell which of the buyer's addresses it went to, never the address itself.
 * In demo mode the rows are the simulated mailbox: nothing was sent.
 *
 * `amount` is `numeric(14,2)` in the migration (exact money), declared as a
 * float here, like `total_gross` of a document.
 */
const FakturowniaEmail = model
  .define("fakturownia_email", {
    id: model.id({ prefix: "fkmail" }).primaryKey(),
    document_id: model.text(),
    order_id: model.text(),
    demo: model.boolean().default(false),
    kind: model.text(),
    status: model.text(),
    recipient: model.text().nullable(),
    cc: model.text().nullable(),
    with_pdf: model.boolean().default(false),
    subject: model.text().nullable(),
    error: model.text().nullable(),
    requested_by: model.text().nullable(),
    /* 0.4.0: a reminder's amount left to pay (Fakturownia's), and why a refused one did not go out */
    amount: model.float().nullable(),
    reason: model.text().nullable(),
  })
  .indexes([
    { on: ["document_id", "created_at"], where: "deleted_at IS NULL" },
    { on: ["demo", "created_at"], where: "deleted_at IS NULL" },
  ])

export default FakturowniaEmail
