import { model } from "@medusajs/framework/utils"
import LoyaltyTransaction from "./transaction"

/**
 * THE POINTS ACCOUNT OF ONE CUSTOMER: what they earned, what they redeemed
 * and what is left. `tier_multiplier` scales the earning of the customer's
 * B2B tier; `metadata` keeps the redeemed rewards and the total saved.
 *
 * The table name and the shape are kept from the original app module, so
 * the rows carry over.
 */
const LoyaltyAccount = model
  .define("loyalty_account", {
    id: model.id().primaryKey(),
    customer_id: model.text(),
    customer_email: model.text().nullable(),
    customer_name: model.text().nullable(),
    balance: model.number().default(0),
    total_earned: model.number().default(0),
    total_redeemed: model.number().default(0),
    tier_multiplier: model.number().default(1),
    demo: model.boolean().default(false),
    metadata: model.json().nullable(),
    transactions: model.hasMany(() => LoyaltyTransaction, { mappedBy: "account" }),
  })
  .indexes([
    { on: ["customer_id"], unique: true, where: "deleted_at IS NULL" },
    { on: ["demo"], where: "deleted_at IS NULL" },
  ])

export default LoyaltyAccount
