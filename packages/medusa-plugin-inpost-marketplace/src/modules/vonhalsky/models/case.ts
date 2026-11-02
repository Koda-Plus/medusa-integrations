import { model } from "@medusajs/framework/utils"

/**
 * ONE AFTER SALE CASE of a marketplace order: a return, a refund or a claim
 * (complaint), as the seller API reports it. Unique per kind and marketplace
 * id. Ids, statuses, amounts and products only: the buyer's name and
 * contact data are read live from the marketplace when the admin opens a
 * case, never stored here.
 */
const VonHalskyCase = model
  .define("vonhalsky_case", {
    id: model.id({ prefix: "vhcase" }).primaryKey(),
    /** return, refund, claim */
    kind: model.text(),
    remote_id: model.text(),
    display_id: model.text().nullable(),
    /** The marketplace order id. */
    marketplace_order_id: model.text().nullable(),
    /** Return: NEW, ACCEPTED, REJECTED. Refund: the case status. Claim: the state. */
    status: model.text().nullable(),
    /** Refund: the money (NEW, REFUNDED, DECLINED...). Claim: the resolution. Return: the refund's payment status. */
    sub_status: model.text().nullable(),
    /** Return: the method. Refund: RETURN, CLAIM or INDEPENDENT. Claim: the requested resolution. */
    source: model.text().nullable(),
    /** The reason in the marketplace's words (a return reason, a claim type). */
    reason: model.text().nullable(),
    /** The amount: refunded, to refund, or the order value. */
    amount_minor: model.number().nullable(),
    /** The products: [{ offerId, name, ean, quantity, priceMinor, reason }]. */
    lines: model.json().nullable(),
    refund_id: model.text().nullable(),
    opened_at: model.dateTime().nullable(),
    expires_at: model.dateTime().nullable(),
    decided_at: model.dateTime().nullable(),
    remote_updated_at: model.dateTime().nullable(),
    demo: model.boolean().default(false),
    /** The newest events, at most 40: [{ at, kind, message }]. */
    events: model.json().nullable(),
  })
  .indexes([
    { on: ["kind", "remote_id"], unique: true, where: "deleted_at IS NULL" },
    { on: ["marketplace_order_id"], where: "deleted_at IS NULL" },
    { on: ["kind", "status"], where: "deleted_at IS NULL" },
  ])

export default VonHalskyCase
