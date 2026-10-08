/**
 * Options of `@koda-plus/medusa-plugin-loyalty`, passed in
 * `medusa-config.ts`:
 *
 *   plugins: [{ resolve: "@koda-plus/medusa-plugin-loyalty", options: { ... } }]
 *
 * Every key is optional and nothing here can stop Medusa from starting.
 * Demo mode is only ever on with `demo: true`: accounts created in demo mode
 * are flagged `demo`.
 */
export interface LoyaltyReward {
  /** The points a reward costs. */
  at: number
  /** The reward name in English and Polish. */
  name: { en: string; pl: string }
  /** The discount value in the store's currency, when the reward is a discount. */
  discount?: number
}

export interface LoyaltyPluginOptions {
  /** Demo mode: accounts and transactions flagged demo. Default: false. */
  demo?: boolean
  /** Points awarded per 1.00 of the order total. Default: 1. */
  pointsPerPln?: number | string
  /** The value of one point in the store's currency. Default: 0.05 (100 points = 5.00). */
  redeemRate?: number | string
  /** The reward ladder, from the cheapest. Default: none. */
  rewards?: LoyaltyReward[]
}

export interface ResolvedLoyaltyOptions {
  demo: boolean
  pointsPerPln: number
  redeemRate: number
  rewards: LoyaltyReward[]
}

function bool(value: unknown): boolean {
  return value === true || value === "true"
}

function rate(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number(value.trim()) : Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(1000, n)
}

export function resolveOptions(o: LoyaltyPluginOptions | undefined | null): ResolvedLoyaltyOptions {
  const opts = o && typeof o === "object" ? o : {}
  const rewards = Array.isArray(opts.rewards)
    ? opts.rewards
        .filter((r) => r && typeof r.at === "number" && r.at >= 0 && r.name && typeof r.name.en === "string" && typeof r.name.pl === "string")
        .map((r) => ({ at: Math.floor(r.at), name: { en: r.name.en, pl: r.name.pl }, discount: typeof r.discount === "number" ? r.discount : undefined }))
        .sort((a, b) => a.at - b.at)
    : []
  return {
    demo: bool(opts.demo),
    pointsPerPln: rate(opts.pointsPerPln, 1),
    redeemRate: rate(opts.redeemRate, 0.05),
    rewards,
  }
}
