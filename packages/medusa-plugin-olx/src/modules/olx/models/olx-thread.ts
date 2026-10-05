import { model } from "@medusajs/framework/utils"

/**
 * One OLX message thread, as COUNTS ONLY: the thread key, the advert, how
 * many messages and how many unread. No buyer id, no message text: the
 * conversation is read on OLX, where the admin links.
 */
const OlxThread = model
  .define("olx_thread", {
    id: model.id({ prefix: "olxth" }).primaryKey(),
    thread_key: model.text(),
    advert_olx_id: model.text().nullable(),
    unread_count: model.number().default(0),
    total_count: model.number().default(0),
    olx_created_at: model.dateTime().nullable(),
    is_favourite: model.boolean().default(false),
    demo: model.boolean().default(false),
  })
  .indexes([
    { on: ["thread_key", "demo"], unique: true, where: "deleted_at IS NULL" },
    { on: ["advert_olx_id"], where: "deleted_at IS NULL" },
  ])

export default OlxThread
