import { model } from "@medusajs/framework/utils"

/**
 * A PRESENTATION: one lecture turned into a script with slides, a quiz and
 * short versions, voiced and rendered with an avatar.
 *
 * `script` is the whole plan as JSON (slides with narration, quiz, short
 * versions) and `script_hash` its hash. Approval stores the hash it saw in
 * `approved_hash`: a render checks both, so any edit after approval needs a
 * new approval.
 */
const AvatarsPresentation = model
  .define("avatars_presentation", {
    id: model.id({ prefix: "avp" }).primaryKey(),
    title: model.text(),
    lang: model.text().default("pl"),
    state: model.text().default("draft"),
    source_kind: model.text().default("text"),
    source_file_url: model.text().nullable(),
    source_text: model.text().nullable(),
    transcript: model.text().nullable(),
    target_minutes: model.number().default(12),
    avatar_id: model.text().nullable(),
    script: model.json().nullable(),
    script_hash: model.text().nullable(),
    approved_hash: model.text().nullable(),
    approved_by: model.text().nullable(),
    approved_at: model.dateTime().nullable(),
    published_at: model.dateTime().nullable(),
    error: model.text().nullable(),
    created_by: model.text().nullable(),
    demo: model.boolean().default(false),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["state"], where: "deleted_at IS NULL" },
    { on: ["avatar_id"], where: "deleted_at IS NULL" },
  ])

export default AvatarsPresentation
