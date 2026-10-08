import { model } from "@medusajs/framework/utils"

/**
 * ONE ORDER ON THE CUSTOMER'S ACCOUNT: what it costs, when it is due under
 * the customer's terms, and whether it is paid. The overdue job flips open
 * orders to overdue; a captured payment flips them to paid.
 */
const CreditOrder = model
  .define("credit_order", {
    id: model.id({ prefix: "cro" }).primaryKey(),
    order_id: model.text(),
    display_id: model.number().nullable(),
    customer_id: model.text(),
    currency_code: model.text().default("pln"),
    total_amount: model.number().default(0),
    net_days: model.number().default(0),
    due_at: model.dateTime(),
    paid_at: model.dateTime().nullable(),
    state: model.text().default("open"),
    demo: model.boolean().default(false),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["order_id"], unique: true, where: "deleted_at IS NULL" },
    { on: ["customer_id", "state"], where: "deleted_at IS NULL" },
    { on: ["state", "due_at"], where: "deleted_at IS NULL" },
  ])

export default CreditOrder
