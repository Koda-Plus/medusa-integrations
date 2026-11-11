import { model } from "@medusajs/framework/utils"

/**
 * ONE FEED BUILD: the XML file Ceneo reads, as it was built, with its hash
 * and counters. The feed route serves the newest successful build and never
 * builds on a request, so Ceneo always gets the same bytes between builds
 * and a slow catalog query never times Ceneo out. A failed build keeps its
 * error and no XML; the previous file stays served.
 */
const CeneoFeed = model
  .define("ceneo_feed", {
    id: model.id({ prefix: "cfd" }).primaryKey(),
    status: model.text().default("built"),
    xml: model.text().nullable(),
    hash: model.text().nullable(),
    bytes: model.number().default(0),
    offers: model.number().default(0),
    warnings: model.number().default(0),
    errors: model.number().default(0),
    excluded: model.number().default(0),
    duration_ms: model.number().default(0),
    error: model.text().nullable(),
    trigger: model.text().default("schedule"),
    built_at: model.dateTime(),
    demo: model.boolean().default(false),
  })
  .indexes([{ on: ["status", "built_at"], where: "deleted_at IS NULL" }])

export default CeneoFeed
