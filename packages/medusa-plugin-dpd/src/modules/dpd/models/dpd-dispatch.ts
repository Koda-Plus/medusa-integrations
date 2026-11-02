import { model } from "@medusajs/framework/utils"

/**
 * ONE HANDOVER TO THE COURIER: the shipments a person picked, their
 * protocols (one per DPD session type, DOMESTIC and INTERNATIONAL) and the
 * courier order.
 *
 *   state  pending | ordering | ordered | unknown | canceled
 *
 * (DISPATCH_STATES in lib/constants.ts). packagesPickupCall has no
 * idempotency key, so the order is claimed (`claim_token`, `lease_until`)
 * and sent once; an unclear answer ends in `unknown` and waits for a person,
 * never for a retry, because a second courier is a real cost. The courier
 * order knows only counts and weights: which shipments it carries is known
 * here only (`shipment_ids`). `order_number` and `check_sum` are what DPD
 * needs to change (PATCH) or cancel (DELETE) the order.
 */
const DpdDispatch = model
  .define("dpd_dispatch", {
    id: model.id({ prefix: "dpddsp" }).primaryKey(),
    mode: model.text(),
    state: model.text().default("pending"),
    shipment_ids: model.json().nullable(),
    protocols: model.json().nullable(),
    pickup_date: model.text().nullable(),
    pickup_time_from: model.text().nullable(),
    pickup_time_to: model.text().nullable(),
    order_type: model.text().nullable(),
    order_number: model.text().nullable(),
    check_sum: model.text().nullable(),
    claim_token: model.text().nullable(),
    lease_until: model.dateTime().nullable(),
    error: model.text().nullable(),
    error_code: model.text().nullable(),
    created_by: model.text().nullable(),
  })
  .indexes([
    { on: ["state", "mode"], where: "deleted_at IS NULL" },
    { on: ["order_number"], where: "order_number IS NOT NULL AND deleted_at IS NULL" },
  ])

export default DpdDispatch
