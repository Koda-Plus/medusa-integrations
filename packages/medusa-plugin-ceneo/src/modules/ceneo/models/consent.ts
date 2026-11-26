import { model } from "@medusajs/framework/utils"

/**
 * THE SHOPPER'S ANSWER TO THE ZAUFANE OPINIE CHECKBOX, per cart. No
 * personal data: the e-mail stays on the order and is read only when
 * `survey` is true. Never in cart or order metadata (repo rule): a shopper
 * writes metadata, this row is the record.
 */
const CeneoConsent = model
  .define("ceneo_consent", {
    id: model.id({ prefix: "ccs" }).primaryKey(),
    cart_id: model.text(),
    survey: model.boolean().default(false),
    /** When the shopper answered (POST); null for a row the transaction created without an answer. */
    answered_at: model.dateTime().nullable(),
    /** Set when the storefront first fetched the transaction for the order of this cart. */
    order_id: model.text().nullable(),
    transaction_at: model.dateTime().nullable(),
  })
  .indexes([
    { name: "IDX_ceneo_consent_cart_unique", on: ["cart_id"], unique: true, where: "deleted_at IS NULL" },
    { name: "IDX_ceneo_consent_created_at", on: ["created_at"], where: "deleted_at IS NULL" },
  ])

export default CeneoConsent
