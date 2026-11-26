import { model } from "@medusajs/framework/utils"

/**
 * AN AVATAR: a face at the video provider (Tavus `replica_id`), the voice it
 * speaks with and the written consent of the person behind it.
 *
 * The consent is a document on file (`consent_file_url`, stored through the
 * File Module), who signed it and when. Without `consent_state = signed` no
 * render starts (lib/consent.ts). A stock face of the provider still gets a
 * record: then the note says so and the file is the provider's licence.
 */
const AvatarsAvatar = model
  .define("avatars_avatar", {
    id: model.id({ prefix: "avt" }).primaryKey(),
    name: model.text(),
    provider: model.text().default("tavus"),
    face_id: model.text(),
    voice: model.text(),
    consent_state: model.text().default("none"),
    consent_file_url: model.text().nullable(),
    consent_signed_by: model.text().nullable(),
    consent_signed_at: model.dateTime().nullable(),
    consent_note: model.text().nullable(),
    consent_recorded_by: model.text().nullable(),
    demo: model.boolean().default(false),
    metadata: model.json().nullable(),
  })
  .indexes([{ on: ["face_id"], where: "deleted_at IS NULL" }])

export default AvatarsAvatar
