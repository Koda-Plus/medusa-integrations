import { model } from "@medusajs/framework/utils"

/**
 * SETTINGS A PERSON CHANGES IN THE ADMIN, with who changed them and when:
 * the branding overrides (`live:brand`, `demo:brand`) and the template
 * switches (`live:template:order.placed`, ...; see `lib/settings.ts`), plus
 * the marker of the demo outbox seed. One row per key.
 */
const EmailsSetting = model
  .define("emails_setting", {
    id: model.id({ prefix: "emset" }).primaryKey(),
    key: model.text(),
    value: model.json().nullable(),
    updated_by: model.text().nullable(),
  })
  .indexes([{ on: ["key"], unique: true, where: "deleted_at IS NULL" }])

export default EmailsSetting
