import { model } from "@medusajs/framework/utils"

/**
 * ONE HANDOVER TO THE COURIER: the shipments of one sender a person picked,
 * in two steps. Step 1 is the protocol (writer shipment: a write in DPD
 * without a cost); step 2, optional, the courier order (writer pickup: a
 * physical effect and a cost). A shop with a fixed pickup stops at step 1.
 *
 *   state  pending | printing | printed | ordering | ordered | updating
 *          | unknown | canceled
 *
 * (DISPATCH_STATES in lib/constants.ts). pending: the shipments are pinned,
 * no protocol yet; printing: the claim of the protocol; printed: the
 * protocol is saved and the shipments handed over; ordering: the claim of
 * the courier order; updating: the claim of a PATCH or DELETE of it;
 * unknown: the order may exist. Every claimed state has a token and a lease
 * (`claim_token`, `lease_until`) and a claim raises `attempts`.
 * packagesPickupCall has no idempotency key, so an unclear answer ends in
 * `unknown` and waits for a person, never for a retry, because a second
 * courier is a real cost. The courier order knows only counts and weights:
 * which shipments it carries is known here only (`shipment_ids`), with the
 * sender and the packagesParams the plan was built from (`sender`,
 * `params`, `plan_hash`). `order_number` and `check_sum` are what DPD needs
 * to change (PATCH) or cancel (DELETE) the order; `check_sum` never leaves
 * this table.
 */
const DpdDispatch = model
  .define("dpd_dispatch", {
    id: model.id({ prefix: "dpddsp" }).primaryKey(),
    mode: model.text(),
    state: model.text().default("pending"),
    location_id: model.text().nullable(),
    sender: model.json().nullable(),
    params: model.json().nullable(),
    problems: model.json().nullable(),
    plan_hash: model.text().nullable(),
    shipment_ids: model.json().nullable(),
    protocols: model.json().nullable(),
    protocol_at: model.dateTime().nullable(),
    pickup_date: model.text().nullable(),
    pickup_time_from: model.text().nullable(),
    pickup_time_to: model.text().nullable(),
    order_type: model.text().nullable(),
    order_number: model.text().nullable(),
    check_sum: model.text().nullable(),
    ordered_at: model.dateTime().nullable(),
    claim_token: model.text().nullable(),
    lease_until: model.dateTime().nullable(),
    error: model.text().nullable(),
    error_code: model.text().nullable(),
    attempts: model.number().default(0),
    created_by: model.text().nullable(),
    updated_by: model.text().nullable(),
  })
  .indexes([
    { on: ["state", "mode"], where: "deleted_at IS NULL" },
    { on: ["order_number"], where: "order_number IS NOT NULL AND deleted_at IS NULL" },
  ])

export default DpdDispatch
