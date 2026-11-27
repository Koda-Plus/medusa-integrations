import { model } from "@medusajs/framework/utils"

/**
 * ONE CLIP of a presentation: a slide (`s01`) or a short version (`k01`).
 *
 * `signature` is the hash of what the clip says and how (avatar, voice, text):
 * a clip is ordered again only when it changes. `provider_video_id` is
 * written right after the order (the marker of the writer pattern), so a
 * retry never pays twice for the same clip. Durations are kept in
 * milliseconds (integer columns only, see the repository rules).
 */
const AvatarsRenderJob = model
  .define("avatars_render_job", {
    id: model.id({ prefix: "avr" }).primaryKey(),
    presentation_id: model.text(),
    item_id: model.text(),
    signature: model.text(),
    state: model.text().default("queued"),
    provider_video_id: model.text().nullable(),
    audio_url: model.text().nullable(),
    video_url: model.text().nullable(),
    duration_ms: model.number().nullable(),
    progress: model.number().default(0),
    attempts: model.number().default(0),
    error: model.text().nullable(),
    demo: model.boolean().default(false),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["presentation_id", "item_id"], where: "deleted_at IS NULL" },
    { on: ["state"], where: "deleted_at IS NULL" },
  ])

export default AvatarsRenderJob
