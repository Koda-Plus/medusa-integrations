/**
 * LINKS INTO THE STRIPE DASHBOARD. No runtime imports.
 *
 * Test mode objects live under /test in the Dashboard, so every link follows
 * the mode of the key the plugin reads with. Ids are checked before they
 * become part of a path.
 */
import { DASHBOARD_BASE } from "./constants"

export type DashboardMode = "live" | "test"

const ID = /^[a-z]{2,8}_[A-Za-z0-9_]+$/

export class DashboardLinks {
  readonly base: string

  constructor(mode: DashboardMode) {
    this.base = mode === "test" ? `${DASHBOARD_BASE}/test` : DASHBOARD_BASE
  }

  private object(section: string, id: string | null | undefined): string {
    return id && ID.test(id) ? `${this.base}/${section}/${id}` : `${this.base}/${section}`
  }

  home(): string {
    return DASHBOARD_BASE
  }

  /** A payment (PaymentIntent): its charge, refunds, disputes and timeline. */
  payment(id: string | null | undefined): string {
    return this.object("payments", id)
  }

  dispute(id: string | null | undefined): string {
    return this.object("disputes", id)
  }

  payout(id: string | null | undefined): string {
    return this.object("payouts", id)
  }

  balance(): string {
    return `${this.base}/balance/overview`
  }

  webhooks(id?: string | null): string {
    return this.object("webhooks", id)
  }

  apiKeys(): string {
    return `${this.base}/apikeys`
  }

  paymentMethods(): string {
    return `${this.base}/settings/payment_methods`
  }

  domains(): string {
    return `${this.base}/settings/payment_method_domains`
  }

  /** Account details and what Stripe still needs to keep payments and payouts on. */
  account(): string {
    return `${DASHBOARD_BASE}/settings/account`
  }

  /** Bank accounts and payout currencies. */
  payoutSettings(): string {
    return `${DASHBOARD_BASE}/settings/payouts`
  }

  events(): string {
    return `${this.base}/events`
  }
}
