import type { TxKind } from "./constants"

/** The points account of one customer. */
export interface AccountDto {
  id: string
  customer_id: string
  customer_email: string | null
  customer_name: string | null
  balance: number
  total_earned: number
  total_redeemed: number
  tier_multiplier: number
  /** From the metadata, kept across the module's history. */
  total_saved: number
  redeemed: Array<{ name: string; pts: number }>
  demo: boolean
}

/** One transaction of the ledger. */
export interface TxDto {
  id: string
  account_id: string
  delta: number
  kind: TxKind
  reason: string | null
  order_id: string | null
  created_at: string
}

/** The whole status the Loyalty page renders in one call. */
export interface StatusResponse {
  demo: boolean
  pointsPerPln: number
  redeemRate: number
  rewards: Array<{ at: number; name: { en: string; pl: string }; discount?: number }>
  counts: {
    accounts: number
    points_total: number
    redeemed_total: number
    transactions: number
    ready: number
  }
  accounts: AccountDto[]
  transactions: TxDto[]
}

/** The customer's own loyalty, as the storefront reads it. */
export interface StoreLoyaltyData {
  balance: number
  total_earned: number
  total_redeemed: number
  total_saved: number
  tier_discount: number
  redeemed: Array<{ name: string; pts: number }>
  transactions: Array<{ id: string; delta: number; kind: TxKind; reason: string | null; order_id: string | null; created_at: string; product?: string; points?: number }>
  rewards: Array<{ at: number; name: { en: string; pl: string }; discount?: number }>
}
