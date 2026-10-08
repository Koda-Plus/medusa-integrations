import { model } from "@medusajs/framework/utils"

/**
 * ONE ECONOMIC OPERATOR of the GPSR: a manufacturer, a responsible person in
 * the EU, an importer or an authorised representative. A product links to up
 * to two of these: the manufacturer and the responsible person.
 *
 * The class is named `ComplianceOperator` (not "responsible person") so the
 * generated CRUD methods read `listComplianceOperators` and not the awkward
 * plural "people".
 */
const ComplianceOperator = model
  .define("compliance_responsible_person", {
    id: model.id({ prefix: "crp" }).primaryKey(),
    kind: model.text().default("responsible_person"),
    name: model.text(),
    address: model.text().nullable(),
    email: model.text().nullable(),
    country_code: model.text().nullable(),
    demo: model.boolean().default(false),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["kind", "name"], where: "deleted_at IS NULL" },
    { on: ["demo"], where: "deleted_at IS NULL" },
  ])

export default ComplianceOperator
