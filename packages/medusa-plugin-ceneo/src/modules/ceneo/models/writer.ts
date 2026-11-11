import { model } from "@medusajs/framework/utils"

/**
 * The runtime toggle of one writer (`id` is the writer key: orders,
 * status). A person flips it in the admin; the row says who and when. The
 * hard switch lives in the plugin options (`writes`) and always wins.
 * `mode` is where it was flipped (demo or live): a toggle armed in demo
 * mode does not arm a real account. The circuit breaker writes here too.
 */
const CeneoWriter = model.define("ceneo_writer", {
  id: model.id().primaryKey(),
  armed: model.boolean().default(false),
  mode: model.text().nullable(),
  changed_by: model.text().nullable(),
  changed_by_id: model.text().nullable(),
  changed_at: model.dateTime().nullable(),
  failure_streak: model.number().default(0),
  last_failure: model.text().nullable(),
  last_failure_at: model.dateTime().nullable(),
  tripped_at: model.dateTime().nullable(),
  trip_reason: model.text().nullable(),
  last_success_at: model.dateTime().nullable(),
  /* The run lease across processes (import-claim.ts, withRunLease). */
  lease_token: model.text().nullable(),
  lease_until: model.dateTime().nullable(),
})

export default CeneoWriter
