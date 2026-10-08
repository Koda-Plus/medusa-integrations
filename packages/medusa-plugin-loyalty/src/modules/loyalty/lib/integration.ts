import type { CounterDraft, SummaryDraft } from "./kit-routes"

/**
 * Loyalty in the koda.integration/1 contract, as pure functions over the
 * plugin's own rows: one line per customer with a points account, and the
 * board counter of accounts that can redeem a reward.
 */

/** What the summary needs of an account. */
export interface AccountRow {
  balance: number
  total_earned: number
  first_reward_at: number
}

/** The line of one customer from their points. Undefined without an account. */
export function customerSummary(id: string, account: AccountRow | undefined, money: (n: number) => string): SummaryDraft | undefined {
  if (!account) return undefined
  const links = [{ kind: "admin" as const, href: "/loyalty" }]
  if (account.balance > 0) {
    return {
      state: "active",
      title: { key: "integration.customer.points", params: { count: account.balance } },
      ...(account.balance >= account.first_reward_at
        ? { detail: { key: "integration.customer.ready", params: { count: account.first_reward_at } } }
        : {}),
      links,
      counts: { points: account.balance },
    }
  }
  return {
    state: "ok",
    title: { key: "integration.customer.empty" },
    detail: { key: "integration.customer.earned", params: { count: account.total_earned } },
    links,
  }
}

/** The board counter: accounts that can redeem at least the cheapest reward. */
export function loyaltyCounters(c: { ready: number }): CounterDraft[] {
  return [
    {
      key: "ready",
      scope: "customers",
      count: c.ready,
      tone: "blue",
      link: { kind: "admin", href: "/loyalty" },
      entity: "customer",
    },
  ]
}
