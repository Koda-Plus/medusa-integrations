import { model } from "@medusajs/framework/utils"

/**
 * THE CREDIT TERMS OF ONE CUSTOMER: how much they may owe, how much they owe
 * now (kept by the overdue job and the payment events), the payment terms
 * (net days) and the manual blocking toggle. Amounts are in the store's
 * price units (major units in the demo).
 */
const CreditLimit = model
  .define("credit_limit", {
    id: model.id({ prefix: "crl" }).primaryKey(),
    customer_id: model.text(),
    customer_email: model.text().nullable(),
    customer_name: model.text().nullable(),
    currency_code: model.text().default("pln"),
    limit_amount: model.number().default(0),
    used_amount: model.number().default(0),
    net_days: model.number().default(0),
    status: model.text().default("active"),
    blocked: model.boolean().default(false),
    demo: model.boolean().default(false),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["customer_id"], unique: true, where: "deleted_at IS NULL" },
    { on: ["blocked"], where: "deleted_at IS NULL" },
  ])

export default CreditLimit
