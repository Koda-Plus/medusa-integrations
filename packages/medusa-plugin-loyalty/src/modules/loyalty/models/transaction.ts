import { model } from "@medusajs/framework/utils"
import LoyaltyAccount from "./account"

/**
 * ONE MOVEMENT OF THE LEDGER: points earned for an order, redeemed for a
 * reward, a bonus, an adjustment or an expiry. Rows are never changed.
 */
const LoyaltyTransaction = model
  .define("loyalty_transaction", {
    id: model.id().primaryKey(),
    account: model.belongsTo(() => LoyaltyAccount, { mappedBy: "transactions" }),
    delta: model.number(),
    kind: model
      .enum(["earn_order", "redeem", "bonus", "adjust", "expire"])
      .default("earn_order"),
    reason: model.text().nullable(),
    order_id: model.text().nullable(),
    demo: model.boolean().default(false),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["account_id", "created_at"], where: "deleted_at IS NULL" },
    { on: ["order_id"], where: "deleted_at IS NULL" },
  ])

export default LoyaltyTransaction
