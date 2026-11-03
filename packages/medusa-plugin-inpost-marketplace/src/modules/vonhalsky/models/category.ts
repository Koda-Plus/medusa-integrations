import { model } from "@medusajs/framework/utils"

/**
 * ONE MARKETPLACE CATEGORY of the tree (five levels), read from the seller
 * API and kept so mapping and validation never wait for it. An offer needs
 * a leaf. The attributes of a leaf are read when it is first used and kept
 * with the time they were read.
 */
const VonHalskyCategory = model
  .define("vonhalsky_category", {
    id: model.id({ prefix: "vhcat" }).primaryKey(),
    remote_id: model.text(),
    parent_id: model.text().nullable(),
    name: model.text(),
    /** "Dom i ogród > Meble > Krzesła" */
    path: model.text(),
    depth: model.number().default(0),
    leaf: model.boolean().default(false),
    /** The category needs no GPSR data. */
    gpsr_free: model.boolean().default(false),
    /** The attribute definitions of a leaf: [{ id, name, type, required, multiple, options, unit }]. */
    attributes: model.json().nullable(),
    attributes_at: model.dateTime().nullable(),
    synced_at: model.dateTime().nullable(),
  })
  .indexes([
    { on: ["remote_id"], unique: true, where: "deleted_at IS NULL" },
    { on: ["parent_id"], where: "deleted_at IS NULL" },
  ])

export default VonHalskyCategory
