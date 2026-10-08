import { model } from "@medusajs/framework/utils"

/**
 * ONE DATA SUBJECT REQUEST (RODO). A logged-in customer asks to access,
 * erase, port, restrict, object to or rectify their data. The team works the
 * queue in the panel and marks the request done or rejected.
 */
const ComplianceDsr = model
  .define("compliance_dsr", {
    id: model.id({ prefix: "cdsr" }).primaryKey(),
    customer_id: model.text(),
    customer_email: model.text().nullable(),
    type: model.text(),
    status: model.text().default("pending"),
    note: model.text().nullable(),
    demo: model.boolean().default(false),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["customer_id", "created_at"], where: "deleted_at IS NULL" },
    { on: ["status", "created_at"], where: "deleted_at IS NULL" },
  ])

export default ComplianceDsr
