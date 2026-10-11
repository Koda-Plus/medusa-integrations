import { model } from "@medusajs/framework/utils"

/**
 * ONE SUBSCRIPTION from the storefront form: who, where from and what Kit
 * answered. A row is written for every attempt, so the team sees exactly
 * what happened even when Kit was down or the email was refused.
 */
const KitSubscriberLog = model
  .define("kit_subscriber_log", {
    id: model.id({ prefix: "kitsub" }).primaryKey(),
    email: model.text(),
    first_name: model.text().nullable(),
    /** The Kit subscriber id, when Kit answered. */
    kit_subscriber_id: model.number().nullable(),
    /** The state the subscriber was created in (active / inactive). */
    state: model.text().nullable(),
    /** The tag ids that were applied. */
    tags: model.json().nullable(),
    /** "form" (the storefront form), or whatever the caller sent. */
    source: model.text().nullable(),
    /** ok - subscribed; failed - Kit refused or was unreachable. */
    status: model.text().default("ok"),
    /** A masked error for failed rows. */
    error: model.text().nullable(),
  })
  .indexes([
    { on: ["email"], where: "deleted_at IS NULL" },
    { on: ["created_at"], where: "deleted_at IS NULL" },
  ])

export default KitSubscriberLog
