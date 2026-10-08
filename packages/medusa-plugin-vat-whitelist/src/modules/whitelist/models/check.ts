import { model } from "@medusajs/framework/utils"

/**
 * ONE RUN OF A CHECK, the audit trail: what was asked, what the registry
 * answered and who asked. Rows are never changed, only added.
 */
const WhitelistCheck = model
  .define("whitelist_check", {
    id: model.id({ prefix: "wch" }).primaryKey(),
    entity_id: model.text().nullable(),
    nip: model.text(),
    country_code: model.text().default("PL"),
    source: model.text().default("whitelist"),
    state: model.text().default("unavailable"),
    status_vat: model.text().nullable(),
    name: model.text().nullable(),
    address: model.text().nullable(),
    bank_accounts: model.json().nullable(),
    requested_by: model.text().nullable(),
    customer_id: model.text().nullable(),
    demo: model.boolean().default(false),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["nip", "created_at"], where: "deleted_at IS NULL" },
    { on: ["customer_id"], where: "deleted_at IS NULL" },
  ])

export default WhitelistCheck
