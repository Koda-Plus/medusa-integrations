import { model } from "@medusajs/framework/utils"

/**
 * One background run: a pass of the outbox (`issue`), of the payments
 * (`payments`) or of the KSeF status, waiting e-mails and cancellations
 * (`statuses`). The admin shows the latest runs; each kind keeps its last 50.
 * Messages are masked before they are stored.
 */
const FakturowniaSyncRun = model
  .define("fakturownia_sync_run", {
    id: model.id({ prefix: "fkrun" }).primaryKey(),
    kind: model.text(),
    source: model.text(),
    trigger: model.text(),
    status: model.text(),
    complete: model.boolean().default(false),
    counts: model.json().nullable(),
    message: model.text().nullable(),
    duration_ms: model.number().default(0),
    started_at: model.dateTime(),
    finished_at: model.dateTime().nullable(),
  })
  .indexes([{ on: ["kind", "started_at"], where: "deleted_at IS NULL" }])

export default FakturowniaSyncRun
