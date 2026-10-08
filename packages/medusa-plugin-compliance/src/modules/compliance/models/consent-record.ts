import { model } from "@medusajs/framework/utils"

/**
 * ONE CONSENT DECISION (RODO). Recorded by the cookie banner, the account
 * page or the checkout, for a purpose like analytics or marketing. The
 * record is the proof of consent: who, what, whether, when and from where.
 * `customer_id` is null for a visitor who was not logged in.
 */
const ComplianceConsent = model
  .define("compliance_consent", {
    id: model.id({ prefix: "ccn" }).primaryKey(),
    customer_id: model.text().nullable(),
    purpose: model.text(),
    granted: model.boolean().default(false),
    version: model.text().nullable(),
    source: model.text().default("cookie_banner"),
    demo: model.boolean().default(false),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["customer_id", "purpose"], where: "deleted_at IS NULL" },
    { on: ["purpose", "created_at"], where: "deleted_at IS NULL" },
  ])

export default ComplianceConsent
