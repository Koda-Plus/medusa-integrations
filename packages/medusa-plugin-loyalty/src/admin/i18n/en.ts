import { communityEn } from "../lib/loyalty-kit-community"
import { integrationEn } from "../../modules/loyalty/lib/integration-texts"

const en = {
  nav: "Loyalty",
  title: "Loyalty",
  view: {
    panel: "Panel",
    guide: "Setup guide",
  },
  by: "by Koda Plus",
  subtitle: "Points for every order: {{pointsPerPln}} point per 1.00, one point worth {{redeemRate}}, a reward ladder and the redemption history.",
  mode: {
    demo: "Demo",
  },
  error: "Could not load the page: {{message}}",
  stats: {
    accounts: "Accounts",
    points: "Points out",
    redeemed: "Points redeemed",
    ready: "Ready for a reward",
  },
  rewards: {
    title: "Reward ladder",
  },
  adjust: {
    title: "Adjust points",
    subtitle: "A manual change of a customer's points: positive reads as a bonus, negative as a correction.",
    customer: "Customer",
    customerPlaceholder: "Search by name or e-mail",
    delta: "Points",
    reason: "Reason",
    reasonPlaceholder: "e.g. complaint, bonus for a big order",
    save: "Adjust",
  },
  accounts: {
    title: "Points accounts",
    subtitle: "The balance, the earned and redeemed totals and the tier multiplier of every customer with an account.",
    empty: "No accounts yet. The first order opens one.",
    customer: "Customer",
    balance: "Balance",
    earned: "Earned",
    redeemed: "Redeemed",
    tier: "Tier",
  },
  transactions: {
    title: "Transactions",
    subtitle: "The latest movements of the ledger.",
    empty: "No transactions yet.",
    when: "When",
    kind: "Kind",
    delta: "Points",
    reason: "Reason",
  },
  kind: {
    earn_order: "Order",
    redeem: "Redeem",
    bonus: "Bonus",
    adjust: "Adjust",
    expire: "Expire",
  },
  toast: {
    saved: "Saved",
    error: "Something went wrong: {{error}}",
  },
  community: communityEn,
  integration: integrationEn,
}

export default en
