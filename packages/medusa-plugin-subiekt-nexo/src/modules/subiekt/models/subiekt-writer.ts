import { model } from "@medusajs/framework/utils"

/**
 * THE RUNTIME TOGGLE OF A WRITER: one row per writer (`prices`, `products`,
 * `documents`, `contractors`) and mode. A person arms or disarms it in the
 * admin; the row keeps who did it and when. The option in medusa-config.ts is
 * the other switch and wins when it says no (see `lib/writers.ts`).
 *
 * Unique by (key, demo): the demo store's toggles never arm a real writer.
 */
const SubiektWriter = model.define("subiekt_writer", {
  id: model.id({ prefix: "sbwrt" }).primaryKey(),
  key: model.text(),
  armed: model.boolean().default(false),
  changed_by: model.text().nullable(),
  changed_at: model.dateTime().nullable(),
  demo: model.boolean().default(false),
})

export default SubiektWriter
