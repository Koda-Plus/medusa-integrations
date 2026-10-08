import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { loyaltySvc, toAccount, toTx } from "../../../modules/loyalty/lib/store"
import type { StatusResponse } from "../../../modules/loyalty/lib/contract"

/**
 * GET /admin/loyalty
 *
 * The whole status of the Loyalty page in one call: the accounts, the
 * latest transactions and the counters.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = loyaltySvc(req.scope)
  const options = svc.getOptions()
  const [accounts, transactions] = await Promise.all([
    svc.listLoyaltyAccounts({}, { take: 500, order: { balance: "DESC" } }),
    svc.listLoyaltyTransactions({}, { take: 100, order: { created_at: "DESC" } }),
  ])
  const accountDtos = accounts.map(toAccount)
  const firstReward = options.rewards[0]?.at ?? Number.POSITIVE_INFINITY

  const status: StatusResponse = {
    demo: options.demo,
    pointsPerPln: options.pointsPerPln,
    redeemRate: options.redeemRate,
    rewards: options.rewards,
    counts: {
      accounts: accountDtos.length,
      points_total: accountDtos.reduce((n, a) => n + a.balance, 0),
      redeemed_total: accountDtos.reduce((n, a) => n + a.total_redeemed, 0),
      transactions: transactions.length,
      ready: accountDtos.filter((a) => a.balance >= firstReward).length,
    },
    accounts: accountDtos,
    transactions: transactions.map(toTx),
  }

  res.json(status)
}
