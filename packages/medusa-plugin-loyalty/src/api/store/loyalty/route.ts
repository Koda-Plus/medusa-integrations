import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { loyaltySvc, num, str, toAccount, toIso } from "../../../modules/loyalty/lib/store"
import { redeem, LoyaltyFlowError } from "../../../workflows/loyalty/account"
import { bodyOf, customerIdOf } from "../../loyalty/helpers"
import type { StoreLoyaltyData } from "../../../modules/loyalty/lib/contract"

/**
 * GET /store/loyalty
 *
 * The logged-in customer's points: the balance, the totals, the saved
 * amount, the redeemed rewards, the reward ladder and the latest
 * transactions. The response keeps the shape of the original app module,
 * so the storefront reads it unchanged.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const customerId = customerIdOf(req)
  if (!customerId) {
    res.status(401).json({ type: "unauthorized", code: "unauthorized", message: "Log in to see your points." })
    return
  }
  const svc = loyaltySvc(req.scope)
  const options = svc.getOptions()
  const accounts = await svc.listLoyaltyAccounts({ customer_id: customerId }, { take: 1 })
  if (accounts.length === 0) {
    const data: StoreLoyaltyData = { balance: 0, total_earned: 0, total_redeemed: 0, total_saved: 0, tier_discount: 0, redeemed: [], transactions: [], rewards: options.rewards }
    res.json(data)
    return
  }
  const account = accounts[0]
  const dto = toAccount(account)
  const txs = await svc.listLoyaltyTransactions({ account_id: account.id }, { take: 30, order: { created_at: "DESC" } })
  const data: StoreLoyaltyData = {
    balance: dto.balance,
    total_earned: dto.total_earned,
    total_redeemed: dto.total_redeemed,
    total_saved: dto.total_saved,
    tier_discount: 0,
    redeemed: dto.redeemed,
    transactions: txs.map((t) => {
      const m = (t.metadata ?? {}) as Record<string, unknown>
      return {
        id: t.id,
        delta: num(t.delta),
        kind: t.kind as StoreLoyaltyData["transactions"][number]["kind"],
        reason: str(t.reason),
        order_id: str(t.order_id),
        created_at: toIso(t.created_at),
        product: typeof m.product === "string" ? m.product : undefined,
        points: typeof m.points === "number" ? m.points : undefined,
      }
    }),
    rewards: options.rewards,
  }
  res.json(data)
}

/**
 * POST /store/loyalty/redeem
 *
 * Redeems points for a reward or a discount. Body: { points, reward? }.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const customerId = customerIdOf(req)
  if (!customerId) {
    res.status(401).json({ type: "unauthorized", code: "unauthorized", message: "Log in to redeem points." })
    return
  }
  const body = bodyOf(req)
  const points = typeof body.points === "number" ? Math.floor(body.points) : Math.floor(Number(body.points))
  if (!Number.isFinite(points) || points <= 0) {
    res.status(400).json({ type: "invalid_data", code: "invalid_points", message: "Redeem a positive number of points." })
    return
  }
  const reward = typeof body.reward === "string" && body.reward.trim() ? body.reward.trim() : undefined
  try {
    const result = await redeem(req.scope, { customerId, points, reward })
    res.status(201).json(result)
  } catch (err) {
    if (err instanceof LoyaltyFlowError) {
      res.status(err.status).json({ type: "invalid_data", code: err.code, message: err.message })
      return
    }
    throw err
  }
}
