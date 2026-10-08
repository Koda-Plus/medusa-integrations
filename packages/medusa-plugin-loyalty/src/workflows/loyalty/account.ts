import type { MedusaContainer } from "@medusajs/framework/types"
import { loyaltySvc, num, type Row } from "../../modules/loyalty/lib/store"
import { LOYALTY_ERRORS } from "../../modules/loyalty/lib/errors"

/**
 * The flows around a points account: ensure it, award points for an order,
 * redeem points for a reward, adjust by hand. All of them work on the
 * tables through the generated methods from OUTSIDE the service (the thin
 * service stays free of the `fork` bug the original app module hit).
 */

/** Gets or creates the account of a customer. */
export async function ensureAccount(container: MedusaContainer, customerId: string, name?: { email?: string | null; company?: string | null }): Promise<Row> {
  const svc = loyaltySvc(container)
  const existing = await svc.listLoyaltyAccounts({ customer_id: customerId }, { take: 1 })
  if (existing.length > 0) return existing[0]
  const created = await svc.createLoyaltyAccounts([
    { customer_id: customerId, balance: 0, total_earned: 0, total_redeemed: 0, tier_multiplier: 1, customer_email: name?.email ?? null, customer_name: name?.company ?? null, demo: svc.isDemo() },
  ])
  return created[0]
}

export interface EarnInput {
  customerId: string
  orderId: string
  orderTotal: number
  tierMultiplier?: number
}

/** Awards points for a placed order: total times the rate times the tier. */
export async function earnForOrder(container: MedusaContainer, input: EarnInput): Promise<number> {
  const svc = loyaltySvc(container)
  const options = svc.getOptions()
  const account = await ensureAccount(container, input.customerId)
  const base = Math.floor(input.orderTotal * options.pointsPerPln)
  const multiplier = input.tierMultiplier ?? (num(account.tier_multiplier) || 1)
  const delta = Math.max(0, Math.floor(base * multiplier))
  if (delta <= 0) return 0
  /* Idempotent: the same order never awards twice. */
  const already = await svc.listLoyaltyTransactions({ order_id: input.orderId, kind: "earn_order" }, { take: 1 })
  if (already.length > 0) return 0
  await svc.createLoyaltyTransactions([
    { account_id: account.id, delta, kind: "earn_order", order_id: input.orderId, reason: `Order ${input.orderId}`, demo: svc.isDemo() },
  ])
  await svc.updateLoyaltyAccounts([{ id: account.id, balance: num(account.balance) + delta, total_earned: num(account.total_earned) + delta }])
  return delta
}

export interface RedeemInput {
  customerId: string
  points: number
  reward?: string
}

/** Redeems points: the value of the discount and the updated balance. */
export async function redeem(container: MedusaContainer, input: RedeemInput): Promise<{ points: number; discount: number; balance: number }> {
  const svc = loyaltySvc(container)
  const options = svc.getOptions()
  const account = await ensureAccount(container, input.customerId)
  const balance = num(account.balance)
  if (input.points <= 0 || input.points > balance) {
    throw new LoyaltyFlowError(400, "insufficient_points", `Cannot redeem ${input.points}; balance ${balance}.`)
  }
  const discount = Math.round(input.points * options.redeemRate * 100) / 100
  const meta = metaOf(account)
  const redeemed = Array.isArray(meta.redeemed) ? (meta.redeemed as Array<{ name?: unknown; pts?: unknown }>) : []
  const nextRedeemed = input.reward ? [...redeemed.filter((r) => typeof r?.name === "string" && typeof r?.pts === "number"), { name: input.reward, pts: input.points }] : redeemed
  await svc.createLoyaltyTransactions([
    {
      account_id: account.id,
      delta: -input.points,
      kind: "redeem",
      reason: input.reward ? `Odebrano za punkty: ${input.reward}` : `Redeem → ${discount} discount`,
      metadata: input.reward ? { product: input.reward, points: input.points } : undefined,
      demo: svc.isDemo(),
    },
  ])
  await svc.updateLoyaltyAccounts([
    {
      id: account.id,
      balance: balance - input.points,
      total_redeemed: num(account.total_redeemed) + input.points,
      metadata: { ...meta, redeemed: nextRedeemed, total_saved_pln: num(meta.total_saved_pln) + discount },
    },
  ])
  return { points: input.points, discount, balance: balance - input.points }
}

export interface AdjustInput {
  customerId: string
  delta: number
  reason: string
}

/** A manual adjustment (bonus, claim, fix), positive or negative. */
export async function adjust(container: MedusaContainer, input: AdjustInput): Promise<number> {
  const svc = loyaltySvc(container)
  const account = await ensureAccount(container, input.customerId)
  const kind = input.delta >= 0 ? "bonus" : "adjust"
  await svc.createLoyaltyTransactions([
    { account_id: account.id, delta: input.delta, kind, reason: input.reason, demo: svc.isDemo() },
  ])
  const balance = Math.max(0, num(account.balance) + input.delta)
  await svc.updateLoyaltyAccounts([
    {
      id: account.id,
      balance,
      total_earned: input.delta > 0 ? num(account.total_earned) + input.delta : num(account.total_earned),
    },
  ])
  return balance
}

function metaOf(row: Row): Record<string, unknown> {
  const m = row.metadata
  if (m && typeof m === "object" && !Array.isArray(m)) return m as Record<string, unknown>
  if (typeof m === "string") {
    try {
      const parsed = JSON.parse(m) as unknown
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  return {}
}

/** The error the routes turn into a stable code. */
export class LoyaltyFlowError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "LoyaltyFlowError"
    this.status = status
    this.code = code
  }
}

export { LOYALTY_ERRORS }
