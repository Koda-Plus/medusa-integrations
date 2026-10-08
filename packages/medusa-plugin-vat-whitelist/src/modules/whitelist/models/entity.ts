import { model } from "@medusajs/framework/utils"

/**
 * ONE VERIFIED COUNTERPARTY: the latest registry answer for one Polish NIP
 * or EU VAT number, kept so the panel lists who was checked and the
 * storefront shows the customer's own status without asking the registry
 * every time. `customer_id` links the Medusa customer when the check was
 * about them.
 */
const WhitelistEntity = model
  .define("whitelist_entity", {
    id: model.id({ prefix: "wen" }).primaryKey(),
    nip: model.text(),
    country_code: model.text().default("PL"),
    source: model.text().default("whitelist"),
    state: model.text().default("unavailable"),
    status_vat: model.text().nullable(),
    name: model.text().nullable(),
    address: model.text().nullable(),
    bank_accounts: model.json().nullable(),
    regon: model.text().nullable(),
    krs: model.text().nullable(),
    legal_form: model.text().nullable(),
    customer_id: model.text().nullable(),
    checked_at: model.dateTime(),
    demo: model.boolean().default(false),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["nip"], unique: true, where: "deleted_at IS NULL" },
    { on: ["customer_id"], where: "deleted_at IS NULL" },
    { on: ["state"], where: "deleted_at IS NULL" },
  ])

export default WhitelistEntity
